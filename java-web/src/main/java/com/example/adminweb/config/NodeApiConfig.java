package com.example.adminweb.config;

import com.example.adminweb.api.NodeProperties;
import com.example.adminweb.api.RequestSigner;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.web.client.ClientHttpRequestFactories;
import org.springframework.boot.web.client.ClientHttpRequestFactorySettings;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.ClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

/**
 * Node 调用客户端。骨架期先把 RestClient 与签名器装配好，
 * 后续 {@code NodeApiClient} 只在这里之上做「拼 URL → 签名 → 解析包络 → 错误映射」。
 */
@Configuration
@EnableConfigurationProperties(NodeProperties.class)
public class NodeApiConfig {

    @Bean
    public RestClient nodeRestClient(NodeProperties properties) {
        ClientHttpRequestFactorySettings settings = ClientHttpRequestFactorySettings.DEFAULTS
                .withConnectTimeout(properties.connectTimeout())
                .withReadTimeout(properties.readTimeout());
        ClientHttpRequestFactory factory = ClientHttpRequestFactories.get(settings);

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
