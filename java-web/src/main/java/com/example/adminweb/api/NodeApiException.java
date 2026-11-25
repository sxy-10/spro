package com.example.adminweb.api;

/**
 * Node 业务错误。Node 的一切失败都走 {@code {code,message,data,trace_id}} 包络，
 * 这里把它翻译成 Java 异常，控制器不必再判断 HTTP 状态码。
 */
public class NodeApiException extends RuntimeException {

    private final int httpStatus;
    private final int code;
    private final String traceId;

    public NodeApiException(int httpStatus, int code, String message, String traceId) {
        super(message);
        this.httpStatus = httpStatus;
        this.code = code;
        this.traceId = traceId;
    }

    public int httpStatus() {
        return httpStatus;
    }

    public int code() {
        return code;
    }

    public String traceId() {
        return traceId;
    }

    /** 20012 = 未登录或 token 失效（Node 的语义），遇到它必须让浏览器重新登录。 */
    public boolean isUnauthorized() {
        return httpStatus == 401 || code == 20012;
    }

    /** 20013 = 已登录但越权（含签名错误）；对浏览器就是 403。 */
    public boolean isForbidden() {
        return httpStatus == 403 || code == 20013;
    }
}
