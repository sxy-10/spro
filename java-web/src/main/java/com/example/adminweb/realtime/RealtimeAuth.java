package com.example.adminweb.realtime;

import com.example.adminweb.web.Sessions;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/**
 * 长连接的鉴权入口：优先认票根，其次认会话。
 *
 * <ul>
 *   <li><b>票根路径（前端默认）</b>：{@code ?ticket=xxx}，一次性、30 秒有效；</li>
 *   <li><b>会话路径（排障兼容）</b>：没有 ticket 参数时按 {@code JSESSIONID} 取 token，
 *       方便 wscat / curl 现场排查，不改变"浏览器不接触 token"这条红线。</li>
 * </ul>
 *
 * 两条路径最终都拿到同一个东西：Node 的 access token（只在服务端使用）。
 */
public final class RealtimeAuth {

    private RealtimeAuth() {
    }

    public static String resolve(HttpServletRequest request, WsTicketService tickets) {
        String raw = request.getParameter("ticket");
        if (raw != null && !raw.isBlank()) {
            return tickets.consume(raw)
                    .map(WsTicketService.Ticket::accessToken)
                    .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED,
                            "票根无效、已被使用或已过期，请重新换票"));
        }
        return Sessions.requireToken(request);
    }
}
