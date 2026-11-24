package com.example.adminweb.api;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.HexFormat;
import java.util.Locale;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Component;

/**
 * Java 版 HMAC 签名器（与 Android 的 OkHttp 拦截器逐字节一致，见规范 §6.1）。
 *
 * <pre>
 * message = METHOD \n /v1/完整路径(含query) \n X-Timestamp \n X-Nonce \n SHA256(body)
 * X-Signature = HMAC-SHA256(key = 当前 access token, message)
 * </pre>
 *
 * <p>红线：签名只在服务端发生，密钥与 token 绝不下发浏览器。
 */
@Component
public class RequestSigner {

    /** 时间戳格式必须与 Node / Android 完全一致，差一个字符签名就挂。 */
    private static final DateTimeFormatter TIMESTAMP_FORMAT =
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);

    private final Clock clock;

    public RequestSigner() {
        this(Clock.systemUTC());
    }

    RequestSigner(Clock clock) {
        this.clock = clock;
    }

    public record SignedHeaders(String timestamp, String nonce, String signature) {
    }

    /** 为一次请求生成三件套（时间戳 / nonce / 签名）；GET 也要时间戳与 nonce，仅签名可省。 */
    public SignedHeaders sign(String method, String pathWithQuery, String body, String accessToken) {
        String timestamp = TIMESTAMP_FORMAT.format(Instant.now(clock));
        String nonce = UUID.randomUUID().toString().replace("-", "");
        return new SignedHeaders(timestamp, nonce, signature(method, pathWithQuery, body, timestamp, nonce, accessToken));
    }

    public static String signature(String method, String pathWithQuery, String body,
                                   String timestamp, String nonce, String accessToken) {
        String message = String.join("\n",
                method.toUpperCase(Locale.ROOT),
                pathWithQuery,
                timestamp,
                nonce,
                sha256Hex(body == null ? "" : body));
        return hmacSha256Hex(accessToken, message);
    }

    public static String sha256Hex(String text) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(text.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException("SHA-256 不可用", e);
        }
    }

    public static String hmacSha256Hex(String key, String message) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(message.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException("HmacSHA256 不可用", e);
        }
    }
}
