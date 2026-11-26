package com.example.adminweb.im;

import com.example.adminweb.web.Sessions;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;

/**
 * 把浏览器会话里的 Node token 交给 WS 桥接器。
 *
 * <p>握手是一次普通 GET，Spring Security 已经按 {@code JSESSIONID} 放行；
 * 这里只负责把 token 从 HttpSession 里取出来塞进 WS 会话属性 ——
 * 浏览器全程看不到 token，桥接器拿着它去连 Node。
 */
@Component
public class ImWsHandshakeInterceptor implements HandshakeInterceptor {

    /** WS 会话属性名：桥接器用它取 token。 */
    public static final String TOKEN_ATTRIBUTE = "nodeToken";

    @Override
    public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response,
                                   WebSocketHandler wsHandler, Map<String, Object> attributes) {
        if (!(request instanceof ServletServerHttpRequest servletRequest)) {
            response.setStatusCode(HttpStatus.BAD_REQUEST);
            return false;
        }
        String token = Sessions.token(servletRequest.getServletRequest());
        if (token == null || token.isBlank()) {
            // 会话过期：明确回 401，前端据此停止重连并跳登录页（而不是无限退避）
            response.setStatusCode(HttpStatus.UNAUTHORIZED);
            return false;
        }
        attributes.put(TOKEN_ATTRIBUTE, token);
        return true;
    }

    @Override
    public void afterHandshake(ServerHttpRequest request, ServerHttpResponse response,
                               WebSocketHandler wsHandler, Exception exception) {
        // 无需处理
    }
}
