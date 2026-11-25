package com.example.adminweb.api;

/** Node 不可达或超时：对浏览器是 503（可以重试），不要伪装成 500。 */
public class NodeUnavailableException extends RuntimeException {

    public NodeUnavailableException(String message, Throwable cause) {
        super(message, cause);
    }
}
