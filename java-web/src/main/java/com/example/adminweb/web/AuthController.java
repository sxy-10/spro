package com.example.adminweb.web;

import com.example.adminweb.api.NodeApiClient;
import com.example.adminweb.api.NodeApiException;
import com.example.adminweb.security.AdminUser;
import com.example.adminweb.security.NodeSession;
import com.example.adminweb.security.SessionKeys;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * 登录链路：浏览器 → Java（会话）→ Node（唯一账号来源）。
 *
 * <p>三步都必须成功才算登录：验证码换票 → 拉 /users/me → 拉 /users/me/permissions。
 * 任何一步失败都不建立会话，避免出现"登录了却什么菜单都没有"的半残状态。
 */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private static final Logger log = LoggerFactory.getLogger(AuthController.class);

    private final NodeApiClient node;
    private final SecurityContextRepository securityContextRepository;
    private final ObjectMapper objectMapper;

    public AuthController(NodeApiClient node,
                          SecurityContextRepository securityContextRepository,
                          ObjectMapper objectMapper) {
        this.node = node;
        this.securityContextRepository = securityContextRepository;
        this.objectMapper = objectMapper;
    }

    /** 账号 + 密码 + 图形验证码；验证码 id 走请求头（与 Node 契约一致，不能放 body）。 */
    public record LoginRequest(String account, String password, String captchaCode) {
    }

    @GetMapping("/captcha")
    public ApiResult<JsonNode> captcha() {
        return ApiResult.ok(node.getAnonymous("/v1/auth/captcha"));
    }

    @PostMapping("/login")
    public ApiResult<Map<String, Object>> login(@RequestBody LoginRequest body,
                                                @RequestHeader(value = "X-Captcha-Id", required = false) String captchaId,
                                                HttpServletRequest request,
                                                HttpServletResponse response) {
        if (body == null || isBlank(body.account()) || isBlank(body.password()) || isBlank(body.captchaCode())) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "账号、密码、验证码都不能为空");
        }
        if (isBlank(captchaId)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "图形验证码已失效，请点击图片刷新后重试");
        }

        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("account", body.account().trim());
        payload.put("password", body.password());
        payload.put("captcha_code", body.captchaCode().trim());

        JsonNode tokens = node.postAnonymous("/v1/auth/login/account", payload, Map.of("X-Captcha-Id", captchaId));
        String token = tokens.path("token").asText(null);
        if (token == null || token.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Node 登录响应缺少 token");
        }
        String refreshToken = tokens.path("refresh_token").asText(null);

        // 只有拿到 token 之后才继续；下面两次调用任何一次失败都会抛出，不会留下半登录会话
        JsonNode profile = node.get("/v1/users/me", token);
        JsonNode permissions = node.get("/v1/users/me/permissions", token);

        List<String> roles = new ArrayList<>();
        for (JsonNode role : profile.path("roles")) {
            String code = role.path("code").asText(null);
            if (code != null && !code.isBlank()) {
                roles.add(code);
            }
        }
        String userId = profile.path("user_id").asText(tokens.path("user_id").asText(""));
        String displayName = profile.path("nickname").asText(body.account().trim());

        AdminUser principal = new AdminUser(userId, displayName, roles);

        // 防会话固定：认证成功必须换一个新的 session id。
        // 必须先 getSession(true)：首次登录请求通常还没有 Session，直接 changeSessionId() 会抛 IllegalStateException
        HttpSession session = request.getSession(true);
        request.changeSessionId();
        long expiresInSeconds = tokens.path("expires_in").asLong(1800);
        session.setAttribute(SessionKeys.NODE_SESSION,
                new NodeSession(token, refreshToken, System.currentTimeMillis() + expiresInSeconds * 1000));
        session.setAttribute(SessionKeys.PROFILE_JSON, toJson(profile));
        session.setAttribute(SessionKeys.PERMISSIONS_JSON, toJson(permissions));

        UsernamePasswordAuthenticationToken authentication =
                UsernamePasswordAuthenticationToken.authenticated(principal, null, principal.getAuthorities());
        SecurityContext context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(authentication);
        SecurityContextHolder.setContext(context);
        // Spring Security 6 不再自动回写 Session，必须显式保存
        securityContextRepository.saveContext(context, request, response);

        log.info("登录成功 user={} roles={} menuRoots={}", userId, roles, permissions.path("menus").size());

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("user_id", userId);
        data.put("username", displayName);
        data.put("roles", roles);
        data.put("menus", permissions.path("menus"));
        data.put("buttons", permissions.path("buttons"));
        return ApiResult.ok(data);
    }

    @PostMapping("/logout")
    public ApiResult<Map<String, Object>> logout(HttpServletRequest request, HttpServletResponse response) {
        String token = token(request);
        if (token != null) {
            try {
                // 让 Node 吊销 api_session，而不是只丢浏览器 Cookie
                node.post("/v1/auth/logout", Map.of(), token);
            } catch (RuntimeException e) {
                log.warn("Node 登出失败（本地会话仍会清除）：{}", e.getMessage());
            }
        }

        SecurityContext empty = SecurityContextHolder.createEmptyContext();
        SecurityContextHolder.setContext(empty);
        securityContextRepository.saveContext(empty, request, response);
        SecurityContextHolder.clearContext();

        HttpSession session = request.getSession(false);
        if (session != null) {
            session.invalidate();
        }
        return ApiResult.ok(Map.of("logged_out", true));
    }

    private static String token(HttpServletRequest request) {
        HttpSession session = request.getSession(false);
        if (session == null) {
            return null;
        }
        Object value = session.getAttribute(SessionKeys.NODE_SESSION);
        return value instanceof NodeSession nodeSession ? nodeSession.accessToken() : null;
    }

    private String toJson(JsonNode node) {
        try {
            return objectMapper.writeValueAsString(node);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("权限结构无法序列化", e);
        }
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }
}
