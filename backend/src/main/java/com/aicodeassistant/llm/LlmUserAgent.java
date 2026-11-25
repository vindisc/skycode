package com.aicodeassistant.llm;

import okhttp3.Interceptor;

/**
 * 发往模型服务商的 HTTP 请求统一带的 User-Agent。
 * <p>
 * 不能用 OkHttp 默认的 {@code okhttp/x.y.z}：智谱（bigmodel.cn）对这类 UA 一律回 429
 * 「该模型当前访问量过大」（code 1305），主对话、压缩摘要、模型清单全都中招；同一个 key、同一个请求体
 * 换成别的 UA 就是 200。2026-11-25 从容器里交替实测 9 次，次次如此。
 * <p>
 * 所有发往模型服务商的 OkHttp 客户端都要装上 {@link #interceptor()}。
 */
public final class LlmUserAgent {

    public static final String VALUE = "zhikuncode/1.0";

    private LlmUserAgent() {}

    /** OkHttp 的 Builder 没有直接设 UA 的方法，用网络拦截器给每个请求加上（会盖掉默认的 okhttp/x.y.z）。 */
    public static Interceptor interceptor() {
        return chain -> chain.proceed(
                chain.request().newBuilder().header("User-Agent", VALUE).build());
    }
}
