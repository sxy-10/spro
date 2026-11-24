package com.example.adminweb.web;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** 健康探针：SPA 启动时用它确认「同源 + 包络 + trace_id」链路是通的（免登录）。 */
@RestController
public class PingController {

    @GetMapping("/api/ping")
    public ApiResult<Map<String, Object>> ping() {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("app", "admin-web");
        data.put("framework", "Spring Boot 3.3");
        data.put("runtime", "Java " + System.getProperty("java.version"));
        data.put("time", Instant.now().toString());
        return ApiResult.ok(data);
    }
}
