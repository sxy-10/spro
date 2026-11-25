package com.example.adminweb.security;

import java.io.Serializable;

/**
 * 存在 HttpSession 里的 Node 凭证。
 *
 * <p>浏览器只拿到 JSESSIONID，token 永远不出服务端；refresh token 目前只保存不自动使用
 * （契约要求 401 直接让用户重新登录，不做静默续期，避免演示时"莫名其妙又登录了"）。
 */
public record NodeSession(String accessToken, String refreshToken, long expiresAtMillis) implements Serializable {

    public boolean isExpired(long nowMillis) {
        return expiresAtMillis > 0 && nowMillis >= expiresAtMillis;
    }
}
