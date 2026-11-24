package com.example.adminweb.web;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/**
 * 异常出口：保证任何错误都以统一包络返回，前端只写一套解析逻辑。
 * 未知 /api 路径走这里（而不是 Spring 默认的 Whitelabel JSON）。
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<ApiResult<Void>> handleNotFound(NoResourceFoundException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(ApiResult.error(40400, "接口或资源不存在：" + ex.getResourcePath()));
    }
}
