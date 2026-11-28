package com.example.adminweb.realtime;

import com.example.adminweb.security.AdminUser;
import com.example.adminweb.web.ApiResult;
import com.example.adminweb.web.Sessions;
import jakarta.servlet.http.HttpServletRequest;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 长连接换票口：{@code POST /api/realtime/ticket}（S4 任务 1）。
 *
 * <p>为什么用 POST 而不是 GET：它是"产生一个凭证"的写动作，必须受 CSRF 保护
 * （前端 {@code lib/http.ts} 会自动带 {@code X-XSRF-TOKEN}）；GET 会被缓存、
 * 会被浏览器预取，票根一旦被预取就等于泄漏。
 *
 * <p>响应体刻意只包含票根与两个路径，**不包含任何 token**：从这里往后，
 * 浏览器能拿到的唯一凭证就是这串一次性随机值。
 */
@RestController
public class WsTicketController {

    private static final Logger log = LoggerFactory.getLogger(WsTicketController.class);

    private final WsTicketService tickets;

    public WsTicketController(WsTicketService tickets) {
        this.tickets = tickets;
    }

    @PostMapping("/api/realtime/ticket")
    public ApiResult<Map<String, Object>> issue(HttpServletRequest request, Authentication authentication) {
        // 先要有效会话：没登录就没资格换票（401 / 20012 由统一异常出口处理）
        String accessToken = Sessions.requireToken(request);

        String userId = "unknown";
        if (authentication != null && authentication.getPrincipal() instanceof AdminUser user) {
            userId = user.userId() == null ? "unknown" : user.userId();
        }
        WsTicketService.Ticket ticket = tickets.issue(accessToken, userId);

        Map<String, Object> data = new LinkedHashMap<>();
        data.put("ticket", ticket.value());
        data.put("expires_in", ticket.expiresInSeconds(System.currentTimeMillis()));
        data.put("ws_path", "/api/im/ws");
        data.put("sse_path", "/api/stats/live");
        log.info("签发实时票根 user={} remaining={}", userId, tickets.liveCount());
        return ApiResult.ok(data);
    }
}
