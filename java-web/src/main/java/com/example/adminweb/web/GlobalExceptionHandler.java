package com.example.adminweb.web;

import com.example.adminweb.api.NodeApiException;
import com.example.adminweb.api.NodeUnavailableException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/**
 * 异常出口：保证任何错误都以统一包络返回，前端只写一套解析逻辑。
 *
 * <p>三档语义要分清，否则前端会把"服务挂了"当成"没登录"：
 * <ul>
 *   <li>Node 业务错误：原样透传 Node 的 code/message（10001 参数错误、20012 未登录、20013 越权）；</li>
 *   <li>Node 不可达/超时：503 + 50300，页面提示"服务暂不可用"，可以重试；</li>
 *   <li>Java 自己的 4xx：按 HTTP 状态映射成同一套 code。</li>
 * </ul>
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<ApiResult<Void>> handleNotFound(NoResourceFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(ApiResult.error(40400, "接口或资源不存在：" + ex.getResourcePath()));
    }

    @ExceptionHandler(NodeApiException.class)
    public ResponseEntity<ApiResult<Void>> handleNode(NodeApiException ex, HttpServletRequest request) {
        if (ex.isUnauthorized()) {
            // Node 说 token 失效：本地会话必须一起销毁，否则页面会"看起来还登录着"
            HttpSession session = request.getSession(false);
            if (session != null) {
                session.invalidate();
            }
        }
        HttpStatus status;
        if (ex.isUnauthorized()) {
            status = HttpStatus.UNAUTHORIZED;
        } else if (ex.isForbidden()) {
            status = HttpStatus.FORBIDDEN;
        } else {
            HttpStatus resolved = HttpStatus.resolve(ex.httpStatus());
            status = (resolved != null && ex.httpStatus() >= 400 && ex.httpStatus() < 500)
                    ? resolved
                    : HttpStatus.BAD_GATEWAY;
        }
        int code = ex.code() != 0 ? ex.code() : 50000;
        String traceId = ex.traceId() != null && !ex.traceId().isBlank() ? ex.traceId() : TraceId.current();
        return ResponseEntity.status(status).body(new ApiResult<>(code, ex.getMessage(), null, traceId));
    }

    @ExceptionHandler(NodeUnavailableException.class)
    public ResponseEntity<ApiResult<Void>> handleNodeUnavailable(NodeUnavailableException ex) {
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(ApiResult.error(50300, "后端服务暂不可用，请稍后重试"));
    }

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<ApiResult<Void>> handleStatus(ResponseStatusException ex) {
        HttpStatus status = HttpStatus.resolve(ex.getStatusCode().value());
        if (status == null) {
            status = HttpStatus.INTERNAL_SERVER_ERROR;
        }
        int code = switch (status) {
            case BAD_REQUEST -> 10001;
            case UNAUTHORIZED -> 20012;
            case FORBIDDEN -> 20013;
            case NOT_FOUND -> 40400;
            case TOO_MANY_REQUESTS -> 20014;
            default -> status.is5xxServerError() ? 50000 : 10001;
        };
        String message = ex.getReason() != null ? ex.getReason() : status.getReasonPhrase();
        return ResponseEntity.status(status).body(ApiResult.error(code, message));
    }
}
