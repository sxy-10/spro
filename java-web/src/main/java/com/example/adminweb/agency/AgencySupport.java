package com.example.adminweb.agency;

import java.math.BigDecimal;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;

/** B 端聚合接口的小工具：拼查询串、把前端数字转成 Node 要求的字符串金额。 */
final class AgencySupport {

    private AgencySupport() {
    }

    /**
     * 只放非空参数，顺序固定（page/size/sort 在前，业务条件在后）。
     * 空字符串一律丢弃——Node 的 zod 校验对空串会直接 400。
     */
    static String query(Map<String, Object> params) {
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<String, Object> entry : params.entrySet()) {
            Object value = entry.getValue();
            if (value == null || (value instanceof String s && s.isBlank())) {
                continue;
            }
            sb.append(sb.isEmpty() ? '?' : '&')
                    .append(encode(entry.getKey()))
                    .append('=')
                    .append(encode(String.valueOf(value)));
        }
        return sb.toString();
    }

    static Map<String, Object> params() {
        return new LinkedHashMap<>();
    }

    /**
     * Node 的 {@code money} 是 {@code z.string()}（"1999" / "1999.50"），不是 number。
     * AntD 的 InputNumber 给的是数字，BFF 负责转成字符串，前端不必知道这个细节。
     */
    static String money(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof BigDecimal decimal) {
            return decimal.setScale(Math.max(decimal.scale(), 0)).toPlainString();
        }
        if (value instanceof Number number) {
            return BigDecimal.valueOf(number.doubleValue()).stripTrailingZeros().toPlainString();
        }
        String text = String.valueOf(value).trim();
        return text.isEmpty() ? null : text;
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }
}
