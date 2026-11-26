package com.example.adminweb.platform;

import com.example.adminweb.api.NodeApiClient;
import com.example.adminweb.web.ApiResult;
import com.example.adminweb.web.Sessions;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.servlet.http.HttpServletRequest;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * 平台端治理接口（/platform/agencies 旅行社管理 + /platform/users 账号管理）的 BFF 层。
 *
 * <p>与 {@code ImController} 同一原则：不实现任何业务规则，权限码（system:agency:* /
 * system:user:* / system:role:query）全部由 Node 的 {@code requireAction} 判定；
 * 这里只做 token 透传、参数转发、字段名转换。
 *
 * <p>两个域的写接口在 Node 都落在幂等写（write()）里，{@link NodeApiClient} 会自动
 * 补 HMAC 签名与 Idempotency-Key，前端只带 XSRF。
 */
@RestController
public class PlatformController {

    private final NodeApiClient node;

    public PlatformController(NodeApiClient node) {
        this.node = node;
    }

    /* ==================== 总览大盘 ==================== */

    /**
     * 平台工作台大盘：GET /v1/platform/overview（权限码 order:manage:query，super 已授予）。
     * 只读聚合查询，无写操作；kpi 十项指标 + 14 天趋势 + 热销线路 Top5 + 目的地热度 Top5。
     */
    @GetMapping("/api/platform/overview")
    public ApiResult<JsonNode> overview(HttpServletRequest request) {
        return ApiResult.ok(node.get("/v1/platform/overview", Sessions.requireToken(request)));
    }

    /* ==================== 旅行社管理 ==================== */

    @GetMapping("/api/platform/agencies")
    public ApiResult<JsonNode> agencies(@RequestParam(defaultValue = "1") int page,
                                        @RequestParam(defaultValue = "20") int size,
                                        @RequestParam(defaultValue = "-created_at") String sort,
                                        @RequestParam(required = false) String keyword,
                                        @RequestParam(required = false) String status,
                                        HttpServletRequest request) {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("page", page);
        params.put("size", size);
        params.put("sort", sort);
        params.put("keyword", keyword);
        params.put("status", status);
        return ApiResult.ok(node.get("/v1/platform/agencies" + query(params), Sessions.requireToken(request)));
    }

    @GetMapping("/api/platform/agencies/{id}")
    public ApiResult<JsonNode> agencyDetail(@PathVariable String id, HttpServletRequest request) {
        return ApiResult.ok(node.get("/v1/platform/agencies/" + numeric(id), Sessions.requireToken(request)));
    }

    /** 新增 / 编辑共用字段：Node 的 zod（agencyInput）负责校验，这里只做透传。 */
    public record AgencyBody(String agencyName, String licenseNo,
                             String contactName, String contactPhone, String intro) {
    }

    @PostMapping("/api/platform/agencies")
    public ApiResult<JsonNode> createAgency(@RequestBody AgencyBody body, HttpServletRequest request) {
        return ApiResult.ok(node.post("/v1/platform/agencies", agencyPayload(body, false),
                Sessions.requireToken(request)));
    }

    @PutMapping("/api/platform/agencies/{id}")
    public ApiResult<JsonNode> updateAgency(@PathVariable String id, @RequestBody AgencyBody body,
                                            HttpServletRequest request) {
        return ApiResult.ok(node.put("/v1/platform/agencies/" + numeric(id),
                agencyPayload(body, true), Sessions.requireToken(request)));
    }

    /** 启停用：Node 会同步机构名下管理员账号的状态，这是它的内部规则，BFF 不重复。 */
    public record AgencyStatus(String status) {
    }

    @PatchMapping("/api/platform/agencies/{id}")
    public ApiResult<JsonNode> toggleAgency(@PathVariable String id, @RequestBody AgencyStatus body,
                                            HttpServletRequest request) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("status", body.status());
        return ApiResult.ok(node.patch("/v1/platform/agencies/" + numeric(id), payload,
                Sessions.requireToken(request)));
    }

    /* ==================== 账号管理 ==================== */

    /** 角色下拉数据源：GET /v1/roles（RBAC 域挂根路径，权限码 system:role:query，super 已授予）。 */
    @GetMapping("/api/platform/roles")
    public ApiResult<JsonNode> roles(HttpServletRequest request) {
        return ApiResult.ok(node.get("/v1/roles", Sessions.requireToken(request)));
    }

    @GetMapping("/api/platform/users")
    public ApiResult<JsonNode> users(@RequestParam(defaultValue = "1") int page,
                                     @RequestParam(defaultValue = "20") int size,
                                     @RequestParam(defaultValue = "-created_at") String sort,
                                     @RequestParam(required = false) String keyword,
                                     @RequestParam(name = "user_type", required = false) String userType,
                                     @RequestParam(required = false) String status,
                                     @RequestParam(required = false) String agencyId,
                                     HttpServletRequest request) {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("page", page);
        params.put("size", size);
        params.put("sort", sort);
        params.put("keyword", keyword);
        params.put("user_type", userType);
        params.put("status", status);
        params.put("agency_id", agencyId);
        return ApiResult.ok(node.get("/v1/platform/users" + query(params), Sessions.requireToken(request)));
    }

    /** 新建后台账号：走 RBAC（POST /v1/admin/users，权限码 system:user:add）。 */
    public record CreateUserBody(String mobile, String password, String nickname,
                                 java.util.List<String> roleIds) {
    }

    @PostMapping("/api/platform/users")
    public ApiResult<JsonNode> createUser(@RequestBody CreateUserBody body, HttpServletRequest request) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("mobile", body.mobile());
        payload.put("password", body.password());
        putIfPresent(payload, "nickname", body.nickname());
        payload.put("role_ids", body.roleIds());
        return ApiResult.ok(node.post("/v1/admin/users", payload, Sessions.requireToken(request)));
    }

    /** 编辑昵称 + 全量覆盖角色：PUT /v1/admin/users/:id（status 用 ENABLED/DISABLED 口径）。 */
    public record UpdateUserBody(String nickname, java.util.List<String> roleIds) {
    }

    @PutMapping("/api/platform/users/{id}")
    public ApiResult<JsonNode> updateUser(@PathVariable String id, @RequestBody UpdateUserBody body,
                                          HttpServletRequest request) {
        Map<String, Object> payload = new LinkedHashMap<>();
        putIfPresent(payload, "nickname", body.nickname());
        payload.put("role_ids", body.roleIds());
        return ApiResult.ok(node.put("/v1/admin/users/" + numeric(id), payload,
                Sessions.requireToken(request)));
    }

    /** 启停用：PATCH /v1/platform/users/:id（status 用 ACTIVE/DISABLED 口径，禁用即撤销会话）。 */
    public record UserStatus(String status) {
    }

    @PatchMapping("/api/platform/users/{id}")
    public ApiResult<JsonNode> toggleUser(@PathVariable String id, @RequestBody UserStatus body,
                                          HttpServletRequest request) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("status", body.status());
        return ApiResult.ok(node.patch("/v1/platform/users/" + numeric(id), payload,
                Sessions.requireToken(request)));
    }

    /* ==================== 订单监督（全量只读） ==================== */

    @GetMapping("/api/platform/orders")
    public ApiResult<JsonNode> orders(@RequestParam(defaultValue = "1") int page,
                                      @RequestParam(defaultValue = "20") int size,
                                      @RequestParam(defaultValue = "-created_at") String sort,
                                      @RequestParam(required = false) String keyword,
                                      @RequestParam(required = false) String status,
                                      @RequestParam(required = false) String agencyId,
                                      HttpServletRequest request) {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("page", page);
        params.put("size", size);
        params.put("sort", sort);
        params.put("keyword", keyword);
        params.put("status", status);
        params.put("agency_id", agencyId);
        return ApiResult.ok(node.get("/v1/platform/orders" + query(params), Sessions.requireToken(request)));
    }

    /* ==================== 财务与结算 ==================== */

    @GetMapping("/api/platform/finance/summary")
    public ApiResult<JsonNode> financeSummary(HttpServletRequest request) {
        return ApiResult.ok(node.get("/v1/platform/finance/summary", Sessions.requireToken(request)));
    }

    @GetMapping("/api/platform/settlements")
    public ApiResult<JsonNode> settlements(@RequestParam(defaultValue = "1") int page,
                                           @RequestParam(defaultValue = "20") int size,
                                           @RequestParam(defaultValue = "-created_at") String sort,
                                           @RequestParam(required = false) String status,
                                           HttpServletRequest request) {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("page", page);
        params.put("size", size);
        params.put("sort", sort);
        params.put("status", status);
        return ApiResult.ok(node.get("/v1/platform/settlements" + query(params), Sessions.requireToken(request)));
    }

    /** 确认结算：Node 幂等写（write()），重复确认返回 409「已结算」。 */
    @PostMapping("/api/platform/settlements/{id}/confirm")
    public ApiResult<JsonNode> confirmSettlement(@PathVariable String id, HttpServletRequest request) {
        return ApiResult.ok(node.post("/v1/platform/settlements/" + numeric(id) + "/confirm", Map.of(),
                Sessions.requireToken(request)));
    }

    @GetMapping("/api/platform/refunds")
    public ApiResult<JsonNode> refunds(HttpServletRequest request) {
        return ApiResult.ok(node.get("/v1/platform/refunds", Sessions.requireToken(request)));
    }

    /* ==================== 数据分析中心 ==================== */

    /** days 仅接受 7/30/90（Node zod 校验），BFF 不重复实现白名单。 */
    @GetMapping("/api/platform/analytics")
    public ApiResult<JsonNode> analytics(@RequestParam(defaultValue = "30") int days,
                                         HttpServletRequest request) {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("days", days);
        return ApiResult.ok(node.get("/v1/platform/analytics" + query(params), Sessions.requireToken(request)));
    }

    /* ==================== 内容审核 ==================== */

    @GetMapping("/api/platform/audits")
    public ApiResult<JsonNode> audits(@RequestParam(defaultValue = "1") int page,
                                      @RequestParam(defaultValue = "20") int size,
                                      @RequestParam(defaultValue = "-updated_at") String sort,
                                      @RequestParam(defaultValue = "route") String type,
                                      @RequestParam(name = "audit_status", defaultValue = "PENDING") String auditStatus,
                                      @RequestParam(required = false) String keyword,
                                      HttpServletRequest request) {
        Map<String, Object> params = new LinkedHashMap<>();
        params.put("page", page);
        params.put("size", size);
        params.put("sort", sort);
        params.put("type", type);
        params.put("audit_status", auditStatus);
        params.put("keyword", keyword);
        return ApiResult.ok(node.get("/v1/platform/audits" + query(params), Sessions.requireToken(request)));
    }

    /**
     * 审核动作：真正的闸门在 Node —— 写事务内用 Casbin 判定
     * route:line:audit（线路）/ route:souvenir:audit（特产），BFF 不重复实现。
     */
    @PostMapping("/api/platform/audits/{type}/{id}")
    public ApiResult<JsonNode> audit(@PathVariable String type,
                                     @PathVariable String id,
                                     @RequestBody(required = false) Map<String, Object> body,
                                     HttpServletRequest request) {
        Map<String, Object> payload = new LinkedHashMap<>();
        if (body != null) {
            Object result = body.get("result");
            if (result != null) payload.put("result", result);
            Object remark = body.get("remark");
            if (remark != null && !String.valueOf(remark).isBlank()) payload.put("remark", remark);
        }
        return ApiResult.ok(node.post("/v1/platform/audits/" + type + "/" + numeric(id), payload,
                Sessions.requireToken(request)));
    }

    /* ==================== AI 智能服务 ==================== */

    @GetMapping("/api/platform/ai-service")
    public ApiResult<JsonNode> aiService(HttpServletRequest request) {
        return ApiResult.ok(node.get("/v1/platform/ai-service", Sessions.requireToken(request)));
    }

    /** 大模型连通性自检（真实发起一次极小请求，Node 侧 20s 超时）。 */
    @PostMapping("/api/platform/ai-service/test")
    public ApiResult<JsonNode> aiServiceTest(HttpServletRequest request) {
        return ApiResult.ok(node.post("/v1/platform/ai-service/test", Map.of(), Sessions.requireToken(request)));
    }

    /** 配置写：persona / model_params / tools 五开关（Node JSON_MERGE_PATCH 合并，部分更新安全）。 */
    @PutMapping("/api/platform/ai-service/config")
    public ApiResult<JsonNode> aiServiceConfig(@RequestBody(required = false) Map<String, Object> body,
                                               HttpServletRequest request) {
        Map<String, Object> payload = new LinkedHashMap<>();
        if (body != null) {
            for (String key : new String[] {"persona", "model_params"}) {
                Object value = body.get(key);
                if (value != null && !String.valueOf(value).isBlank()) payload.put(key, value);
            }
            Object tools = body.get("tools");
            if (tools instanceof Map<?, ?> toolMap && !toolMap.isEmpty()) payload.put("tools", toolMap);
        }
        return ApiResult.ok(node.put("/v1/platform/ai-service/config", payload, Sessions.requireToken(request)));
    }

    /* ==================== 系统元数据 ==================== */

    @GetMapping("/api/platform/system-meta")
    public ApiResult<JsonNode> systemMeta(HttpServletRequest request) {
        return ApiResult.ok(node.get("/v1/platform/system-meta", Sessions.requireToken(request)));
    }

    /* ==================== 小工具 ==================== */

    /** 只放非空参数；Node 的 zod 对空串会直接 400，空值一律丢弃。 */
    private static String query(Map<String, Object> params) {
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<String, Object> entry : params.entrySet()) {
            Object value = entry.getValue();
            if (value == null || (value instanceof String s && s.isBlank())) {
                continue;
            }
            sb.append(sb.isEmpty() ? '?' : '&')
                    .append(urlEncode(entry.getKey()))
                    .append('=')
                    .append(urlEncode(String.valueOf(value)));
        }
        return sb.toString();
    }

    /** 新增（全字段必填校验交给 Node）与编辑（partial）共用；空字符串转 null，且 null 不进 payload——
     * Node 的 zod optional 只接受字段缺失，显式 null 会直接 400。 */
    private static Map<String, Object> agencyPayload(AgencyBody body, boolean partial) {
        Map<String, Object> payload = new LinkedHashMap<>();
        putIfPresent(payload, "agency_name", body.agencyName());
        putIfPresent(payload, "license_no", body.licenseNo());
        putIfPresent(payload, "contact_name", body.contactName());
        putIfPresent(payload, "contact_phone", body.contactPhone());
        putIfPresent(payload, "intro", body.intro());
        if (!partial) {
            for (String key : new String[] {"agency_name", "license_no"}) {
                if (!payload.containsKey(key)) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "机构名称与许可证号为必填项");
                }
            }
        }
        return payload;
    }

    private static void putIfPresent(Map<String, Object> payload, String key, String value) {
        if (value != null && !value.isBlank()) {
            payload.put(key, value.trim());
        }
    }

    /** Node 的 id 是 z.string().regex(/^[1-9]\d{0,19}$/)，本地先挡一道，错误更直观。 */
    private static String numeric(String value) {
        if (value == null || !value.matches("^[1-9]\\d{0,19}$")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "非法的 ID：" + value);
        }
        return value;
    }

    private static String urlEncode(String value) {
        return java.net.URLEncoder.encode(value, java.nio.charset.StandardCharsets.UTF_8);
    }
}
