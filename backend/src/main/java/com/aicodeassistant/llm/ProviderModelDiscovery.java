package com.aicodeassistant.llm;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.TreeSet;

/**
 * 向 OpenAI 兼容接口的 {@code GET /models} 要模型清单，给设置页的「从接口获取模型」用。
 * 只读清单，不发对话请求，不产生用量。
 */
@Service
public class ProviderModelDiscovery {

    private static final Duration CALL_TIMEOUT = Duration.ofSeconds(20);
    private static final int ERROR_BODY_LIMIT = 200;

    private final OkHttpClient httpClient;
    private final ObjectMapper objectMapper;

    public ProviderModelDiscovery(LlmHttpProperties httpProperties, ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
        this.httpClient = new OkHttpClient.Builder()
                .addNetworkInterceptor(LlmUserAgent.interceptor())
                .connectTimeout(Duration.ofSeconds(httpProperties.connectTimeoutSeconds()))
                .readTimeout(CALL_TIMEOUT)
                .callTimeout(CALL_TIMEOUT)
                .build();
    }

    /**
     * @param baseUrl 形如 {@code https://api.example.com/v1}，末尾带不带斜杠都行
     * @param apiKey  可以为空（本地模型）；非空时作为 Bearer 令牌带上
     * @return 去重、按字典序排好的模型 ID
     */
    public List<String> listModels(String baseUrl, String apiKey) {
        String url = baseUrl.replaceAll("/+$", "") + "/models";
        Request.Builder request = new Request.Builder().url(url).get();
        if (apiKey != null && !apiKey.isBlank()) {
            request.header("Authorization", "Bearer " + apiKey);
        }
        try (Response response = httpClient.newCall(request.build()).execute()) {
            String raw = response.body() == null ? "" : response.body().string();
            if (!response.isSuccessful()) {
                int status = response.code();
                throw new LlmApiException("获取模型列表失败：HTTP " + status + errorDetail(raw, apiKey),
                        status == 429 || status >= 500, status);
            }
            JsonNode data = objectMapper.readTree(raw).path("data");
            if (!data.isArray()) {
                throw new LlmApiException("接口返回的不是模型清单（缺少 data 列表）", false);
            }
            TreeSet<String> ids = new TreeSet<>();
            for (JsonNode item : data) {
                String id = item.isTextual() ? item.asText() : item.path("id").asText("");
                if (!id.isBlank()) ids.add(id);
            }
            return new ArrayList<>(ids);
        } catch (IOException e) {
            throw new LlmApiException("连接服务商失败：" + e.getMessage(), e, true);
        }
    }

    /** 上游错误正文只保留开头一小段，并抹掉里面可能回显的密钥。 */
    private static String errorDetail(String raw, String apiKey) {
        if (raw == null || raw.isBlank()) return "";
        String detail = raw.strip();
        if (detail.length() > ERROR_BODY_LIMIT) detail = detail.substring(0, ERROR_BODY_LIMIT) + "…";
        if (apiKey != null && !apiKey.isBlank()) detail = detail.replace(apiKey, "***");
        return " " + detail;
    }
}
