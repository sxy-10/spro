package com.example.adminweb.realtime;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;

/**
 * 票根语义：一次性、30 秒过期、不可枚举。
 *
 * <p>这三条正是验收判据里的可演示项（「同一 ticket 第二次使用被拒；过期后连接被拒」），
 * 所以用具名用例把它们钉住：换票逻辑一旦改动，这里先红。
 */
class WsTicketServiceTest {

    /** 可拨动的时钟：过期行为不能靠 sleep 去等 30 秒。 */
    private static final class MutableClock extends Clock {
        private Instant now = Instant.parse("2026-11-28T02:00:00Z");

        void advance(Duration duration) {
            now = now.plus(duration);
        }

        @Override
        public ZoneOffset getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(java.time.ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }

    @Test
    void 票根只能消费一次且第二次直接拒绝() {
        WsTicketService service = new WsTicketService();
        WsTicketService.Ticket ticket = service.issue("node-token", "7");

        assertThat(ticket.value()).hasSize(43);
        assertThat(ticket.accessToken()).isEqualTo("node-token");
        assertThat(ticket.userId()).isEqualTo("7");

        assertThat(service.consume(ticket.value())).isPresent();
        assertThat(service.consume(ticket.value())).as("重放同一 ticket 必须被拒").isEmpty();
    }

    @Test
    void 超过三十秒的票根视为过期() {
        MutableClock clock = new MutableClock();
        WsTicketService service = new WsTicketService(clock);
        WsTicketService.Ticket ticket = service.issue("node-token", "7");

        clock.advance(Duration.ofSeconds(29));
        assertThat(service.consume(ticket.value())).isPresent();

        WsTicketService.Ticket second = service.issue("node-token", "7");
        clock.advance(Duration.ofSeconds(31));
        assertThat(service.consume(second.value())).as("过期票根必须被拒").isEmpty();
    }

    @Test
    void 每次签发的票根都不同且不存在的票根被拒() {
        WsTicketService service = new WsTicketService();
        String first = service.issue("t", "1").value();
        String second = service.issue("t", "1").value();

        assertThat(first).isNotEqualTo(second);
        assertThat(service.consume("not-a-real-ticket")).isEmpty();
        assertThat(service.consume(null)).isEmpty();
    }

    @Test
    void 过期票根不会留在内存里() {
        MutableClock clock = new MutableClock();
        WsTicketService service = new WsTicketService(clock);
        service.issue("t", "1");
        clock.advance(Duration.ofHours(1));
        service.issue("t", "2"); // 再次签发时顺带清理
        assertThat(service.liveCount()).isEqualTo(1);
    }
}
