package com.example.adminweb.web;

import com.example.adminweb.security.NodeSession;
import com.example.adminweb.security.SessionKeys;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** 控制器取 Node token 的唯一入口：拿不到就是 401，不要各自 new 异常。 */
public final class Sessions {

    private Sessions() {
    }

    public static String requireToken(HttpServletRequest request) {
        String token = token(request);
        if (token == null || token.isBlank()) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "未登录或会话已过期");
        }
        return token;
    }

    public static String token(HttpServletRequest request) {
        HttpSession session = request.getSession(false);
        if (session == null) {
            return null;
        }
        Object value = session.getAttribute(SessionKeys.NODE_SESSION);
        if (value instanceof NodeSession nodeSession) {
            if (nodeSession.isExpired(System.currentTimeMillis())) {
                session.invalidate();
                return null;
            }
            return nodeSession.accessToken();
        }
        return null;
    }
}
