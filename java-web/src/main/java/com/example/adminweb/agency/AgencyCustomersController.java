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
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 客户页：与本社产生过下单行为的游客、客户画像、回访备注。 */
@RestController
public class AgencyCustomersController {

    private final NodeApiClient node;

    public AgencyCustomersController(NodeApiClient node) {
        this.node = node;
    }

    public record CustomerNote(String note) {
    }

    @GetMapping("/api/agency/customers")
    public ApiResult<JsonNode> list(@RequestParam(defaultValue = "1") int page,
                                    @RequestParam(defaultValue = "20") int size,
                                    @RequestParam(defaultValue = "-last_order_at") String sort,
                                    @RequestParam(required = false) String keyword,
                                    HttpServletRequest request) {
        Map<String, Object> params = AgencySupport.params();
        params.put("page", page);
        params.put("size", size);
        params.put("sort", sort);
        params.put("keyword", keyword);
        return ApiResult.ok(node.get("/v1/admin/customers" + AgencySupport.query(params), Sessions.requireToken(request)));
    }

    @GetMapping("/api/agency/customers/{id}")
    public ApiResult<JsonNode> detail(@PathVariable String id, HttpServletRequest request) {
        return ApiResult.ok(node.get("/v1/admin/customers/" + id, Sessions.requireToken(request)));
    }

    @PutMapping("/api/agency/customers/{id}/note")
    public ApiResult<JsonNode> note(@PathVariable String id,
                                    @RequestBody CustomerNote body,
                                    HttpServletRequest request) {
        Map<String, Object> payload = new LinkedHashMap<>();
        // 允许清空备注（Node 的 note 是 min(0)），所以空串也要发
        payload.put("note", body.note() == null ? "" : body.note());
        return ApiResult.ok(node.put("/v1/admin/customers/" + id + "/note", payload, Sessions.requireToken(request)));
    }
}
