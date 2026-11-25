package com.example.adminweb.agency;

import com.example.adminweb.api.NodeApiClient;
import com.example.adminweb.web.ApiResult;
import com.example.adminweb.web.Sessions;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
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

    private final NodeApiClient node;

    public AgencyDashboardController(NodeApiClient node) {
        this.node = node;
    }

    @GetMapping("/api/agency/dashboard")
    public ApiResult<JsonNode> dashboard(HttpServletRequest request) {
        return ApiResult.ok(node.get("/v1/admin/dashboard", Sessions.requireToken(request)));
    }

    /**
     * 大屏只读预聚合（S4 轮询它，不直连 Node）。
     *
     * <p>固定 4 个数字的契约先由本阶段定死，S4 只换数据源（Redis {@code dashboard:preagg}）不改字段：
     * {@code onsale_count / today_orders / pending_confirms / today_amount}。
     */
    @GetMapping("/api/agency/dashboard-metrics")
    public ApiResult<Map<String, Object>> dashboardMetrics(HttpServletRequest request) {
        JsonNode dashboard = node.get("/v1/admin/dashboard", Sessions.requireToken(request));
        JsonNode kpi = dashboard.path("kpi");

        Map<String, Object> metrics = new LinkedHashMap<>();
        metrics.put("onsale_count", kpi.path("onsale_count").asInt());
        metrics.put("today_orders", kpi.path("today_orders").asInt());
        metrics.put("pending_confirms", kpi.path("pending_confirms").asInt());
        metrics.put("today_amount", kpi.path("today_amount").asText("0"));
        metrics.put("generated_at", Instant.now().toString());
        return ApiResult.ok(metrics);
    }
}
