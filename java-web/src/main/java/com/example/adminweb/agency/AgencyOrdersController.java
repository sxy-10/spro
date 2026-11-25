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
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 订单页：列表、详情（含后端判定的时间线）、确认处理。 */
@RestController
public class AgencyOrdersController {

    private final NodeApiClient node;

    public AgencyOrdersController(NodeApiClient node) {
        this.node = node;
    }

    public record ConfirmOrder(String remark) {
    }

    @GetMapping("/api/agency/orders")
    public ApiResult<JsonNode> list(@RequestParam(defaultValue = "1") int page,
                                    @RequestParam(defaultValue = "20") int size,
                                    @RequestParam(defaultValue = "-created_at") String sort,
                                    @RequestParam(required = false) String status,
                                    @RequestParam(required = false) String keyword,
                                    HttpServletRequest request) {
        Map<String, Object> params = AgencySupport.params();
        params.put("page", page);
        params.put("size", size);
        params.put("sort", sort);
        params.put("status", status);
        params.put("keyword", keyword);
        return ApiResult.ok(node.get("/v1/admin/orders" + AgencySupport.query(params), Sessions.requireToken(request)));
    }

    @GetMapping("/api/agency/orders/{id}")
    public ApiResult<JsonNode> detail(@PathVariable String id, HttpServletRequest request) {
        return ApiResult.ok(node.get("/v1/admin/orders/" + id, Sessions.requireToken(request)));
    }

    @PostMapping("/api/agency/orders/{id}/confirm")
    public ApiResult<JsonNode> confirm(@PathVariable String id,
                                       @RequestBody(required = false) ConfirmOrder body,
                                       HttpServletRequest request) {
        Map<String, Object> payload = new LinkedHashMap<>();
        if (body != null && body.remark() != null && !body.remark().isBlank()) {
            payload.put("remark", body.remark().trim());
        }
        return ApiResult.ok(node.post("/v1/admin/orders/" + id + "/confirm", payload, Sessions.requireToken(request)));
    }
}
