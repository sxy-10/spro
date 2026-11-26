package com.example.adminweb.web;

import com.example.adminweb.api.NodeApiClient;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * 在线客服（接待台）的 REST 透传层。
 *
 * <p>本控制器**不实现任何业务规则**：会话归属、接单并发、SLA、权限码全部由 Node 判定，
 * 这里只做三件事——带上会话里的 Bearer token、把 query 原样拼过去、把包络的 data 交回前端。
 * 这样 Node 的 {@code requireAction} 仍然是唯一闸门，BFF 不会长出一套平行权限。
 *
 * <p>写请求走 {@link NodeApiClient#post}（签名 + 幂等键）；Node 的 IM 写接口都落在
 * {@code write()} 里，缺签名会直接 403/10001。
 */
@RestController
public class ImController {

    /** 接待动作白名单：避免把任意字符串拼进 Node 的 URL 路径。 */
    private static final Set<String> AGENT_ACTIONS = Set.of("claim", "release", "transfer", "close", "reopen");

    private final NodeApiClient node;

    public ImController(NodeApiClient node) {
        this.node = node;
    }

    /* ---------------- 接待队列 / 状态 ---------------- */

    @GetMapping("/api/im/agent/queue")
    public ApiResult<JsonNode> queue(@RequestParam(defaultValue = "pool") String scope,
                                     @RequestParam(defaultValue = "50") int size,
                                     @RequestParam(defaultValue = "-last_message_at") String sort,
                                     HttpServletRequest request) {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("scope", scope);
        params.put("size", size);
        params.put("sort", sort);
        return ApiResult.ok(node.get("/v1/im/agent/queue" + query(params), Sessions.requireToken(request)));
    }

    @GetMapping("/api/im/agent/ratings")
    public ApiResult<JsonNode> ratings(HttpServletRequest request) {
        return ApiResult.ok(node.get("/v1/im/agent/ratings", Sessions.requireToken(request)));
    }

    @GetMapping("/api/im/agent/status")
    public ApiResult<JsonNode> status(HttpServletRequest request) {
        return ApiResult.ok(node.get("/v1/im/agent/status", Sessions.requireToken(request)));
    }

    /* ---------------- 快捷话术 ---------------- */

    @GetMapping("/api/im/quick-replies")
    public ApiResult<JsonNode> quickReplies(HttpServletRequest request) {
        return ApiResult.ok(node.get("/v1/im/quick-replies", Sessions.requireToken(request)));
    }

    @PostMapping("/api/im/quick-replies")
    public ApiResult<JsonNode> createQuickReply(@RequestBody(required = false) JsonNode body,
                                                HttpServletRequest request) {
        return ApiResult.ok(node.post("/v1/im/quick-replies", body == null ? Map.of() : body,
                Sessions.requireToken(request)));
    }

    @DeleteMapping("/api/im/quick-replies/{id}")
    public ApiResult<JsonNode> deleteQuickReply(@PathVariable String id, HttpServletRequest request) {
        return ApiResult.ok(node.delete("/v1/im/quick-replies/" + numeric(id), Sessions.requireToken(request)));
    }

    /* ---------------- 在线状态 ---------------- */

    @GetMapping("/api/im/presence")
    public ApiResult<JsonNode> presence(@RequestParam(name = "user_ids", required = false) String userIds,
                                        HttpServletRequest request) {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("user_ids", userIds);
        return ApiResult.ok(node.get("/v1/im/presence" + query(params), Sessions.requireToken(request)));
    }

    /* ---------------- 会话消息 ---------------- */

    @GetMapping("/api/im/conversations/{id}/messages")
    public ApiResult<JsonNode> messages(@PathVariable String id,
                                        @RequestParam(name = "since_id", defaultValue = "0") long sinceId,
                                        HttpServletRequest request) {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("since_id", sinceId);
        return ApiResult.ok(node.get("/v1/im/conversations/" + numeric(id) + "/messages" + query(params),
                Sessions.requireToken(request)));
    }

    /** WS 不可用时的降级长轮询通道（前端 imWs 客户端的兜底路径）。 */
    @GetMapping("/api/im/poll")
    public ApiResult<JsonNode> poll(@RequestParam String convId,
                                    @RequestParam(defaultValue = "0") long since,
                                    HttpServletRequest request) {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("convId", numeric(convId));
        params.put("since", since);
        return ApiResult.ok(node.get("/v1/im/poll" + query(params), Sessions.requireToken(request)));
    }

    @PostMapping("/api/im/messages")
    public ApiResult<JsonNode> sendMessage(@RequestBody(required = false) JsonNode body,
                                           HttpServletRequest request) {
        // conversation_id / client_msg_id / content 的合法性由 Node 的 zod 校验，BFF 不重复实现
        return ApiResult.ok(node.post("/v1/im/messages", body == null ? Map.of() : body,
                Sessions.requireToken(request)));
    }

    @PostMapping("/api/im/messages/{id}/read")
    public ApiResult<JsonNode> markRead(@PathVariable String id, HttpServletRequest request) {
        return ApiResult.ok(node.post("/v1/im/messages/" + numeric(id) + "/read", Map.of(),
                Sessions.requireToken(request)));
    }

    /* ---------------- 接待动作 ---------------- */

    @PostMapping("/api/im/agent/conversations/{id}/{action}")
    public ApiResult<JsonNode> agentAction(@PathVariable String id,
                                           @PathVariable String action,
                                           @RequestBody(required = false) JsonNode body,
                                           HttpServletRequest request) {
        if (!AGENT_ACTIONS.contains(action)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "不支持的接待动作：" + action);
        }
        return ApiResult.ok(node.post("/v1/im/agent/conversations/" + numeric(id) + "/" + action,
                body == null ? Map.of() : body, Sessions.requireToken(request)));
    }

    /* ---------------- 小工具 ---------------- */

    /** 只放非空参数；Node 的 zod 对空串会直接 400，所以空值一律丢弃。 */
    private static String query(Map<String, Object> params) {
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<String, Object> entry : params.entrySet()) {
            Object value = entry.getValue();
            if (value == null || (value instanceof String s && s.isBlank())) {
                continue;
            }
            sb.append(sb.isEmpty() ? '?' : '&')
                    .append(URLEncoder.encode(entry.getKey(), StandardCharsets.UTF_8))
                    .append('=')
                    .append(URLEncoder.encode(String.valueOf(value), StandardCharsets.UTF_8));
        }
        return sb.toString();
    }

    /** Node 的 id 是 {@code z.string().regex(/^[1-9]\d{0,19}$/)}，本地先挡一道，错误更直观。 */
    private static String numeric(String value) {
        if (value == null || !value.matches("^[1-9]\\d{0,19}$")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "非法的 ID：" + value);
        }
        return value;
    }
}
