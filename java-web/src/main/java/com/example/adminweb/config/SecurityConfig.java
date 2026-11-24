package com.example.adminweb.config;

import com.example.adminweb.web.JsonAccessDeniedHandler;
import com.example.adminweb.web.JsonAuthEntryPoint;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;

/**
 * 安全配置：会话认证 + CSRF 启用。
 *
 * <ul>
 *   <li>认证：JSON 接口 + HttpSession（无表单登录、无 Basic），浏览器只持 JSESSIONID。</li>
 *   <li>CSRF：同源部署下必须开启。token 写 XSRF-TOKEN Cookie（可被 JS 读取是设计使然），
 *       前端在写请求里回填 X-XSRF-TOKEN 头。</li>
 *   <li>失败：401/403 一律返回 JSON 包络（code=20012/20013），不 302 重定向（SPA 无法处理）。</li>
 * </ul>
 */
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    /** 静态资源与 SPA 路由：不需要登录即可拿到 HTML/JS，真正的门禁在 /api/**。 */
    private static final String[] PUBLIC_PATHS = {
            "/", "/index.html", "/favicon.ico", "/assets/**", "/error",
            "/login", "/403", "/agency/**", "/platform/**"
    };

    /**
     * 登录态存 Session。显式暴露为 Bean，登录/登出控制器复用它写入与清除，
     * 否则会出现「Session 里有属性、SecurityContext 却是空的」这种假登录。
     */
    @Bean
    public SecurityContextRepository securityContextRepository() {
        return new HttpSessionSecurityContextRepository();
    }

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http,
                                                   ObjectMapper objectMapper,
                                                   SecurityContextRepository securityContextRepository) throws Exception {
        // 让 CsrfToken 在首次 GET 时立即解析并下发 Cookie（Spring Security 6 默认是懒加载）
        CsrfTokenRequestAttributeHandler csrfHandler = new CsrfTokenRequestAttributeHandler();
        csrfHandler.setCsrfRequestAttributeName(null);

        http
                .securityContext(context -> context.securityContextRepository(securityContextRepository))
                .csrf(csrf -> csrf
                        .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
                        .csrfTokenRequestHandler(csrfHandler))
                .cors(AbstractHttpConfigurer::disable)
                .httpBasic(AbstractHttpConfigurer::disable)
                .formLogin(AbstractHttpConfigurer::disable)
                .logout(AbstractHttpConfigurer::disable)
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(PUBLIC_PATHS).permitAll()
                        .requestMatchers("/api/ping", "/api/auth/**").permitAll()
                        .anyRequest().authenticated())
                .exceptionHandling(ex -> ex
                        .authenticationEntryPoint(new JsonAuthEntryPoint(objectMapper))
                        .accessDeniedHandler(new JsonAccessDeniedHandler(objectMapper)))
                .sessionManagement(session -> session
                        .sessionFixation(fixation -> fixation.changeSessionId()));

        return http.build();
    }
}
