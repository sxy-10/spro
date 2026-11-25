package com.example.adminweb.security;

/** Session 属性名集中在一处，避免控制器之间拼字符串拼错。 */
public final class SessionKeys {

    /** {@link NodeSession}：access/refresh token 与过期时间。 */
    public static final String NODE_SESSION = "node.session";
    /** 登录时的 {@code /v1/users/me} 结果（JSON 字符串）。 */
    public static final String PROFILE_JSON = "node.profile";
    /** 登录时的 {@code /v1/users/me/permissions} 结果（JSON 字符串，含 menus/buttons）。 */
    public static final String PERMISSIONS_JSON = "node.permissions";

    private SessionKeys() {
    }
}
