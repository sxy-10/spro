package com.example.adminweb.web;

import com.example.adminweb.security.AdminUser;
import com.example.adminweb.security.SessionKeys;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 会话信息：SPA 用它渲染侧边栏与权限按钮。
 *
 * <p>menus/buttons 是**登录时**从 Node {@code /v1/users/me/permissions} 取下来的快照，
 * 存在 Session 里而不是每次页面刷新都打 Node —— 页面级聚合的原则是"一页一请求"，
 * 不能因为渲染菜单再多打一次 Node。改角色后需要重新登录才生效（与 Node 的权限缓存一致）。
 *
 * <p>返回体里没有任何 token：浏览器只持 JSESSIONID 与 XSRF-TOKEN。
 */
@RestController
public class MeController {

    private final ObjectMapper objectMapper;

    public MeController(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @GetMapping("/api/me")
    public ApiResult<Map<String, Object>> me(@AuthenticationPrincipal AdminUser user, HttpServletRequest request) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("user_id", user.userId());
        data.put("username", user.username());
        data.put("roles", user.roles());

        HttpSession session = request.getSession(false);
        JsonNode permissions = read(session, SessionKeys.PERMISSIONS_JSON);
        data.put("menus", permissions == null ? List.of() : permissions.path("menus"));
        data.put("buttons", permissions == null ? List.of() : permissions.path("buttons"));
        return ApiResult.ok(data);
    }

    private JsonNode read(HttpSession session, String key) {
        if (session == null) {
            return null;
        }
        Object value = session.getAttribute(key);
        if (!(value instanceof String json) || json.isBlank()) {
            return null;
        }
        try {
            return objectMapper.readTree(json);
        } catch (JsonProcessingException e) {
            return null;
        }
    }
}
