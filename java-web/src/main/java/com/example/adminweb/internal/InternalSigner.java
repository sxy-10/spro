package com.example.adminweb.internal;

import com.example.adminweb.api.RequestSigner;
import java.util.Locale;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * 内部接口签名器（与 {@code backend/src/api/internalRouter.ts} 的
 * {@code requestSignature} 逐字节一致）。
 *
 * <pre>
 * 五行原文（LF 分隔、末尾无换行）：
 *   HTTP_METHOD
 *   /internal/完整路径（不含 query）
 *   X-Timestamp            ← Unix epoch 毫秒，不是 ISO 时间
 *   X-Nonce                ← 16–128 位 [A-Za-z0-9-]
 *   SHA256(JSON.stringify(请求体或空对象))
 * X-Internal-Key = HMAC-SHA256(key = INTERNAL_API_SECRET, message)
 * </pre>
 *
 * <p>与用户侧 {@link RequestSigner} 的三处差异（混用必 401）：
 * 时间戳是毫秒数而非 ISO；头名是 {@code X-Internal-Key} 而非 {@code X-Signature}；
 * 密钥是独立内部密钥而非用户 Bearer token —— 所以两者不能共用一个类。
 */
@Component
public class InternalSigner {

    /** 空请求体按 {@code "{}"} 计算摘要：Node 侧 {@code JSON.stringify(req.body ?? {})} 就是这个结果。 */
    private static final String EMPTY_BODY = "{}";

    public record Headers(String timestamp, String nonce, String signature) {
    }

    public Headers sign(String method, String path, String bodyJson, String secret) {
        String timestamp = String.valueOf(System.currentTimeMillis());
        String nonce = UUID.randomUUID().toString().replace("-", "");
        return new Headers(timestamp, nonce, signature(method, path, timestamp, nonce, bodyJson, secret));
    }

    /** 纯函数版本，单元测试直接用它对照 Node 的测试向量。 */
    public static String signature(String method, String path, String timestamp, String nonce,
                                   String bodyJson, String secret) {
        String bodyHash = RequestSigner.sha256Hex(bodyJson == null || bodyJson.isBlank() ? EMPTY_BODY : bodyJson);
        String message = String.join("\n",
                method.toUpperCase(Locale.ROOT),
                path,
                timestamp,
                nonce,
                bodyHash);
        return RequestSigner.hmacSha256Hex(secret, message);
    }
}
