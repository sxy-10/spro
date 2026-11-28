package com.example.adminweb.internal;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

/**
 * 内部接口的独立 HTTP 客户端。
 *
 * <p>为什么不复用 {@code nodeRestClient}：那条链路的读超时是 3 秒（面向用户请求，慢一点就该 504），
 * 而定时任务（比如 refresh-stock 批量刷库存）天然可能跑几秒。共用会把手慢的任务判成"Node 不可用"，
 * 让日志里全是假失败。这里给到 10 秒，并且连接超时更短（连不上要快速失败，别压在调度线程上）。
 */
@Configuration
@EnableConfigurationProperties(InternalProperties.class)
public class InternalConfig {

    @Bean
    public RestClient internalRestClient() {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(2000);
        factory.setReadTimeout(10000);
        return RestClient.builder().requestFactory(factory).build();
    }
}
