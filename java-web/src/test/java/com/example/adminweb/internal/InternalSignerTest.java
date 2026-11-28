package com.example.adminweb.internal;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/**
 * 内部签名必须与 Node 侧逐字节一致，否则四个定时任务全部 401。
 *
 * <p>测试向量来自 {@code backend/src/api/internalRouter.test.ts} 的同一组输入；
 * 期望值用 .NET 的 HMACSHA256 独立算过（不是拿本类自己的实现自证）。
 */
class InternalSignerTest {

    private static final String SECRET = "independent-test-secret-with-more-than-32-characters";
    private static final String TIMESTAMP = "1795600000000";
    private static final String NONCE = "0123456789abcdef01234567";
    private static final String BODY = "{\"task\":\"expire-orders\",\"batch\":10}";

    @Test
    void 与Node侧测试向量逐字节一致() {
        String signature = InternalSigner.signature("POST", "/internal/timers/expire-orders",
                TIMESTAMP, NONCE, BODY, SECRET);
        assertThat(signature).isEqualTo("c2675ea9bda0aeeec83f2bfd7b04cabf7ca74fd786551539612a2b91813e5021");
    }

    @Test
    void 路径方法体任一变化都必须换签名() {
        String base = InternalSigner.signature("POST", "/internal/timers/dashboard-preagg", TIMESTAMP, NONCE, null, SECRET);

        assertThat(InternalSigner.signature("GET", "/internal/timers/dashboard-preagg", TIMESTAMP, NONCE, null, SECRET))
                .isNotEqualTo(base);
        assertThat(InternalSigner.signature("POST", "/internal/timers/expire-orders", TIMESTAMP, NONCE, null, SECRET))
                .isNotEqualTo(base);
        assertThat(InternalSigner.signature("POST", "/internal/timers/dashboard-preagg", TIMESTAMP, NONCE, BODY, SECRET))
                .isNotEqualTo(base);
    }

    @Test
    void 空请求体按空对象计算摘要() {
        // Node 侧 JSON.stringify(req.body ?? {}) 对无 body 的 GET 得到 "{}"
        assertThat(InternalSigner.signature("GET", "/internal/dashboard/preagg", TIMESTAMP, NONCE, null, SECRET))
                .isEqualTo(InternalSigner.signature("GET", "/internal/dashboard/preagg", TIMESTAMP, NONCE, "{}", SECRET));
    }
}
