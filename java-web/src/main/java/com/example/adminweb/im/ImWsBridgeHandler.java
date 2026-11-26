package com.example.adminweb.im;

import com.example.adminweb.api.NodeStreamClient;
import java.io.IOException;
import java.net.URI;
import java.net.http.WebSocket;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;
import org.springframework.web.socket.handler.TextWebSocketHandler;

/**
 * 浏览器 {@code /api/im/ws} ↔ Node {@code /v1/im/ws} 的双向桥。
 *
 * <p>为什么必须桥接：客服台的实时性（msg / notify / ack_ok 帧）靠 WS，
 * 而新架构下浏览器只持 Cookie，拿不到 Node 的 Bearer token。桥接器在服务端
 * 用会话里的 token 连 Node，浏览器对 Node 完全无感。
 *
 * <p>四条边界条件（每条都踩过坑）：
 * <ol>
 *   <li><b>不转发 auth 帧</b>：Node 侧用 {@code ?token=} 在握手时就鉴权完成，
 *       浏览器再发 auth 只会重复鉴权；前端 imWs 客户端因此去掉了 auth 帧。</li>
 *   <li><b>握手期间先缓冲</b>：Node 连接是异步建立的，浏览器在拿到 auth_ok 前可能已经发了 ping，
 *       这些帧先入队，连上后按序补发（队列有上限，防止内存被刷爆）。</li>
 *   <li><b>发送串行化</b>：{@link WebSocketSession} 不是线程安全的，用
 *       {@link ConcurrentWebSocketSessionDecorator} 包一层，避免 Node 推送与本地回包交叉发送导致帧损坏。</li>
 *   <li><b>断一边必须掐另一边</b>：浏览器关页 → 关 Node；Node 断（4003 鉴权失败等）→ 用同一状态码关浏览器，
 *       让前端的「4003 不重连」逻辑继续生效。</li>
 * </ol>
 */
@Component
public class ImWsBridgeHandler extends TextWebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(ImWsBridgeHandler.class);

    /** 浏览器侧发送超时与缓冲上限：单帧不会超过几十 KB，256KB 足够，超了就说明对端已经不读了。 */
    private static final int SEND_TIME_LIMIT_MS = 10_000;
    private static final int SEND_BUFFER_LIMIT = 256 * 1024;
    /** Node 连接建立前的待发帧上限。 */
    private static final int PENDING_LIMIT = 100;

    private final NodeStreamClient streams;
    private final Map<String, Bridge> bridges = new ConcurrentHashMap<>();

    public ImWsBridgeHandler(NodeStreamClient streams) {
        this.streams = streams;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        String token = (String) session.getAttributes().get(ImWsHandshakeInterceptor.TOKEN_ATTRIBUTE);
        if (token == null || token.isBlank()) {
            closeQuietly(session, CloseStatus.NOT_ACCEPTABLE.withReason("未登录"));
            return;
        }
        WebSocketSession safeSession = new ConcurrentWebSocketSessionDecorator(
                session, SEND_TIME_LIMIT_MS, SEND_BUFFER_LIMIT);
        Bridge bridge = new Bridge(session.getId(), safeSession, streams, token);
        bridges.put(session.getId(), bridge);
        bridge.connect();
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) {
        Bridge bridge = bridges.get(session.getId());
        if (bridge != null) {
            bridge.fromBrowser(message.getPayload());
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        Bridge bridge = bridges.remove(session.getId());
        if (bridge != null) {
            bridge.fromBrowserClosed(status);
        }
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) {
        log.info("浏览器 WS 传输异常 {}：{}", session.getId(), exception.getMessage());
        Bridge bridge = bridges.remove(session.getId());
        if (bridge != null) {
            bridge.closeBoth("浏览器传输异常");
        }
    }

    private static void closeQuietly(WebSocketSession session, CloseStatus status) {
        try {
            if (session.isOpen()) {
                session.close(status);
            }
        } catch (IOException ignored) {
            // 关不上就算了，容器会回收
        }
    }

    /** 一条浏览器连接对应的桥接状态。 */
    private static final class Bridge implements WebSocket.Listener {

        private final String sessionId;
        private final WebSocketSession browser;
        private final NodeStreamClient streams;
        private final String token;
        private final AtomicBoolean closed = new AtomicBoolean(false);
        private final ArrayDeque<String> pending = new ArrayDeque<>();
        private final StringBuilder partial = new StringBuilder();
        private WebSocket node;

        private Bridge(String sessionId, WebSocketSession browser, NodeStreamClient streams, String token) {
            this.sessionId = sessionId;
            this.browser = browser;
            this.streams = streams;
            this.token = token;
        }

        void connect() {
            URI uri = streams.webSocketUri("/v1/im/ws", token);
            streams.webSocketBuilder()
                    .buildAsync(uri, this)
                    .whenComplete((webSocket, error) -> {
                        if (error != null) {
                            log.warn("连接 Node WS 失败 {}：{}", sessionId, error.getMessage());
                            closeBrowser(CloseStatus.SERVER_ERROR.withReason("IM 服务不可用"));
                        }
                    });
        }

        /* ---------------- java.net.http.WebSocket.Listener ---------------- */

        @Override
        public void onOpen(WebSocket webSocket) {
            synchronized (this) {
                this.node = webSocket;
            }
            // java.net.http.WebSocket 默认不推帧，必须主动请求（背压由 request(n) 控制）
            webSocket.request(1);
            flushPending();
        }

        @Override
        public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
            partial.append(data);
            if (last) {
                String text = partial.toString();
                partial.setLength(0);
                sendToBrowser(text);
            }
            webSocket.request(1);
            return null;
        }

        @Override
        public CompletionStage<?> onClose(WebSocket webSocket, int statusCode, String reason) {
            closeBrowser(toCloseStatus(statusCode, reason));
            return null;
        }

        @Override
        public void onError(WebSocket webSocket, Throwable error) {
            log.info("Node WS 异常 {}：{}", sessionId, error.getMessage());
            closeBrowser(CloseStatus.SERVER_ERROR.withReason("IM 服务异常"));
        }

        /* ---------------- 浏览器 → Node ---------------- */

        void fromBrowser(String text) {
            if (closed.get()) {
                return;
            }
            synchronized (this) {
                if (node == null) {
                    if (pending.size() >= PENDING_LIMIT) {
                        pending.pollFirst(); // 丢最旧的，保证链接不被一个死客户端拖死
                    }
                    pending.addLast(text);
                    return;
                }
            }
            sendToNode(text);
        }

        private void flushPending() {
            List<String> batch;
            synchronized (this) {
                batch = new ArrayList<>(pending);
                pending.clear();
            }
            batch.forEach(this::sendToNode);
        }

        private void sendToNode(String text) {
            WebSocket target;
            synchronized (this) {
                target = node;
            }
            if (target == null) {
                return;
            }
            target.sendText(text, true).exceptionally(error -> {
                log.info("转发到 Node 失败 {}：{}", sessionId, error.getMessage());
                closeBoth("IM 服务写入失败");
                return null;
            });
        }

        /* ---------------- Node → 浏览器 ---------------- */

        private void sendToBrowser(String text) {
            if (closed.get()) {
                return;
            }
            try {
                browser.sendMessage(new TextMessage(text));
            } catch (Exception error) {
                log.info("下发浏览器失败 {}：{}", sessionId, error.getMessage());
                closeBoth("浏览器写入失败");
            }
        }

        /* ---------------- 关闭 ---------------- */

        void fromBrowserClosed(CloseStatus status) {
            if (!closed.compareAndSet(false, true)) {
                return;
            }
            WebSocket target = takeNode();
            if (target != null) {
                int code = status.getCode() >= 1000 && status.getCode() <= 4999 ? status.getCode() : 1000;
                try {
                    target.sendClose(code, status.getReason() == null ? "" : status.getReason());
                } catch (RuntimeException ignored) {
                    target.abort();
                }
            }
        }

        void closeBoth(String reason) {
            if (!closed.compareAndSet(false, true)) {
                return;
            }
            WebSocket target = takeNode();
            if (target != null) {
                target.abort();
            }
            String trimmed = reason.length() > 100 ? reason.substring(0, 100) : reason;
            closeQuietly(browser, CloseStatus.SERVER_ERROR.withReason(trimmed));
        }

        private void closeBrowser(CloseStatus status) {
            if (!closed.compareAndSet(false, true)) {
                return;
            }
            WebSocket target = takeNode();
            if (target != null) {
                target.abort();
            }
            closeQuietly(browser, status);
        }

        private WebSocket takeNode() {
            synchronized (this) {
                WebSocket target = node;
                node = null;
                return target;
            }
        }

        /** 1005/1006/1015 不允许出现在 close 帧里，统一降级成正常关闭。 */
        private static CloseStatus toCloseStatus(int code, String reason) {
            if (code < 1000 || code > 4999 || code == 1004 || code == 1005 || code == 1006 || code == 1015) {
                return CloseStatus.NORMAL;
            }
            String text = reason == null ? "" : (reason.length() > 100 ? reason.substring(0, 100) : reason);
            return new CloseStatus(code, text);
        }
    }
}
