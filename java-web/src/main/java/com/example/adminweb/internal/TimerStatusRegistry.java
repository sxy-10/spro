package com.example.adminweb.internal;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/**
 * 定时任务运行台账（内存，重启即清空）。
 *
 * <p>为什么需要它：验收判据要求"日志有任务名、耗时、结果"，也要能当场演示
 * "人为让一个任务抛异常，其他三个照常"。slf4j 日志是给运维看的，
 * 这个台账是给演示页/接口看的同一份事实，两者字段刻意保持一致：
 * {@code task / started_at / duration_ms / ok / message}。
 */
@Component
public class TimerStatusRegistry {

    public record Run(String task, String startedAt, long durationMs, boolean ok, String message) {
    }

    private final Map<String, Run> latest = new ConcurrentHashMap<>();

    public void record(Run run) {
        latest.put(run.task(), run);
    }

    /** 按任务名排序的快照，前端/验收脚本直接可读。 */
    public Map<String, Run> snapshot() {
        Map<String, Run> ordered = new LinkedHashMap<>();
        for (String task : new String[]{InternalApiClient.TASK_EXPIRE_ORDERS,
                InternalApiClient.TASK_REFRESH_STOCK,
                InternalApiClient.TASK_SECKILL_TOGGLE,
                InternalApiClient.TASK_DASHBOARD_PREAGG}) {
            Run run = latest.get(task);
            if (run != null) {
                ordered.put(task, run);
            }
        }
        latest.forEach(ordered::putIfAbsent);
        return ordered;
    }

    /** 失败原因只留前 300 字符：足够定位，又不至于把整段 Node trace 打进内存。 */
    public static String abbreviate(String message) {
        if (message == null) {
            return "";
        }
        return message.length() > 300 ? message.substring(0, 300) + "…" : message;
    }

    public static String nowIso() {
        return Instant.now().toString();
    }
}
