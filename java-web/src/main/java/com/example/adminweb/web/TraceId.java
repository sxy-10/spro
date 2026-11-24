package com.example.adminweb.web;

import java.util.UUID;
import org.slf4j.MDC;

/** 请求级 traceId：由 TraceIdFilter 写入 MDC，这里读不到时兜底生成。 */
public final class TraceId {

    public static final String MDC_KEY = "traceId";
    public static final String HEADER = "X-Trace-Id";

    private TraceId() {
    }

    public static String current() {
        String traceId = MDC.get(MDC_KEY);
        if (traceId == null) {
            traceId = newId();
            MDC.put(MDC_KEY, traceId);
        }
        return traceId;
    }

    public static String newId() {
        return UUID.randomUUID().toString().replace("-", "");
    }
}
