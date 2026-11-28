package com.example.adminweb.im;

import com.example.adminweb.realtime.WsTicketService;
import com.example.adminweb.web.Sessions;
import java.util.Map;
import java.util.Optional;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;

/**
 * 握手鉴权：把「一次性票根」换成「Node token」，交给 WS 桥接器。
 *
 * <p>两条准入路径（与 {@link com.example.adminweb.realtime.RealtimeAuth} 语义一致）：
 * <ol>
 *   <li>{@code /api/im/ws?ticket=...} —— 前端默认走这条。票根一次性、30 秒有效，
 *       消费失败（重复使用 / 已过期 / 不存在）一律 401，浏览器据此停止重连；</li>
 *   <li>无 ticket 参数时回落到 {@code JSESSIONID} 会话 —— 只为 wscat / curl 排障保留。</li>
 * </ol>
 *
 * <p>浏览器全程看不到 token：它只会看到自己刚换到的那串随机票根。
 */
@Component
public class ImWsHandshakeInterceptor implements HandshakeInterceptor {

    /** WS 会话属性名：桥接器用它取 token。 */
    public static final String TOKEN_ATTRIBUTE = "nodeToken";
    /** 票根来源标记，只用于日志区分"走票"还是"走会话"。 */
    public static final String TICKET_ATTRIBUTE = "ticketUsed";

    private final WsTicketService tickets;

    public ImWsHandshakeInterceptor(WsTicketService tickets) {
        this.tickets = tickets;
    }

    @Override
    public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response,
                                   WebSocketHandler wsHandler, Map<String, Object> attributes) {
        if (!(request instanceof ServletServerHttpRequest servletRequest)) {
            response.setStatusCode(HttpStatus.BAD_REQUEST);
            return false;
        }
        String rawTicket = ticketParam(servletRequest.getServletRequest().getQueryString());
        if (rawTicket != null && !rawTicket.isBlank()) {
            Optional<WsTicketService.Ticket> consumed = tickets.consume(rawTicket);
            if (consumed.isEmpty()) {
                // 一次性票根被重放或已过期：明确 401，前端不再重试（重试也没有意义）
                response.setStatusCode(HttpStatus.UNAUTHORIZED);
                return false;
            }
            attributes.put(TOKEN_ATTRIBUTE, consumed.get().accessToken());
            attributes.put(TICKET_ATTRIBUTE, Boolean.TRUE);
            return true;
        }

        String token = Sessions.token(servletRequest.getServletRequest());
        if (token == null || token.isBlank()) {
            // 会话过期：明确回 401，前端据此停止重连并跳登录页（而不是无限退避）
            response.setStatusCode(HttpStatus.UNAUTHORIZED);
            return false;
        }
        attributes.put(TOKEN_ATTRIBUTE, token);
        attributes.put(TICKET_ATTRIBUTE, Boolean.FALSE);
        return true;
    }

    @Override
    public void afterHandshake(ServerHttpRequest request, ServerHttpResponse response,
                               WebSocketHandler wsHandler, Exception exception) {
        // 无需处理
    }

    /**
     * 从原始 query string 里取 ticket。
     *
     * <p>不用 {@code request.getParameter}：Spring 的 WS 握手请求在某些容器下参数解析
     * 与 {@code @RequestParam} 不一致；票根是 Base64URL（无 {@code + / =}），不需要 URL 解码。
     */
    static String ticketParam(String queryString) {
        if (queryString == null || queryString.isBlank()) {
            return null;
        }
        for (String pair : queryString.split("&")) {
            int eq = pair.indexOf('=');
            if (eq <= 0) {
                continue;
            }
            if ("ticket".equals(pair.substring(0, eq))) {
                return pair.substring(eq + 1);
            }
        }
        return null;
    }
}
