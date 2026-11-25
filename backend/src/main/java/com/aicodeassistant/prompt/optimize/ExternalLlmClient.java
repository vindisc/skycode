package com.aicodeassistant.prompt.optimize;

import com.aicodeassistant.llm.LlmApiException;
import com.aicodeassistant.llm.LlmHttpProperties;
import com.aicodeassistant.llm.LlmUserAgent;
import com.aicodeassistant.settings.SceneBindingService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.time.Duration;
import java.util.function.Function;
import java.util.Optional;

/**
 * 独立于主会话 Provider 链路的 OpenAI 兼容对话客户端，目前只给「优化提示词」用。
 * <p>
 * 不走 {@code LlmProviderRegistry}：优化提示词只是一个小而快的旁路调用，不该占用主会话的
 * 轮换 Key、计费统计和熔断状态。端点来源按优先级：
 * <ol>
 *   <li>设置页的场景绑定 {@code prompt_optimize}（服务商池里的条目）</li>
 *   <li>环境变量 {@code PROMPT_OPTIMIZE_API_KEY / PROMPT_OPTIMIZE_MODEL / PROMPT_OPTIMIZE_BASE_URL}</li>
 *   <li>都没配 → 不启用</li>
 * </ol>
 */
@Service
public class ExternalLlmClient {

    public static final String ENV_API_KEY = "PROMPT_OPTIMIZE_API_KEY";
    public static final String ENV_MODEL = "PROMPT_OPTIMIZE_MODEL";
    public static final String ENV_BASE_URL = "PROMPT_OPTIMIZE_BASE_URL";

    public static final String SOURCE_SCENE_BINDING = "scene_binding";
    public static final String SOURCE_ENV = "env";

    private static final MediaType JSON_MEDIA = MediaType.get("application/json");
    private static final Duration CALL_TIMEOUT = Duration.ofSeconds(60);
    private static final int ERROR_BODY_LIMIT = 200;

    /**
     * 一个可直接调用的端点。apiKey 是明文，只在进程内部传递，不能出现在任何响应或日志里。
     *
     * @param source {@link #SOURCE_SCENE_BINDING} 或 {@link #SOURCE_ENV}
     */
    public record Endpoint(String source, String providerName, String baseUrl, String apiKey, String model) {}

    public record Completion(String text, String model) {}

    private final SceneBindingService sceneBindings;
    private final ObjectMapper objectMapper;
    private final Function<String, String> env;
    private final OkHttpClient httpClient;

    // 这个类有两个构造器，Spring 不会替我们挑：必须显式标出走依赖注入的那一个，
    // 否则它会去找无参构造器，整个应用上下文都起不来
    @Autowired
    public ExternalLlmClient(SceneBindingService sceneBindings,
                             ObjectMapper objectMapper,
                             LlmHttpProperties httpProperties) {
        this(sceneBindings, objectMapper, httpProperties, System::getenv);
    }

    ExternalLlmClient(SceneBindingService sceneBindings,
                      ObjectMapper objectMapper,
                      LlmHttpProperties httpProperties,
                      Function<String, String> env) {
        this.sceneBindings = sceneBindings;
        this.objectMapper = objectMapper;
        this.env = env;
        this.httpClient = new OkHttpClient.Builder()
                .addNetworkInterceptor(LlmUserAgent.interceptor())
                .connectTimeout(Duration.ofSeconds(httpProperties.connectTimeoutSeconds()))
                .readTimeout(CALL_TIMEOUT)
                .writeTimeout(Duration.ofSeconds(httpProperties.writeTimeoutSeconds()))
                .callTimeout(CALL_TIMEOUT)
                .build();
    }

    /** 当前生效的端点；场景绑定优先，其次环境变量，都没配返回空。 */
    public Optional<Endpoint> resolveEndpoint() {
        Optional<SceneBindingService.Resolved> bound = sceneBindings.resolve(SceneBindingService.PROMPT_OPTIMIZE);
        if (bound.isPresent()) {
            SceneBindingService.Resolved resolved = bound.get();
            return Optional.of(new Endpoint(SOURCE_SCENE_BINDING, resolved.providerName(),
                    resolved.baseUrl(), resolved.apiKey(), resolved.modelId()));
        }
        String apiKey = blankToNull(env.apply(ENV_API_KEY));
        String model = blankToNull(env.apply(ENV_MODEL));
        String baseUrl = blankToNull(env.apply(ENV_BASE_URL));
        if (apiKey == null || model == null || baseUrl == null) return Optional.empty();
        return Optional.of(new Endpoint(SOURCE_ENV, "环境变量", baseUrl, apiKey, model));
    }

    /**
     * 发一次最小的对话请求来验证端点可用。上游返回 2xx 且响应里有 {@code choices} 就算连通——
     * 不检查正文，因为推理模型可能在很小的输出预算下只产出思考、正文为空。
     *
     * @return 往返耗时（毫秒）
     */
    public long probe(Endpoint endpoint) {
        ObjectNode body = baseRequest(endpoint);
        body.put("max_tokens", 16);
        addMessage(body, "system", "You are a connectivity probe.");
        addMessage(body, "user", "Reply with the single word: ok");
        long started = System.nanoTime();
        execute(endpoint, body.toString());
        return Duration.ofNanos(System.nanoTime() - started).toMillis();
    }

    /** 非流式对话，返回首条回复的正文。 */
    public Completion chat(Endpoint endpoint, String systemPrompt, String userContent, int maxTokens) {
        ObjectNode body = baseRequest(endpoint);
        body.put("max_tokens", maxTokens);
        addMessage(body, "system", systemPrompt);
        addMessage(body, "user", userContent);
        JsonNode root = execute(endpoint, body.toString());
        String text = contentText(root.path("choices").path(0).path("message").path("content"));
        if (text.isBlank()) {
            throw new LlmApiException("优化模型没有返回内容（model=" + endpoint.model() + "）", false);
        }
        return new Completion(text.trim(), endpoint.model());
    }

    // ───── 内部 ─────

    private ObjectNode baseRequest(Endpoint endpoint) {
        ObjectNode body = objectMapper.createObjectNode();
        body.put("model", endpoint.model());
        body.put("stream", false);
        body.putArray("messages");
        return body;
    }

    private static void addMessage(ObjectNode body, String role, String content) {
        // 追加到 baseRequest 建好的数组里；putArray 会整个替换掉同名字段，不能用在这里
        ((ArrayNode) body.get("messages")).addObject().put("role", role).put("content", content);
    }

    /** @return 上游 2xx 时解析后的响应体；否则抛 {@link LlmApiException} */
    private JsonNode execute(Endpoint endpoint, String json) {
        Request request = new Request.Builder()
                .url(endpoint.baseUrl() + "/chat/completions")
                .header("Authorization", "Bearer " + endpoint.apiKey())
                .post(RequestBody.create(json, JSON_MEDIA))
                .build();
        try (Response response = httpClient.newCall(request).execute()) {
            String raw = response.body() == null ? "" : response.body().string();
            if (!response.isSuccessful()) {
                int status = response.code();
                throw new LlmApiException("优化模型返回 HTTP " + status + errorDetail(raw, endpoint),
                        status == 429 || status >= 500, status);
            }
            JsonNode root = objectMapper.readTree(raw);
            if (root == null || !root.has("choices")) {
                throw new LlmApiException("优化模型返回的内容不是 Chat Completions 格式", false);
            }
            return root;
        } catch (IOException e) {
            throw new LlmApiException("连接优化模型失败：" + e.getMessage(), e, true);
        }
    }

    /** 上游错误正文只保留开头一小段，并且抹掉里面可能回显的密钥。 */
    private static String errorDetail(String raw, Endpoint endpoint) {
        if (raw == null || raw.isBlank()) return "";
        String detail = raw.strip();
        if (detail.length() > ERROR_BODY_LIMIT) detail = detail.substring(0, ERROR_BODY_LIMIT) + "…";
        if (endpoint.apiKey() != null && !endpoint.apiKey().isEmpty()) {
            detail = detail.replace(endpoint.apiKey(), "***");
        }
        return " " + detail;
    }

    /** 正文通常是字符串；部分中转站返回 [{type:"text", text:"…"}] 数组，取其中所有文字拼起来。 */
    private static String contentText(JsonNode content) {
        if (content.isMissingNode() || content.isNull()) return "";
        if (content.isTextual()) return content.asText();
        if (content.isArray()) {
            StringBuilder out = new StringBuilder();
            for (JsonNode part : content) {
                if ("text".equals(part.path("type").asText()) && part.path("text").isTextual()) {
                    if (!out.isEmpty()) out.append('\n');
                    out.append(part.path("text").asText());
                }
            }
            return out.toString();
        }
        return "";
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
