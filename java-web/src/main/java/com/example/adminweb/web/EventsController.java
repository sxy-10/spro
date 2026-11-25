package com.example.adminweb.web;

import com.example.adminweb.api.NodeApiClient;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * SPA 埋点透传：浏览器 → Java → Node {@code /v1/events} → Kafka {@code rec.events}。
 *
 * <p>为什么不让浏览器直连 Node：浏览器侧不允许出现 Node 的 token（只持 Cookie），
 * 而 Node 的埋点接口在带 Authorization 时会校验 userId 与登录用户一致，
 * 所以身份必须由 Java 补上。匿名埋点（未登录）也允许透传，与 Node 的 optionalAuthenticate 行为一致。
 *
 * <p>契约不要求同步成功：Node 收到即返回 202，Kafka 失败只写日志，不能阻塞页面。
 */
@RestController
public class EventsController {

    private final NodeApiClient node;

    public EventsController(NodeApiClient node) {
        this.node = node;
    }

    @PostMapping("/api/events")
    public ApiResult<JsonNode> forward(@RequestBody JsonNode body, HttpServletRequest request) {
        String token = Sessions.token(request);
        return ApiResult.ok(node.postForward("/v1/events", body, token));
    }
}
