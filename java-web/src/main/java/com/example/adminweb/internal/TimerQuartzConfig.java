package com.example.adminweb.internal;

import org.quartz.CronExpression;
import org.quartz.CronScheduleBuilder;
import org.quartz.JobBuilder;
import org.quartz.JobDetail;
import org.quartz.Trigger;
import org.quartz.TriggerBuilder;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 四个定时任务的 Quartz 装配（S4 任务 4 的 Java 半边）。
 *
 * <p>为什么用 Quartz 而不是裸 {@code @Scheduled}（依赖在 S2 就已冻结进 pom）：
 * <ul>
 *   <li>cron 表达式可配置，改频率不用改代码、不用重新认识注解语义；</li>
 *   <li>每个任务独立 JobKey 与 misfire 策略，一个任务失败（甚至配错）不牵连其他三个；</li>
 *   <li>错过的触发点默认 {@code DoNothing}，不会在启动瞬间补跑一堆——定时任务都是幂等的，
 *       补跑没收益，反而会在启动时把 Node 打满。</li>
 * </ul>
 *
 * <p>整个配置受 {@code app.internal.timers-enabled} 控制：设为 false 时不注册任何 Job，
 * 用于验收「关掉预聚合任务后大屏数字停更」以及纯压测场景。
 */
@Configuration
@ConditionalOnProperty(prefix = "app.internal", name = "timers-enabled", havingValue = "true", matchIfMissing = true)
public class TimerQuartzConfig {

    private static final String GROUP = "s4-timers";

    /* ---------------- JobDetail ---------------- */

    @Bean
    public JobDetail expireOrdersJob() {
        return jobDetail(InternalApiClient.TASK_EXPIRE_ORDERS);
    }

    @Bean
    public JobDetail refreshStockJob() {
        return jobDetail(InternalApiClient.TASK_REFRESH_STOCK);
    }

    @Bean
    public JobDetail seckillToggleJob() {
        return jobDetail(InternalApiClient.TASK_SECKILL_TOGGLE);
    }

    @Bean
    public JobDetail dashboardPreaggJob() {
        return jobDetail(InternalApiClient.TASK_DASHBOARD_PREAGG);
    }

    /* ---------------- Trigger ---------------- */

    @Bean
    public Trigger expireOrdersTrigger(JobDetail expireOrdersJob, InternalProperties properties) {
        return trigger(expireOrdersJob, properties);
    }

    @Bean
    public Trigger refreshStockTrigger(JobDetail refreshStockJob, InternalProperties properties) {
        return trigger(refreshStockJob, properties);
    }

    @Bean
    public Trigger seckillToggleTrigger(JobDetail seckillToggleJob, InternalProperties properties) {
        return trigger(seckillToggleJob, properties);
    }

    @Bean
    public Trigger dashboardPreaggTrigger(JobDetail dashboardPreaggJob, InternalProperties properties) {
        return trigger(dashboardPreaggJob, properties);
    }

    /* ---------------- 构造工具 ---------------- */

    private static JobDetail jobDetail(String task) {
        return JobBuilder.newJob(TimerJob.class)
                .withIdentity(jobKey(task), GROUP)
                .usingJobData(TimerJob.TASK_KEY, task)
                .withDescription("调 POST /internal/timers/" + task + "（签名在服务端）")
                .storeDurably()
                .build();
    }

    private static Trigger trigger(JobDetail job, InternalProperties properties) {
        String task = job.getJobDataMap().getString(TimerJob.TASK_KEY);
        String cron = properties.cronFor(task);
        if (!CronExpression.isValidExpression(cron)) {
            // 启动即失败，比"看起来在跑其实永不触发"好排查得多
            throw new IllegalStateException("定时任务 " + task + " 的 cron 表达式非法：" + cron);
        }
        return TriggerBuilder.newTrigger()
                .withIdentity("trigger-" + task, GROUP)
                .forJob(job)
                .withDescription(cron)
                .withSchedule(CronScheduleBuilder.cronSchedule(cron)
                        .withMisfireHandlingInstructionDoNothing())
                .build();
    }

    static String jobKey(String task) {
        return "timer-" + task;
    }
}
