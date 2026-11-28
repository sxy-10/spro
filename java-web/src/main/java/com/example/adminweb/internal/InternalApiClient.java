package com.example.adminweb.internal;

import com.example.adminweb.api.NodeApiException;
import com.example.adminweb.api.NodeUnavailableException;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;

/**
 * 内部接口唯一的出口（浏览器永远到不了这一层）。
 *
 * <p>职责与 {@code NodeApiClient} 类似，但走的是另一套信任模型：
 * <ul>
 *   <li>不是用户身份，而是 {@code INTERNAL_API_SECRET} 的 HMAC（{@link InternalSigner}）；</li>
 *   <li>Node 侧还会校验「源 IP 必须是私网且命中白名单」，公网直连一律空 404；</li>
 *   <li>失败语义：404（Node 判定非内网/未生成）与 401（签名错/重放）要能区分，
 *       大屏据此决定"暂未生成"还是"配置错了"。</li>
 * </ul>
 */
@Component
public class InternalApiClient {

    private static final Logger log = LoggerFactory.getLogger(InternalApiClient.class);

    /** 内部接口的 JSON 与业务侧一致，但这里单独持有 mapper，避免被全局 SNAKE_CASE 影响。 */
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String EMPTY_BODY = "{}";

    /** 四个定时任务（与 Node 的 TIMER_NAMES 一一对应）。 */
    public static final String TASK_EXPIRE_ORDERS = "expire-orders";
    public static final String TASK_REFRESH_STOCK = "refresh-stock";
    public static final String TASK_SECKILL_TOGGLE = "seckill-toggle";
    public static final String TASK_DASHBOARD_PREAGG = "dashboard-preagg";

    private final RestClient client;
    private final InternalProperties properties;
    private final InternalSigner signer;
    private final String baseUrl;

    public InternalApiClient(@Qualifier("internalRestClient") RestClient client,
                             InternalProperties properties, InternalSigner signer) {
        this.client = client;
        this.properties = properties;
        this.signer = signer;
        String configured = properties.baseUrl() == null || properties.baseUrl().isBlank()
                ? "http://127.0.0.1:3001" : properties.baseUrl();
        this.baseUrl = configured.endsWith("/") ? configured.substring(0, configured.length() - 1) : configured;
    }

    /** 触发一次定时任务；同一分钟内的重复调用由 Node 复用首个结果（幂等）。 */
    public JsonNode runTimer(String task) {
        return call(HttpMethod.POST, "/internal/timers/" + task, EMPTY_BODY);
    }

    /** 读大屏预聚合快照（由 dashboard-preagg 任务覆盖写入 Redis）。 */
    public JsonNode dashboardPreagg() {
        return call(HttpMethod.GET, "/internal/dashboard/preagg", null);
    }

    private JsonNode call(HttpMethod method, String path, String bodyJson) {
        String secret = properties.secret();
        if (secret == null || secret.length() < 32) {
            // 配错不重试：没有密钥时任何重试都是白跑，直接让上层按 503 处理
            throw new NodeUnavailableException("内部接口密钥未配置（app.internal.secret / INTERNAL_API_SECRET，需 ≥32 字符）", null);
        }

        Map<String, String> headers = new LinkedHashMap<>();
        InternalSigner.Headers signed = signer.sign(method.name(), path, bodyJson, secret);
        headers.put("X-Timestamp", signed.timestamp());
        headers.put("X-Nonce", signed.nonce());
        headers.put("X-Internal-Key", signed.signature());
        if (bodyJson != null) {
            headers.put("Content-Type", MediaType.APPLICATION_JSON_VALUE);
        }

        try {
            URI target = URI.create(baseUrl + path);
            RestClient.RequestBodySpec spec = client.method(method).uri(target).headers(h -> headers.forEach(h::set));
            RestClient.RequestBodySpec withBody = bodyJson == null ? spec : spec.body(bodyJson);
            return withBody.exchange((request, response) -> {
                String text = readBody(response.getBody());
                return unwrap(method, path, response.getStatusCode().value(), text);
            });
        } catch (ResourceAccessException e) {
            throw new NodeUnavailableException("无法连接 Node 内部接口：" + method + " " + path, e);
        }
    }

    private JsonNode unwrap(HttpMethod method, String path, int status, String body) {
        if (body == null || body.isBlank()) {
            // Node 对非私网来源直接 res.status(404).end()，没有包络
            throw new NodeApiException(status, status == 404 ? 20016 : status,
                    "内部接口无响应体（HTTP " + status + "，检查源 IP 白名单）", null);
        }
        JsonNode envelope;
        try {
            envelope = JSON.readTree(body);
        } catch (JsonProcessingException e) {
            throw new NodeApiException(status, 50000, "内部接口响应不是合法 JSON", null);
        }
        JsonNode codeNode = envelope.get("code");
        if (codeNode != null && codeNode.asInt() != 0) {
            String message = envelope.path("message").asText("内部接口返回错误");
            log.warn("内部接口 {} {} 业务失败 code={} message={}", method, path, codeNode.asInt(), message);
            throw new NodeApiException(status, codeNode.asInt(), message, envelope.path("trace_id").asText(null));
        }
        if (status >= 400) {
            throw new NodeApiException(status, status, "内部接口失败（HTTP " + status + "）", null);
        }
        return envelope.has("data") ? envelope.get("data") : envelope;
    }

    private static String readBody(java.io.InputStream stream) {
        try {
            return stream == null ? null : new String(stream.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new NodeUnavailableException("读取内部接口响应失败", e);
        }
    }
}
