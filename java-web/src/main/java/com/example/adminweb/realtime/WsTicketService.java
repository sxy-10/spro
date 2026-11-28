package com.example.adminweb.realtime;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.util.Base64;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/**
 * 一次性票根仓库：浏览器换取、网关消费，30 秒有效、用后作废。
 *
 * <p>为什么需要它：浏览器只持 {@code JSESSIONID}，而长连接（WS / SSE）跑在
 * 容器线程之外，还要在握手阶段就完成鉴权。把 Node 的 Bearer token 塞进
 * 连接 URL 等于把凭证交给前端；直接依赖 Cookie 又无法证明"这条连接是刚才那次换票的"。
 * 折中的做法是：浏览器 POST 换一张随机票根（URL 里只有票根），网关在握手时
 * 原子地取出并删除票根记录，再拿记录里的 token 去连 Node。
 *
 * <p>三条红线：
 * <ol>
 *   <li><b>票根只存服务端内存</b>：记录里有 token，但 token 从不出现在任何响应体；</li>
 *   <li><b>consume 是原子的</b>：{@code ConcurrentHashMap.remove} 成功即视为消费，
 *       第二次用同一票根必然拿不到记录 → 401（验收判据「同一 ticket 第二次使用被拒」）；</li>
 *   <li><b>过期即失效</b>：30 秒 TTL 由 issue 时的时间戳决定，消费时再校验一次，
 *       不依赖定时清理（清理只是防止内存无限增长）。</li>
 * </ol>
 */
@Component
public class WsTicketService {

    /** 票根有效期：30 秒（规范 §5.4）。取值要大于"换票 → 建连"的网络耗时，又不能长到能被复用。 */
    public static final Duration TTL = Duration.ofSeconds(30);

    /** 内存上限保护：只有未消费的票根会留在表里，正常量级是"正在建连的人数"。 */
    private static final int MAX_TICKETS = 4096;

    private final Clock clock;
    private final SecureRandom random = new SecureRandom();
    private final Map<String, Ticket> tickets = new ConcurrentHashMap<>();

    public WsTicketService() {
        this(Clock.systemUTC());
    }

    WsTicketService(Clock clock) {
        this.clock = clock;
    }

    /**
     * 一张票根。{@code accessToken} 只在本进程里流转，永远不会出现在 HTTP 响应中。
     */
    public record Ticket(String value, String accessToken, String userId, long issuedAtMillis, long expiresAtMillis) {

        public boolean expired(long nowMillis) {
            return nowMillis >= expiresAtMillis;
        }

        public long expiresInSeconds(long nowMillis) {
            return Math.max(0, (expiresAtMillis - nowMillis) / 1000);
        }
    }

    /** 签发一张票根：32 字节随机（Base64URL 43 字符），不可预测、不可枚举。 */
    public Ticket issue(String accessToken, String userId) {
        long now = clock.millis();
        sweep(now, true);
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        String value = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        Ticket ticket = new Ticket(value, accessToken, userId, now, now + TTL.toMillis());
        tickets.put(value, ticket);
        return ticket;
    }

    /**
     * 消费一张票根。返回空表示：不存在 / 已被用过 / 已过期 —— 三种情况对调用方是同一种结果，
     * 不给攻方区分的机会。
     */
    public Optional<Ticket> consume(String value) {
        if (value == null || value.isBlank()) {
            return Optional.empty();
        }
        Ticket ticket = tickets.remove(value);
        if (ticket == null) {
            return Optional.empty();
        }
        long now = clock.millis();
        if (ticket.expired(now)) {
            return Optional.empty();
        }
        return Optional.of(ticket);
    }

    /** 未消费的票根数量（健康检查 / 单元测试用）。 */
    public int liveCount() {
        return tickets.size();
    }

    /** 清理过期票根；{@code aggressive} 为真时顺便做容量保护。 */
    private void sweep(long nowMillis, boolean aggressive) {
        tickets.values().removeIf(ticket -> ticket.expired(nowMillis));
        if (aggressive && tickets.size() > MAX_TICKETS) {
            // 极端情况下（有人只换票不建连）直接清空，宁让在途连接重取一次票
            tickets.clear();
        }
    }
}
