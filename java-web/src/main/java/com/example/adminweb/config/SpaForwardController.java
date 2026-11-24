package com.example.adminweb.config;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

/**
 * SPA history 路由回落。
 *
 * <p>前端用 BrowserRouter，用户刷新 {@code /agency/orders} 时服务端并不存在这个资源。
 * 这里把非 {@code /api} 的页面路径 forward 到 {@code index.html}，由 React Router 接管。
 *
 * <p>注意：不能把 {@code /assets/**}、{@code /api/**} 纳入，否则会把静态文件与接口请求也吞成 HTML。
 */
@Controller
public class SpaForwardController {

    @GetMapping({"/", "/login", "/403", "/agency/**", "/platform/**"})
    public String forwardToIndex() {
        return "forward:/index.html";
    }
}
