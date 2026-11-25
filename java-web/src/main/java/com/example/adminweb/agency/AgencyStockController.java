package com.example.adminweb.agency;

import com.example.adminweb.api.NodeApiClient;
import com.example.adminweb.web.ApiResult;
import com.example.adminweb.web.Sessions;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * 库存页：查某条线路未来 14 天的名额、按日期改名额。
 *
 * <p>本轮**不提供"触发预热"按钮**：{@code refresh-stock} 是 Node 的 {@code /internal/timers/*} 内部接口，
 * 需要 X-Internal-Key 签名，那套密钥与调用方由 S4（定时器 Java 半边）统一实现，避免两个阶段各写一套。
 */
@RestController
public class AgencyStockController {

    private final NodeApiClient node;

    public AgencyStockController(NodeApiClient node) {
        this.node = node;
    }

    public record StockUpdate(String travelDate, Integer totalSeats) {
    }

    @GetMapping("/api/agency/stock/{routeId}")
    public ApiResult<JsonNode> view(@PathVariable String routeId, HttpServletRequest request) {
        return ApiResult.ok(node.get("/v1/admin/routes/" + routeId + "/stock", Sessions.requireToken(request)));
    }

    @PutMapping("/api/agency/stock/{routeId}")
    public ApiResult<JsonNode> update(@PathVariable String routeId,
                                      @RequestBody StockUpdate body,
                                      HttpServletRequest request) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("travel_date", body.travelDate());
        payload.put("total_seats", body.totalSeats());
        return ApiResult.ok(node.put("/v1/admin/routes/" + routeId + "/stock", payload, Sessions.requireToken(request)));
    }
}
