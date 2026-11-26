package com.example.adminweb.api;

import jakarta.annotation.PreDestroy;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.WebSocket;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Node 长连接出口：SSE（大屏）与 WebSocket（在线客服）。
 *
 * <p>为什么不复用 {@link NodeApiClient} 的 RestClient：那边配的是 3s 读超时，
 * 对「每 5s 推一拍」的 SSE 和「一直挂着」的 WS 都是致命的。这里单独用
 * {@link java.net.http.HttpClient}，只设连接超时，读超时交给业务自己控制。
 *
 * <p>两个纪律：
 * <ol>
 *   <li>Bearer token 只在这里出现，浏览器拿不到；</li>
 *   <li>浏览器断开必须能真正掐断上游流 —— {@link SseHandle#close()} 会关掉响应体，
 *       读取线程随即退出，不会在 Node 侧留下一个没人消费的定时器。</li>
 * </ol>
 */
@Component
public class NodeStreamClient {

    private static final Logger log = LoggerFactory.getLogger(NodeStreamClient.class);

    /** SSE 事件回调。线程是后台线程，实现方不要在里面阻塞。 */
    public interface SseHandler {
        void onEvent(String event, String data);

        /** 上游结束或失败（同一连接只会回调一次，之后不会再有 onEvent）。 */
        void onClosed(String reason);
    }

    public interface SseHandle extends AutoCloseable {
        @Override
        void close();
    }

    private final String baseUrl;
    private final HttpClient http;
    private final ExecutorService executor = Executors.newCachedThreadPool(runnable -> {
        Thread thread = new Thread(runnable, "node-sse");
        thread.setDaemon(true);
        return thread;
    });

    public NodeStreamClient(NodeProperties properties) {
        this.baseUrl = stripTrailingSlash(properties.baseUrl());
        Duration connectTimeout = properties.connectTimeout() == null
                ? Duration.ofSeconds(2) : properties.connectTimeout();
        this.http = HttpClient.newBuilder()
                .connectTimeout(connectTimeout)
                // SSE 是 HTTP/1.1 的语义，强制 1.1 省得踩 h2 的流复用坑
                .version(HttpClient.Version.HTTP_1_1)
                .build();
    }

    /**
     * 打开一条 SSE 上游流。
     *
     * @param pathWithQuery Node 侧完整路径（含 query），例如 {@code /v1/stats/live}
     * @param token         当前会话的 Node access token
     * @param handler       事件回调
     */
    public SseHandle openSse(String pathWithQuery, String token, SseHandler handler) {
        HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl + pathWithQuery))
                .header("Accept", "text/event-stream")
                .header("Cache-Control", "no-cache")
                .header("Authorization", "Bearer " + token)
                .GET()
                .build();

        AtomicBoolean closed = new AtomicBoolean(false);
        AtomicReference<InputStream> bodyRef = new AtomicReference<>();

        executor.execute(() -> {
            try {
                HttpResponse<InputStream> response = http.send(request, HttpResponse.BodyHandlers.ofInputStream());
                bodyRef.set(response.body());
                if (response.statusCode() != 200) {
                    handler.onClosed("HTTP " + response.statusCode());
                    closeQuietly(response.body());
                    return;
                }
                try (InputStream in = response.body();
                     BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
                    StringBuilder data = new StringBuilder();
                    String event = null;
                    String line;
                    while (!closed.get() && (line = reader.readLine()) != null) {
                        if (line.isEmpty()) {
                            if (event != null || data.length() > 0) {
                                handler.onEvent(event == null ? "message" : event, data.toString());
                            }
                            event = null;
                            data.setLength(0);
                            continue;
                        }
                        if (line.charAt(0) == ':') {
                            continue; // 注释 / 心跳行
                        }
                        int colon = line.indexOf(':');
                        String field = colon < 0 ? line : line.substring(0, colon);
                        String value = colon < 0 ? "" : line.substring(colon + 1);
                        if (value.startsWith(" ")) {
                            value = value.substring(1);
                        }
                        switch (field) {
                            case "event" -> event = value;
                            case "data" -> {
                                if (data.length() > 0) {
                                    data.append('\n');
                                }
                                data.append(value);
                            }
                            default -> {
                                // id / retry 由浏览器端自行处理，这里不转发
                            }
                        }
                    }
                }
                if (!closed.get()) {
                    handler.onClosed("上游关流");
                }
            } catch (Exception error) {
                if (!closed.get()) {
                    String reason = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
                    log.info("SSE 上游中断 {}：{}", pathWithQuery, reason);
                    handler.onClosed(reason);
                }
            } finally {
                closed.set(true);
            }
        });

        return () -> {
            // 关掉响应体 → readLine 立刻抛异常 → 后台线程退出，不漏线程也不漏 Node 侧定时器
            if (closed.compareAndSet(false, true)) {
                closeQuietly(bodyRef.get());
            }
        };
    }

    /** Node WS 地址（token 走 query，与 wscat 的验收方式一致；Node 侧会自动鉴权）。 */
    public URI webSocketUri(String pathWithQuery, String token) {
        String wsBase = baseUrl.startsWith("https://")
                ? "wss://" + baseUrl.substring("https://".length())
                : "ws://" + baseUrl.substring("http://".length());
        String sep = pathWithQuery.contains("?") ? "&" : "?";
        return URI.create(wsBase + pathWithQuery + sep + "token="
                + URLEncoder.encode(token, StandardCharsets.UTF_8));
    }

    public WebSocket.Builder webSocketBuilder() {
        return http.newWebSocketBuilder().connectTimeout(Duration.ofSeconds(5));
    }

    @PreDestroy
    void shutdown() {
        executor.shutdownNow();
    }

    private static void closeQuietly(InputStream stream) {
        if (stream == null) {
            return;
        }
        try {
            stream.close();
        } catch (IOException ignored) {
            // 关流失败没有补救手段，也不影响后续请求
        }
    }

    private static String stripTrailingSlash(String value) {
        if (value == null || value.isBlank()) {
            return "http://127.0.0.1:3001";
        }
        return value.endsWith("/") ? value.substring(0, value.length() - 1) : value;
    }
}
