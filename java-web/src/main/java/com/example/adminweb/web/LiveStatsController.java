package com.example.adminweb.web;

import com.example.adminweb.api.NodeStreamClient;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * 运营实时大屏：把 Node 的 {@code GET /v1/stats/live}（SSE）原样转给浏览器。
 *
 * <p>为什么要 BFF 中转而不是让浏览器直连 Node：
 * 浏览器只持 {@code JSESSIONID}，拿不到 Node 的 Bearer token；token 一旦下发前端就等于把签名密钥交出去。
 *
 * <p>流的三条纪律（与 Node 侧 statsRouter 的承诺对齐）：
 * <ol>
 *   <li>不攒批、不缓存：Node 每 5s 推一拍，这里收到就立刻转发；</li>
 *   <li>单拍失败不断流：Node 推 {@code event: error} 也照常转发，前端红闪后等下一拍；</li>
 *   <li>浏览器断开要掐断上游：{@code onCompletion/onTimeout/onError} 全部走 cancel，
 *       否则关掉页面后 Node 仍在为一个没人看的流跑聚合 SQL。</li>
 * </ol>
 */
@RestController
public class LiveStatsController {

    private static final Logger log = LoggerFactory.getLogger(LiveStatsController.class);

    private final NodeStreamClient streams;

    public LiveStatsController(NodeStreamClient streams) {
        this.streams = streams;
    }

    @GetMapping(value = "/api/stats/live", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter live(HttpServletRequest request) {
        // 必须在当前请求线程里取 token：SseEmitter 的回调线程没有 SecurityContext
        String token = Sessions.requireToken(request);

        // 0L = 不超时。服务端 Node 每 5s 一拍，30s 无数据由浏览器侧的看门狗判死并重连。
        SseEmitter emitter = new SseEmitter(0L);
        AtomicReference<NodeStreamClient.SseHandle> handleRef = new AtomicReference<>();
        AtomicBoolean finished = new AtomicBoolean(false);

        Runnable cancelUpstream = () -> {
            if (finished.compareAndSet(false, true)) {
                NodeStreamClient.SseHandle handle = handleRef.get();
                if (handle != null) {
                    handle.close();
                }
            }
        };

        emitter.onCompletion(cancelUpstream);
        emitter.onTimeout(cancelUpstream);
        emitter.onError(throwable -> cancelUpstream.run());

        try {
            NodeStreamClient.SseHandle handle = streams.openSse("/v1/stats/live", token, new NodeStreamClient.SseHandler() {
                @Override
                public void onEvent(String event, String data) {
                    if (finished.get()) {
                        return;
                    }
                    try {
                        emitter.send(SseEmitter.event().name(event).data(data));
                    } catch (IOException | IllegalStateException sendFailed) {
                        // 浏览器已经走了（关页面 / 断网）：停上游，别让 Node 继续白跑
                        cancelUpstream.run();
                        emitter.complete();
                    }
                }

                @Override
                public void onClosed(String reason) {
                    if (finished.compareAndSet(false, true)) {
                        log.info("大屏 SSE 上游结束：{}", reason);
                        emitter.complete();
                    }
                }
            });
            handleRef.set(handle);
            if (finished.get()) {
                // 极短时间内就失败（例如 401）：避免 handle 泄漏
                handle.close();
            }
        } catch (RuntimeException error) {
            log.warn("大屏 SSE 打开失败：{}", error.getMessage());
            emitter.completeWithError(error);
        }

        return emitter;
    }
}
