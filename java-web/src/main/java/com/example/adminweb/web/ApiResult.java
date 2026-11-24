package com.example.adminweb.web;

/**
 * 统一响应包络：{@code {code, message, data, trace_id}}，与 Node /v1 完全一致。
 * 字段名由 Jackson 的 SNAKE_CASE 策略输出（traceId -> trace_id）。
 */
public record ApiResult<T>(int code, String message, T data, String traceId) {

    public static <T> ApiResult<T> ok(T data) {
        return new ApiResult<>(0, "ok", data, TraceId.current());
    }

    public static <T> ApiResult<T> error(int code, String message) {
        return new ApiResult<>(code, message, null, TraceId.current());
    }
}
