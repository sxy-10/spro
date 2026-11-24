package com.example.adminweb;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * B 端（旅行社）+ 平台方后台服务。
 *
 * <p>形态：Spring Boot 3.3 + REST 控制器（BFF）+ 同源托管的 React SPA。
 * 浏览器只持 {@code JSESSIONID} 与 {@code XSRF-TOKEN}，任何 token / HMAC 密钥都止于本进程。
 */
@SpringBootApplication
public class AdminWebApplication {

    public static void main(String[] args) {
        SpringApplication.run(AdminWebApplication.class, args);
    }
}
