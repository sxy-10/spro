package com.example.adminweb.api;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;

/**
 * 唯一允许访问 Node 的出口（BFF 的第一职责）。
 *
 * <p>它负责四件事，业务代码一件都不用操心：
 * <ol>
 *   <li><b>拼装凭证</b>：Bearer token 只在服务端出现，浏览器的 JS 永远看不到；</li>
 *   <li><b>写请求签名</b>：{@code X-Timestamp / X-Nonce / X-Signature / Idempotency-Key}，
 *       签名原文与 Node 的 {@code write()} 逐字节一致（含 query、body 的 SHA256）；</li>
 *   <li><b>剥包络</b>：{@code {code,message,data,trace_id}} → 直接返回 {@code data}，
 *       {@code code != 0} 抛 {@link NodeApiException}；</li>
 *   <li><b>有限重试</b>：只对 5xx 重试一次（幂等键复用，不会重复下单），超时直接抛
 *       {@link NodeUnavailableException}，401 绝不重试也不换票。</li>
 * </ol>
 *
 * <p>注意：这里用的是**独立 ObjectMapper**（不继承 Spring 的 SNAKE_CASE 策略）。
 * 签名原文里的 body 必须与发出去的字节完全一致，任何命名策略或缩进差异都会让签名对不上。
 */
@Component
public class NodeApiClient {

    private static final Logger log = LoggerFactory.getLogger(NodeApiClient.class);
    private static final ObjectMapper JSON = new ObjectMapper();
    /** 写请求的 body 不能为 null：Node 侧解析后是 {}，签名原文也必须按 "{}" 计算。 */
    private static final String EMPTY_BODY = "{}";

    private final RestClient client;
    private final RequestSigner signer;

    public NodeApiClient(RestClient nodeRestClient, RequestSigner requestSigner) {
        this.client = nodeRestClient;
        this.signer = requestSigner;
    }

    /** GET：Node 只校验 Bearer，不校验签名（签名只保护写请求）。 */
    public JsonNode get(String pathWithQuery, String token) {
        return call(HttpMethod.GET, pathWithQuery, null, token, Map.of(), false);
    }

    public JsonNode post(String path, Object body, String token) {
        return call(HttpMethod.POST, path, body, token, Map.of(), true);
    }

    public JsonNode put(String path, Object body, String token) {
        return call(HttpMethod.PUT, path, body, token, Map.of(), true);
    }

    public JsonNode patch(String path, Object body, String token) {
        return call(HttpMethod.PATCH, path, body, token, Map.of(), true);
    }

    /**
     * 透传类写接口（如 {@code POST /v1/events}）：Node 不验签，但需要带上用户身份。
     *
     * <p>埋点走这里而不是 {@link #post}，是因为签名原文要求 body 的字节与 Node 反序列化后再序列化一致，
     * 客户端传来的任意 JSON（数组 / 顺序 / 数字格式）没必要为此受限。
     */
    public JsonNode postForward(String path, Object body, String token) {
        return call(HttpMethod.POST, path, body, token, Map.of(), false);
    }

    /**
     * 登录 / 验证码这类"还没有 token"的请求。
     *
     * <p>Node 的登录写在 {@code write(..., false)} 里 —— 不验签，但**仍然要求 Idempotency-Key**，
     * 所以这里统一带上，省得调用方各自记规则。
     */
    public JsonNode postAnonymous(String path, Object body, Map<String, String> extraHeaders) {
        return call(HttpMethod.POST, path, body, null, extraHeaders, false);
    }

    public JsonNode getAnonymous(String path) {
        return call(HttpMethod.GET, path, null, null, Map.of(), false);
    }

    private JsonNode call(HttpMethod method, String path, Object body, String token,
                          Map<String, String> extraHeaders, boolean signed) {
        String bodyJson = body == null ? (signed ? EMPTY_BODY : null) : toJson(body);
        // 幂等键在进入重试循环前生成一次：重试必须复用同一个键，否则 Node 会当成两笔写
        String idempotencyKey = signed ? UUID.randomUUID().toString() : null;

        for (int attempt = 1; attempt <= 2; attempt++) {
            RawResponse response = execute(method, path, bodyJson, token, extraHeaders, signed, idempotencyKey);
            // 5xx 才重试，且只重试一次
            if (response.status() >= 500 && attempt == 1) {
                log.warn("Node {} {} 返回 {}，150ms 后重试一次", method, path, response.status());
                sleepQuietly();
                continue;
            }
            return unwrap(method, path, response);
        }
        throw new NodeUnavailableException("Node 请求失败：" + method + " " + path, null);
    }

    private RawResponse execute(HttpMethod method, String path, String bodyJson, String token,
                                Map<String, String> extraHeaders, boolean signed, String idempotencyKey) {
        Map<String, String> headers = new LinkedHashMap<>(extraHeaders);
        if (token != null && !token.isBlank()) {
            headers.put("Authorization", "Bearer " + token);
        }
        if (signed) {
            RequestSigner.SignedHeaders signedHeaders = signer.sign(method.name(), path, bodyJson, token);
            headers.put("X-Timestamp", signedHeaders.timestamp());
            headers.put("X-Nonce", signedHeaders.nonce());
            headers.put("X-Signature", signedHeaders.signature());
            headers.put("Idempotency-Key", idempotencyKey);
        }

        try {
            RestClient.RequestBodySpec spec = client.method(method).uri(path).headers(h -> headers.forEach(h::set));
            if (bodyJson != null) {
                spec = spec.contentType(MediaType.APPLICATION_JSON);
            }
            RestClient.RequestBodySpec withBody = bodyJson == null ? spec : spec.body(bodyJson);
            return withBody.exchange((request, response) ->
                    new RawResponse(response.getStatusCode().value(), readBody(response.getBody())));
        } catch (ResourceAccessException e) {
            // 连接失败 / 读超时：宁可快速失败让页面提示"服务不可用"，也不要挂住请求线程
            throw new NodeUnavailableException("无法连接 Node：" + method + " " + path, e);
        }
    }

    private JsonNode unwrap(HttpMethod method, String path, RawResponse response) {
        String body = response.body();
        if (body == null || body.isBlank()) {
            if (response.status() >= 200 && response.status() < 300) {
                return null;
            }
            throw new NodeApiException(response.status(), response.status(),
                    "Node 返回空响应（HTTP " + response.status() + "）", null);
        }

        JsonNode envelope;
        try {
            envelope = JSON.readTree(body);
        } catch (JsonProcessingException e) {
            throw new NodeApiException(response.status(), 50000, "Node 响应不是合法 JSON", null);
        }

        JsonNode codeNode = envelope.get("code");
        if (codeNode != null && codeNode.asInt() != 0) {
            String message = envelope.path("message").asText("Node 返回错误");
            String traceId = envelope.path("trace_id").asText(null);
            log.info("Node {} {} 业务失败 code={} message={} trace={}", method, path, codeNode.asInt(), message, traceId);
            throw new NodeApiException(response.status(), codeNode.asInt(), message, traceId);
        }
        if (response.status() >= 400) {
            throw new NodeApiException(response.status(), response.status(),
                    "Node 请求失败（HTTP " + response.status() + "）", null);
        }
        return envelope.has("data") ? envelope.get("data") : envelope;
    }

    private static String toJson(Object body) {
        try {
            return JSON.writeValueAsString(body);
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException("请求体无法序列化", e);
        }
    }

    private static String readBody(InputStream stream) {
        try {
            return stream == null ? null : new String(stream.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new NodeUnavailableException("读取 Node 响应失败", e);
        }
    }

    private static void sleepQuietly() {
        try {
            Thread.sleep(150);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private record RawResponse(int status, String body) {
    }
}
