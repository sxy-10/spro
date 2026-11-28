package com.example.adminweb.internal;

import com.example.adminweb.web.ApiResult;
import com.fasterxml.jackson.databind.JsonNode;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * 定时任务的手动触发与台账（演示/排障入口，浏览器可用，路径在 /api 下）。
 *
 * <p>与 Quartz 的关系：Quartz 是"按时自动跑"，这里是"当场手跑一次"，两者最终都调
 * {@link InternalApiClient#runTimer}，因此签名、幂等口径完全一致 —— 演示时不用等 cron。
 *
 * <p>注意命名：{@code /api/internal/timers} 是**给浏览器/演示用的 BFF 接口**，
 * 不是 Node 的 {@code /internal/timers}（那条路径公网 404，浏览器永远碰不到）。
 * 这里仍然要过会话认证，不额外开权限码：能登录后台的人本来就看得见定时任务台账。
 */
@RestController
@RequestMapping("/api/internal/timers")
public class TimerTriggerController {

    private static final Logger log = LoggerFactory.getLogger(TimerTriggerController.class);

    private static final Set<String> TASKS = Set.of(
            InternalApiClient.TASK_EXPIRE_ORDERS,
            InternalApiClient.TASK_REFRESH_STOCK,
            InternalApiClient.TASK_SECKILL_TOGGLE,
            InternalApiClient.TASK_DASHBOARD_PREAGG);

    private final InternalApiClient internal;
    private final TimerStatusRegistry status;
    private final InternalProperties properties;

    public TimerTriggerController(InternalApiClient internal, TimerStatusRegistry status,
                                  InternalProperties properties) {
        this.internal = internal;
        this.status = status;
        this.properties = properties;
    }

    /** 手动跑一次；返回 Node 的任务结果（同一分钟内重复调用会拿到同一份结果）。 */
    @PostMapping("/{task}")
    public ApiResult<JsonNode> run(@PathVariable String task) {
        if (!TASKS.contains(task)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "未定义的定时任务：" + task);
        }
        return ApiResult.ok(internal.runTimer(task));
    }

    /** 台账：每个任务最近一次的任务名 / 开始时间 / 耗时 / 是否成功 / 结果摘要。 */
    @GetMapping
    public ApiResult<Map<String, Object>> status() {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("timers_enabled", properties.timersEnabled());
        data.put("fail_task", properties.failTask() == null ? "" : properties.failTask());
        data.put("timers", status.snapshot());
        return ApiResult.ok(data);
    }
}
