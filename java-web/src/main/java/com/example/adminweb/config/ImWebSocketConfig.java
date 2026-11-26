package com.example.adminweb.config;

import com.example.adminweb.im.ImWsBridgeHandler;
import com.example.adminweb.im.ImWsHandshakeInterceptor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.server.standard.ServletServerContainerFactoryBean;

/**
 * 注册客服台的 WS 桥接端点：浏览器连 {@code /api/im/ws}，由 BFF 转给 Node。
 *
 * <p>安全边界不在 Origin 上，而在握手阶段的会话校验：
 * 没有有效 {@code JSESSIONID} 时 {@link ImWsHandshakeInterceptor} 直接回 401；
 * 会话有效但没有 IM 权限时，Node 会在几毫秒内用 4004 关掉连接。
 * 因此这里放开 Origin，只为兼容开发期 Vite（5174）代理进来的请求。
 */
@Configuration
@EnableWebSocket
public class ImWebSocketConfig implements WebSocketConfigurer {

    private final ImWsBridgeHandler bridgeHandler;
    private final ImWsHandshakeInterceptor handshakeInterceptor;

    public ImWebSocketConfig(ImWsBridgeHandler bridgeHandler, ImWsHandshakeInterceptor handshakeInterceptor) {
        this.bridgeHandler = bridgeHandler;
        this.handshakeInterceptor = handshakeInterceptor;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(bridgeHandler, "/api/im/ws")
                .addInterceptors(handshakeInterceptor)
                .setAllowedOriginPatterns("*");
    }

    /**
     * 容器级限制：聊天单条上限 5000 字（中文 UTF-8 约 15KB），默认 8KB 文本缓冲会直接断连。
     * 空闲超时不设限（0），连接活性由应用层的 30s ping/pong 维持。
     */
    @Bean
    public ServletServerContainerFactoryBean webSocketContainer() {
        ServletServerContainerFactoryBean container = new ServletServerContainerFactoryBean();
        container.setMaxTextMessageBufferSize(64 * 1024);
        container.setMaxBinaryMessageBufferSize(64 * 1024);
        container.setMaxSessionIdleTimeout(0L);
        return container;
    }
}
