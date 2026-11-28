package com.example.adminweb.agency;

import com.example.adminweb.api.NodeApiClient;
import com.example.adminweb.api.NodeApiException;
import com.example.adminweb.internal.InternalApiClient;
import com.example.adminweb.web.ApiResult;
import com.example.adminweb.web.Sessions;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 工作台：1 个页面 = 1 个业务请求。
 *
 * <p>{@code /api/agency/dashboard} 一次拿回 KPI、14 天趋势、Top 线路、待办、最近订单，
 * 前端不再分别请求 5 个 Node 接口（那是"转发器"的写法，不是 BFF）。
 */
@RestController
public class AgencyDashboardController {

    private static final Logger log = LoggerFactory.getLogger(AgencyDashboardController.class);

    private final NodeApiClient node;
    private final InternalApiClient internal;

    public AgencyDashboardController(NodeApiClient node, InternalApiClient internal) {
        this.node = node;
        this.internal = internal;
    }

    @GetMapping("/api/agency/dashboard")
    public ApiResult<JsonNode> dashboard(HttpServletRequest request) {
        return ApiResult.ok(node.get("/v1/admin/dashboard", Sessions.requireToken(request)));
    }

    /**
     * 大屏只读预聚合（S4，D9 口径）。
     *
     * <p>S3 阶段这里是"每次读都现算"，S4 换成读 Redis 的 {@code dashboard:preagg}：
     * 数字由 {@code dashboard-preagg} 定时任务每 5 分钟覆盖写，前端只轮询这份快照。
     * 因此<b>关掉预聚合任务</b>后 {@code generated_at} 与四个数字一起停住 —— 这正是验收判据
     * 「停掉预聚合任务数字停更，恢复后继续更新」要看到的现象。
     *
     * <p>三种状态刻意分得开，避免"配置错了"被误读成"还没生成"：
     * <ul>
     *   <li>{@code source=preagg}：正常，带预聚合生成时间；</li>
     *   <li>{@code source=preagg_pending}：任务还没跑过（Redis 里没有 key），数字为 0；</li>
     *   <li>抛 401/503：密钥或内网白名单配错，页面会明确报错，不会假装 0。</li>
     * </ul>
     */
    @GetMapping("/api/agency/dashboard-metrics")
    public ApiResult<Map<String, Object>> dashboardMetrics(HttpServletRequest request) {
        // 预聚合不是公开数据：大屏仍要求登录，只是数据源从"现算"换成"读快照"
        Sessions.requireToken(request);

        JsonNode preagg;
        try {
            preagg = internal.dashboardPreagg();
        } catch (NodeApiException e) {
            if (e.httpStatus() == 404 || e.code() == 20016) {
                // Redis 里还没有 dashboard:preagg：任务未跑过或刚被清空
                preagg = null;
            } else {
                throw e;
            }
        }

        Map<String, Object> metrics = new LinkedHashMap<>();
        if (preagg == null || preagg.isNull() || preagg.isEmpty()) {
            metrics.put("onsale_count", 0);
            metrics.put("today_orders", 0);
            metrics.put("pending_confirms", 0);
            metrics.put("today_amount", "0.00");
            metrics.put("generated_at", null);
            metrics.put("source", "preagg_pending");
            return ApiResult.ok(metrics);
        }

        metrics.put("onsale_count", preagg.path("active_routes").asInt());
        metrics.put("today_orders", preagg.path("today_orders").asInt());
        metrics.put("pending_confirms", preagg.path("pending_confirms").asInt());
        metrics.put("today_amount", amount(preagg.path("today_revenue")));
        metrics.put("generated_at", preagg.path("generated_at").isMissingNode()
                ? null : preagg.path("generated_at").asText(null));
        metrics.put("source", "preagg");
        log.debug("大屏预聚合快照 generated_at={}", metrics.get("generated_at"));
        return ApiResult.ok(metrics);
    }

    /** DECIMAL 在 Node 侧一律是字符串；这里只做"两位小数"的展示口径，不改数值。 */
    private static String amount(JsonNode node) {
        if (node == null || node.isMissingNode() || node.isNull()) {
            return "0.00";
        }
        try {
            return new BigDecimal(node.asText("0")).setScale(2, java.math.RoundingMode.HALF_UP).toPlainString();
        } catch (NumberFormatException e) {
            return "0.00";
        }
    }
}
