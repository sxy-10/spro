package com.example.adminweb.internal;

import com.fasterxml.jackson.databind.JsonNode;
import org.quartz.DisallowConcurrentExecution;
import org.quartz.Job;
import org.quartz.JobExecutionContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 四个定时任务共用同一个 Job 实现，靠 JobDataMap 里的 {@code task} 区分。
 *
 * <p>为什么是一个类而不是四个：任务体本身在 Node（事务、Redis 预聚合都在那边），
 * Java 这边只负责「按时触发 + 记录耗时/结果 + 失败不扩散」。四个类的 90% 代码会重复。
 *
 * <p>两条纪律：
 * <ol>
 *   <li>{@link DisallowConcurrentExecution}：同一任务不允许上一轮没跑完就叠下一轮
 *       （Node 侧还有分钟级锁，两层保护）；</li>
 *   <li>异常在这里吃掉、只记日志与台账，<b>不向上抛</b>：Quartz 里抛异常只会让该 Job
 *       进入失败计数并触发 misfire，其他三个 Job 完全独立，不吃连带影响。</li>
 * </ol>
 *
 * <p>依赖注入方式必须用**字段注入**：Quartz 先用无参构造反射建实例，再由 Spring Boot 的
 * {@code AutowireCapableBeanJobFactory} 调 {@code autowireBean(...)} 注入 {@code @Autowired} 字段。
 * 换成构造器注入会在第一次触发时报 "No default constructor found"（运行期才炸，测试发现不了）。
 */
@DisallowConcurrentExecution
public class TimerJob implements Job {

    /** JobDataMap 里的任务名键；与 Node 的 TIMER_NAMES 完全同名。 */
    public static final String TASK_KEY = "task";

    private static final Logger log = LoggerFactory.getLogger(TimerJob.class);

    @Autowired
    private InternalApiClient internal;

    @Autowired
    private TimerStatusRegistry status;

    @Autowired
    private InternalProperties properties;

    public TimerJob() {
        // Quartz 反射建实例用
    }

    @Override
    public void execute(JobExecutionContext context) {
        String task = context.getMergedJobDataMap().getString(TASK_KEY);
        if (task == null || task.isBlank()) {
            log.warn("定时任务配置缺失：JobDataMap 里没有 task，key={}", context.getJobDetail().getKey());
            return;
        }

        long startedAtMillis = System.currentTimeMillis();
        String startedAt = TimerStatusRegistry.nowIso();
        try {
            // 演示开关：app.internal.fail-task 指向谁，谁就必然失败（用于验收「单任务不影响其他三个」）
            if (properties.failTask() != null && task.equals(properties.failTask().trim())) {
                throw new IllegalStateException("演示用故障注入：" + task + " 于 " + startedAt);
            }
            JsonNode result = internal.runTimer(task);
            long cost = System.currentTimeMillis() - startedAtMillis;
            String summary = result == null ? "{}" : result.toString();
            log.info("定时任务 成功 task={} 耗时={}ms 结果={}", task, cost, summary);
            status.record(new TimerStatusRegistry.Run(task, startedAt, cost, true,
                    TimerStatusRegistry.abbreviate(summary)));
        } catch (Exception error) {
            long cost = System.currentTimeMillis() - startedAtMillis;
            String reason = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
            log.error("定时任务 失败 task={} 耗时={}ms 原因={}", task, cost, reason);
            status.record(new TimerStatusRegistry.Run(task, startedAt, cost, false,
                    TimerStatusRegistry.abbreviate(reason)));
            // 有意不 throw：把失败留在本任务，其他三个照常按自己的 cron 跑
        }
    }
}
