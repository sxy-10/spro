package com.example.adminweb.web;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.http.MediaType;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.security.web.csrf.CsrfException;

/**
 * 已登录但越权（或 CSRF 校验失败）：403 + JSON 包络。
 * CSRF 失败沿用 20013（错误码表暂未单列），但文案必须点明，否则组员会以为是权限配错。
 */
public class JsonAccessDeniedHandler implements AccessDeniedHandler {

    private final ObjectMapper objectMapper;

    public JsonAccessDeniedHandler(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @Override
    public void handle(HttpServletRequest request, HttpServletResponse response, AccessDeniedException ex)
            throws IOException {
        boolean csrfFailure = ex instanceof CsrfException;
        String message = csrfFailure
                ? "CSRF 校验失败：缺少或非法的 X-XSRF-TOKEN，请刷新页面后重试"
                : "权限不足，禁止访问";

        response.setStatus(HttpServletResponse.SC_FORBIDDEN);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        objectMapper.writeValue(response.getOutputStream(), ApiResult.error(20013, message));
    }
}
