package com.example.adminweb.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

/**
 * 登录链路端到端（Java 侧）：验证码 → 登录 → /api/me → 页面聚合接口。
 *
 * <p>Node 用 JDK HttpServer 做桩，断言的是**Java 的行为**：会话是否建立、menus/buttons 是否下发、
 * 401/400 的错误码是否正确、一页是否只打一次 Node。真实 Node 联调由组员 1 起环境后补。
 */
@SpringBootTest
@AutoConfigureMockMvc
class AuthFlowTest {

    private static final AtomicInteger ORDERS_CALLS = new AtomicInteger();
    private static final AtomicReference<String> LOGIN_OVERRIDE = new AtomicReference<>();
    private static final HttpServer NODE;

    static {
        try {
            NODE = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            NODE.createContext("/", AuthFlowTest::handle);
            NODE.start();
        } catch (IOException e) {
            throw new ExceptionInInitializerError(e);
        }
    }

    @DynamicPropertySource
    static void nodeProperties(DynamicPropertyRegistry registry) {
        registry.add("app.node.base-url", () -> "http://127.0.0.1:" + NODE.getAddress().getPort());
    }

    @AfterAll
    static void stopNode() {
        NODE.stop(0);
    }

    private static void handle(HttpExchange exchange) throws IOException {
        String path = exchange.getRequestURI().getPath();
        String override = LOGIN_OVERRIDE.get();
        if (path.equals("/v1/auth/login/account") && override != null) {
            respond(exchange, 400, override);
            return;
        }
        String body = switch (path) {
            case "/v1/auth/captcha" ->
                    "{\"code\":0,\"message\":\"ok\",\"data\":{\"captcha_id\":\"cap-1\",\"captcha_image\":\"<svg/>\"}}";
            case "/v1/auth/login/account" ->
                    "{\"code\":0,\"message\":\"ok\",\"data\":{\"token\":\"node-token\",\"refresh_token\":\"refresh\","
                            + "\"expires_in\":1800,\"user_id\":\"7\"}}";
            case "/v1/users/me" ->
                    "{\"code\":0,\"message\":\"ok\",\"data\":{\"user_id\":\"7\",\"nickname\":\"演示管理员\","
                            + "\"roles\":[{\"role_id\":\"1\",\"name\":\"旅行社管理员\",\"code\":\"AGENCY_ADMIN\"}]}}";
            case "/v1/users/me/permissions" ->
                    "{\"code\":0,\"message\":\"ok\",\"data\":{\"menus\":[{\"permission_id\":\"31\",\"name\":\"订单列表\","
                            + "\"code\":\"order:manage\",\"path\":\"/orders/manage\",\"sort\":1,\"children\":[]}],"
                            + "\"buttons\":[{\"permission_id\":\"301\",\"name\":\"查询订单\",\"code\":\"order:manage:query\","
                            + "\"resource_type\":\"BUTTON\"}]}}";
            case "/v1/admin/orders" -> {
                ORDERS_CALLS.incrementAndGet();
                yield "{\"code\":0,\"message\":\"ok\",\"data\":{\"list\":[],\"total\":0,\"has_more\":false}}";
            }
            case "/v1/auth/logout" -> "{\"code\":0,\"message\":\"ok\",\"data\":null}";
            default -> "{\"code\":40400,\"message\":\"未预期的桩路径 " + path + "\",\"data\":null}";
        };
        respond(exchange, body.startsWith("{\"code\":0") ? 200 : 400, body);
    }

    private static void respond(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(bytes);
        }
    }

    @Autowired
    private MockMvc mockMvc;

    private MockHttpSession login() throws Exception {
        MvcResult result = mockMvc.perform(post("/api/auth/login")
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("X-Captcha-Id", "cap-1")
                        .content("{\"account\":\"admin\",\"password\":\"password\",\"captcha_code\":\"ab12\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data.username").value("演示管理员"))
                .andReturn();
        return (MockHttpSession) result.getRequest().getSession(false);
    }

    @Test
    void 登录后me下发菜单与按钮且订单页只打一次Node() throws Exception {
        MockHttpSession session = login();
        assertThat(session).isNotNull();

        mockMvc.perform(get("/api/me").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.user_id").value("7"))
                .andExpect(jsonPath("$.data.roles[0]").value("AGENCY_ADMIN"))
                .andExpect(jsonPath("$.data.menus[0].code").value("order:manage"))
                .andExpect(jsonPath("$.data.buttons[0].code").value("order:manage:query"));

        int before = ORDERS_CALLS.get();
        mockMvc.perform(get("/api/agency/orders?page=1&size=10").session(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.total").value(0));
        // 一页一请求：前端只发 1 次 /api/agency/orders，Node 也只被调用 1 次
        assertThat(ORDERS_CALLS.get() - before).isEqualTo(1);
    }

    @Test
    void 未登录访问me返回401与20012() throws Exception {
        mockMvc.perform(get("/api/me"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value(20012));
    }

    @Test
    void 缺少验证码id时直接400不落会话() throws Exception {
        mockMvc.perform(post("/api/auth/login")
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"account\":\"admin\",\"password\":\"password\",\"captcha_code\":\"ab12\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(10001));
    }

    @Test
    void 密码错误时透传Node的message() throws Exception {
        LOGIN_OVERRIDE.set("{\"code\":10001,\"message\":\"账号或密码错误\",\"data\":null,\"trace_id\":\"t-9\"}");
        try {
            mockMvc.perform(post("/api/auth/login")
                            .with(csrf())
                            .contentType(MediaType.APPLICATION_JSON)
                            .header("X-Captcha-Id", "cap-1")
                            .content("{\"account\":\"admin\",\"password\":\"wrongpass\",\"captcha_code\":\"ab12\"}"))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value(10001))
                    .andExpect(jsonPath("$.message").value("账号或密码错误"));
        } finally {
            LOGIN_OVERRIDE.set(null);
        }
    }
}
