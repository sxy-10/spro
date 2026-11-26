package com.example.adminweb.config;

import com.example.adminweb.api.NodeProperties;
import com.example.adminweb.api.RequestSigner;
import java.net.http.HttpClient;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

/**
 * Node 调用客户端。骨架期先把 RestClient 与签名器装配好，
 * 后续 {@code NodeApiClient} 只在这里之上做「拼 URL → 签名 → 解析包络 → 错误映射」。
 *
 * <p>必须用 JDK HttpClient（{@link JdkClientHttpRequestFactory}）并显式锁 HTTP/1.1：
 * 默认的 {@code ClientHttpRequestFactories.get(...)} 在没有 Apache HttpClient 依赖时落到
 * HttpURLConnection，而它**不支持 PATCH 方法**（抛 ProtocolException）——平台端的
 * 启停用接口恰好是 PATCH；JDK HttpClient 又默认尝试 HTTP/2 升级，Node 只讲 HTTP/1.1，
 * 会被当成非法升级请求返回 404。这两个坑都已在下方配置里绕开。
 */
@Configuration
@EnableConfigurationProperties(NodeProperties.class)
public class NodeApiConfig {

    @Bean
    public RestClient nodeRestClient(NodeProperties properties) {
        HttpClient httpClient = HttpClient.newBuilder()
                // Node(express) 只讲 HTTP/1.1：JDK HttpClient 默认尝试 h2c 升级（带 Upgrade 头），
                // 会被 Node 判成 404 空响应，必须显式锁 HTTP_1_1。
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(properties.connectTimeout())
                .build();
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(httpClient);
        factory.setReadTimeout(properties.readTimeout());

        return RestClient.builder()
                .baseUrl(properties.baseUrl())
                .requestFactory(factory)
                .build();
    }

    @Bean
    public RequestSigner requestSigner() {
        return new RequestSigner();
    }
}
