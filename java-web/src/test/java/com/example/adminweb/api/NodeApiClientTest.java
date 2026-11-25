package com.example.adminweb.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.JsonNode;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.web.client.ClientHttpRequestFactories;
import org.springframework.boot.web.client.ClientHttpRequestFactorySettings;
import org.springframework.web.client.RestClient;

/**
 * NodeApiClient 的四个契约点：签名原文、包络剥壳、5xx 重试一次、超时快速失败。
 * 用 JDK 自带 HttpServer 做桩，不引入 WireMock，测试可以在离线环境跑。
 */
class NodeApiClientTest {

    private HttpServer server;
    private String baseUrl;
    private final AtomicReference<Consumer<HttpExchange>> handler = new AtomicReference<>();

    @BeforeEach
    void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            handler.get().accept(exchange);
            exchange.close();
        });
        server.start();
        baseUrl = "http://127.0.0.1:" + server.getAddress().getPort();
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    private NodeApiClient client(Duration readTimeout) {
        RestClient restClient = RestClient.builder()
                .baseUrl(baseUrl)
                .requestFactory(ClientHttpRequestFactories.get(ClientHttpRequestFactorySettings.DEFAULTS
                        .withConnectTimeout(Duration.ofSeconds(1))
                        .withReadTimeout(readTimeout)))
                .build();
        return new NodeApiClient(restClient, new RequestSigner());
    }

    private static void respond(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(bytes);
        }
    }

    @Test
    void 写请求的签名与Node的write逐字节一致() {
        String token = "test-token";
        List<String> signatures = new ArrayList<>();
        AtomicReference<String> timestamp = new AtomicReference<>();
        AtomicReference<String> nonce = new AtomicReference<>();
        AtomicReference<String> idempotencyKey = new AtomicReference<>();
        AtomicReference<String> authorization = new AtomicReference<>();

        handler.set(exchange -> {
            try {
                timestamp.set(exchange.getRequestHeaders().getFirst("X-Timestamp"));
                nonce.set(exchange.getRequestHeaders().getFirst("X-Nonce"));
                signatures.add(exchange.getRequestHeaders().getFirst("X-Signature"));
                idempotencyKey.set(exchange.getRequestHeaders().getFirst("Idempotency-Key"));
                authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
                respond(exchange, 200, "{\"code\":0,\"message\":\"ok\",\"data\":{\"confirmed\":true}}");
            } catch (IOException e) {
                throw new IllegalStateException(e);
            }
        });

        JsonNode data = client(Duration.ofSeconds(2))
                .post("/v1/admin/orders/9/confirm", Map.of("remark", "已电话确认"), token);

        assertThat(data.path("confirmed").asBoolean()).isTrue();
        assertThat(authorization.get()).isEqualTo("Bearer " + token);
        assertThat(idempotencyKey.get()).hasSizeGreaterThanOrEqualTo(8);

        // 与 backend/src/api/core.ts 的 write() 完全相同的拼接方式
        String expectedBody = "{\"remark\":\"已电话确认\"}";
        String expected = RequestSigner.hmacSha256Hex(token, String.join("\n",
                "POST",
                "/v1/admin/orders/9/confirm",
                timestamp.get(),
                nonce.get(),
                RequestSigner.sha256Hex(expectedBody)));
        assertThat(signatures).containsExactly(expected);
    }

    @Test
    void 服务端5xx只重试一次且复用同一个幂等键() {
        AtomicInteger calls = new AtomicInteger();
        List<String> keys = new ArrayList<>();
        handler.set(exchange -> {
            try {
                keys.add(exchange.getRequestHeaders().getFirst("Idempotency-Key"));
                if (calls.incrementAndGet() == 1) {
                    respond(exchange, 500, "{\"code\":50000,\"message\":\"服务器内部错误\",\"data\":null}");
                } else {
                    respond(exchange, 200, "{\"code\":0,\"message\":\"ok\",\"data\":{\"ok\":true}}");
                }
            } catch (IOException e) {
                throw new IllegalStateException(e);
            }
        });

        JsonNode data = client(Duration.ofSeconds(2)).post("/v1/admin/orders/1/confirm", Map.of(), "t");

        assertThat(data.path("ok").asBoolean()).isTrue();
        assertThat(calls.get()).isEqualTo(2);
        assertThat(keys).hasSize(2);
        assertThat(keys.get(1)).isEqualTo(keys.get(0));
    }

    @Test
    void 业务错误原样透传code与message() {
        handler.set(exchange -> {
            try {
                respond(exchange, 401, "{\"code\":20012,\"message\":\"登录已失效\",\"data\":null,\"trace_id\":\"trace-1\"}");
            } catch (IOException e) {
                throw new IllegalStateException(e);
            }
        });

        assertThatThrownBy(() -> client(Duration.ofSeconds(2)).get("/v1/users/me", "expired-token"))
                .isInstanceOfSatisfying(NodeApiException.class, ex -> {
                    assertThat(ex.code()).isEqualTo(20012);
                    assertThat(ex.isUnauthorized()).isTrue();
                    assertThat(ex.getMessage()).isEqualTo("登录已失效");
                    assertThat(ex.traceId()).isEqualTo("trace-1");
                });
    }

    @Test
    void 超时抛NodeUnavailable让页面提示503() {
        handler.set(exchange -> {
            try {
                Thread.sleep(800);
                respond(exchange, 200, "{\"code\":0,\"message\":\"ok\",\"data\":null}");
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            } catch (IOException e) {
                throw new IllegalStateException(e);
            }
        });

        assertThatThrownBy(() -> client(Duration.ofMillis(200)).get("/v1/admin/dashboard", "t"))
                .isInstanceOf(NodeUnavailableException.class);
    }
}
