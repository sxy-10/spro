package com.example.adminweb.web;

import com.example.adminweb.security.AdminUser;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.context.annotation.Profile;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 【骨架期临时登录口】仅 dev profile 生效。
 *
 * <p>真实实现：{@code POST /api/auth/login} → 校验图形验证码 → 调 Node {@code /auth/login/account}
 * → 把 access/refresh token 存进 Session → 再调 {@code /users/me/permissions} 拉 menus/buttons。
 * 现在先用它把「会话 + CSRF + 同源」这条链路演示通，接完 Node 后**整个类删掉**。
 */
@RestController
@Profile("dev")
@RequestMapping("/api/auth")
public class DevAuthController {

    private final SecurityContextRepository securityContextRepository;

    public DevAuthController(SecurityContextRepository securityContextRepository) {
        this.securityContextRepository = securityContextRepository;
    }

    public record DevLoginRequest(String username, String password) {
    }

    @PostMapping("/dev-login")
    public ApiResult<Map<String, Object>> devLogin(@RequestBody(required = false) DevLoginRequest body,
                                                   HttpServletRequest request,
                                                   HttpServletResponse response) {
        String username = (body == null || body.username() == null || body.username().isBlank())
                ? "admin" : body.username().trim();
        List<String> roles = username.startsWith("super")
                ? List.of("SUPER_ADMIN")
                : List.of("AGENCY_ADMIN");

        AdminUser principal = new AdminUser("dev-" + username, username, roles);
        UsernamePasswordAuthenticationToken authentication =
                UsernamePasswordAuthenticationToken.authenticated(principal, null, principal.getAuthorities());

        SecurityContext context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(authentication);
        SecurityContextHolder.setContext(context);
        // 必须显式保存：Spring Security 6 已不再由过滤器自动回写 Session
        securityContextRepository.saveContext(context, request, response);

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("user_id", principal.userId());
        data.put("username", principal.username());
        data.put("roles", roles);
        data.put("dev_mode", true);
        return ApiResult.ok(data);
    }
}
