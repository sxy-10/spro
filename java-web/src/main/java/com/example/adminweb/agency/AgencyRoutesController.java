package com.example.adminweb.agency;

import com.example.adminweb.api.NodeApiClient;
import com.example.adminweb.web.ApiResult;
import com.example.adminweb.web.Sessions;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 线路（产品）页与线路表单页。
 *
 * <p>Node 侧只有列表 {@code GET /v1/admin/routes} 与写接口，没有"管理端单条详情"，
 * 而列表已经返回了表单需要的全部字段（title/destination/default_days/style_tag/base_price_rmb/status），
 * 所以编辑页用列表行数据回填即可，**不为一个字段去改 Node**（S1 冻结）。
 */
@RestController
public class AgencyRoutesController {

    private final NodeApiClient node;

    public AgencyRoutesController(NodeApiClient node) {
        this.node = node;
    }

    public record CreateRoute(String title, String destination, Integer defaultDays,
                              String styleTag, BigDecimal basePriceRmb) {
    }

    @GetMapping("/api/agency/routes")
    public ApiResult<JsonNode> list(@RequestParam(defaultValue = "1") int page,
                                    @RequestParam(defaultValue = "20") int size,
                                    @RequestParam(defaultValue = "-created_at") String sort,
                                    @RequestParam(required = false) String keyword,
                                    @RequestParam(required = false) String status,
                                    HttpServletRequest request) {
        Map<String, Object> params = AgencySupport.params();
        params.put("page", page);
        params.put("size", size);
        params.put("sort", sort);
        params.put("keyword", keyword);
        params.put("status", status);
        return ApiResult.ok(node.get("/v1/admin/routes" + AgencySupport.query(params), Sessions.requireToken(request)));
    }

    @PostMapping("/api/agency/routes")
    public ApiResult<JsonNode> create(@RequestBody CreateRoute body, HttpServletRequest request) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("title", body.title());
        payload.put("destination", body.destination());
        payload.put("default_days", body.defaultDays());
        payload.put("style_tag", body.styleTag());
        // Node 的 money 是字符串：数字 1999 会被 zod 拒成 400，这里统一转
        payload.put("base_price_rmb", AgencySupport.money(body.basePriceRmb()));
        return ApiResult.ok(node.post("/v1/admin/routes", payload, Sessions.requireToken(request)));
    }

    /** 只挑白名单字段转发；前端多传的字段不会漏到 Node（strict schema 会 400）。 */
    @PatchMapping("/api/agency/routes/{id}")
    public ApiResult<JsonNode> update(@PathVariable String id, @RequestBody JsonNode body, HttpServletRequest request) {
        Map<String, Object> payload = new LinkedHashMap<>();
        copy(body, payload, "title");
        copy(body, payload, "destination");
        copy(body, payload, "default_days");
        copy(body, payload, "style_tag");
        copy(body, payload, "status");
        copy(body, payload, "description");
        if (body.has("base_price_rmb")) {
            payload.put("base_price_rmb", AgencySupport.money(body.get("base_price_rmb").asText()));
        }
        return ApiResult.ok(node.patch("/v1/admin/routes/" + id, payload, Sessions.requireToken(request)));
    }

    private static void copy(JsonNode body, Map<String, Object> payload, String key) {
        if (body.has(key) && !body.get(key).isNull()) {
            JsonNode value = body.get(key);
            payload.put(key, value.isNumber() ? value.numberValue() : value.asText());
        }
    }
}
