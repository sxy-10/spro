package com.example.adminweb.web;

import com.example.adminweb.security.AdminUser;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 会话信息：SPA 用它渲染侧边栏与权限按钮。
 *
 * <p>返回体里**没有任何 token**——access/refresh token 只存在于 Java 服务端的 Session 中。
 * 未登录时不会走到这里，由 {@link JsonAuthEntryPoint} 统一返回 401/20012。
 */
@RestController
public class MeController {

    @GetMapping("/api/me")
    public ApiResult<Map<String, Object>> me(@AuthenticationPrincipal AdminUser user) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("user_id", user.userId());
        data.put("username", user.username());
        data.put("roles", user.roles());
        // 真实实现：登录时调 Node /users/me/permissions，把 menus/buttons 存进 Session，这里下发
        data.put("menus", List.of());
        data.put("buttons", List.of());
        return ApiResult.ok(data);
    }
}
