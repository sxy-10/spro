package com.example.adminweb.api;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 签名固定向量测试：这一条挂了，说明与 Node / Android 的实现已经不一致，联调必然 403。
 * 期望值由 Node 侧同算法独立算出（Python hashlib/hmac 交叉验证），不是自我循环。
 */
class RequestSignerTest {

    private static final String KEY = "test-token-abc";
    private static final String METHOD = "POST";
    private static final String PATH = "/v1/orders?x=1";
    private static final String BODY = "{\"a\":1}";
    private static final String TIMESTAMP = "2026-11-10T07:30:00.000Z";
    private static final String NONCE = "abc123";

    @Test
    @DisplayName("body 的 SHA-256 小写十六进制")
    void bodyHash() {
        assertThat(RequestSigner.sha256Hex(BODY))
                .isEqualTo("015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862");
    }

    @Test
    @DisplayName("HMAC-SHA256 签名与固定向量逐字符一致")
    void signatureMatchesFixedVector() {
        assertThat(RequestSigner.signature(METHOD, PATH, BODY, TIMESTAMP, NONCE, KEY))
                .isEqualTo("2b0f68958fc680580ea1d48cef33dfe69403c2bcb521833cd15b17b789006f2c");
    }
}
