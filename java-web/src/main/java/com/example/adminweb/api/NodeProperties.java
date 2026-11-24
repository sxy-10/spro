package com.example.adminweb.api;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Node 侧连接参数。
 *
 * @param baseUrl        业务 API 地址（内网）
 * @param connectTimeout 连接超时：宁可快速失败，也不要拖住页面
 * @param readTimeout    读超时：聚合接口总预算 3s
 */
@ConfigurationProperties(prefix = "app.node")
public record NodeProperties(String baseUrl, Duration connectTimeout, Duration readTimeout) {
}
