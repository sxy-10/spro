package com.example.adminweb.internal;

import java.util.Map;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 内部接口（S4 侧配置，对应 T11 的 Java 半边）。
 *
 * <p>三样东西必须与 Node 的 {@code internalRouter.ts} 逐字对齐，否则签名必挂：
 * <ul>
 *   <li>{@code baseUrl}：Node 内网地址（默认与 {@code app.node.base-url} 相同）；</li>
 *   <li>{@code secret}：独立密钥 {@code INTERNAL_API_SECRET}（≥32 字符），
 *       <b>只放 application.yml / 环境变量，不进任何前端产物</b>；</li>
 *   <li>{@code timers}：四个任务的 cron 表达式（Quartz 六段格式，第一段是秒）。</li>
 * </ul>
 *
 * <p>{@code timersEnabled=false} 时不注册任何 Quartz Job —— 手工压测或验收
 * "关掉预聚合任务后大屏数字停更"时，直接改这一个开关即可，不用改代码。
 *
 * <p>{@code failTask} 是演示专用的"人为故障注入"开关：填上某个任务名，该任务每次执行都会
 * 在调用 Node 之前抛异常，用来当场演示「单任务失败不影响其他三个」。生产保持空串。
 */
@ConfigurationProperties(prefix = "app.internal")
public record InternalProperties(
        String baseUrl,
        String secret,
        boolean timersEnabled,
        Map<String, String> timers,
        String failTask) {

    /** 默认频率与《定时任务清单》一致；yml 没配某项时用它兜底。 */
    public String cronFor(String task) {
        String configured = timers == null ? null : timers.get(task);
        if (configured != null && !configured.isBlank()) {
            return configured.trim();
        }
        return switch (task) {
            case "expire-orders" -> "*/10 * * * * ?";     // 每 10 秒
            case "refresh-stock" -> "0 */5 * * * ?";      // 每 5 分钟
            case "seckill-toggle" -> "0 * * * * ?";       // 每 1 分钟
            case "dashboard-preagg" -> "0 */5 * * * ?";   // 每 5 分钟
            default -> throw new IllegalArgumentException("未定义的定时任务：" + task);
        };
    }
}
