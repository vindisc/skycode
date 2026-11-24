package com.aicodeassistant.prompt.optimize;

import com.aicodeassistant.llm.LlmApiException;
import com.aicodeassistant.llm.LlmHttpProperties;
import com.aicodeassistant.settings.SceneBindingService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 优化提示词用的旁路客户端：端点来源的优先级，以及对各种上游响应的处理。
 */
class ExternalLlmClientTest {

    private static final String RAW_KEY = "sk-optimize-test-key-1234567890";

    private final SceneBindingService sceneBindings = mock(SceneBindingService.class);
    private final Map<String, String> env = new HashMap<>();
    private MockWebServer server;
    private ExternalLlmClient client;

    @BeforeEach
    void setUp() throws IOException {
        server = new MockWebServer();
        server.start();
        client = new ExternalLlmClient(sceneBindings, new ObjectMapper(),
                new LlmHttpProperties(new LlmHttpProperties.PoolProperties(1, 5), 5, 5, false),
                env::get);
    }

    @AfterEach
    void tearDown() throws IOException {
        server.shutdown();
    }

    @Test
    void disabledWhenNothingIsConfigured() {
        assertThat(client.resolveEndpoint()).isEmpty();
    }

    @Test
    void envFallbackNeedsAllThreeVariables() {
        env.put(ExternalLlmClient.ENV_API_KEY, RAW_KEY);
        env.put(ExternalLlmClient.ENV_MODEL, "gpt-6.1-sol");
        assertThat(client.resolveEndpoint()).isEmpty();

        env.put(ExternalLlmClient.ENV_BASE_URL, " " + server.url("/v1") + " ");

        var endpoint = client.resolveEndpoint().orElseThrow();
        assertThat(endpoint.source()).isEqualTo(ExternalLlmClient.SOURCE_ENV);
        assertThat(endpoint.model()).isEqualTo("gpt-6.1-sol");
        assertThat(endpoint.apiKey()).isEqualTo(RAW_KEY);
        assertThat(endpoint.baseUrl()).isEqualTo(server.url("/v1").toString());
    }

    @Test
    void sceneBindingWinsOverEnvironmentVariables() {
        env.put(ExternalLlmClient.ENV_API_KEY, RAW_KEY);
        env.put(ExternalLlmClient.ENV_MODEL, "gpt-6.1-sol");
        env.put(ExternalLlmClient.ENV_BASE_URL, server.url("/v1").toString());
        when(sceneBindings.resolve(SceneBindingService.PROMPT_OPTIMIZE)).thenReturn(Optional.of(
                new SceneBindingService.Resolved(SceneBindingService.PROMPT_OPTIMIZE, "zhipu", "智谱",
                        server.url("/v4").toString(), "sk-bound-key", "glm-5.4")));

        var endpoint = client.resolveEndpoint().orElseThrow();

        assertThat(endpoint.source()).isEqualTo(ExternalLlmClient.SOURCE_SCENE_BINDING);
        assertThat(endpoint.providerName()).isEqualTo("智谱");
        assertThat(endpoint.model()).isEqualTo("glm-5.4");
        assertThat(endpoint.apiKey()).isEqualTo("sk-bound-key");
        assertThat(endpoint.baseUrl()).isEqualTo(server.url("/v4").toString());
    }

    @Test
    void chatSendsAChatCompletionsRequestAndReturnsTheContent() throws Exception {
        server.enqueue(new MockResponse().setHeader("Content-Type", "application/json").setBody("""
                {"choices":[{"message":{"role":"assistant","content":"  改写后的提示词\\n"},"finish_reason":"stop"}]}
                """));

        var completion = client.chat(endpoint(), "系统提示", "原始提示", 1234);

        assertThat(completion.text()).isEqualTo("改写后的提示词");
        assertThat(completion.model()).isEqualTo("gpt-6.1-sol");
        RecordedRequest request = server.takeRequest();
        assertThat(request.getPath()).isEqualTo("/v1/chat/completions");
        assertThat(request.getHeader("Authorization")).isEqualTo("Bearer " + RAW_KEY);
        JsonNode body = new ObjectMapper().readTree(request.getBody().readUtf8());
        assertThat(body.path("model").asText()).isEqualTo("gpt-6.1-sol");
        assertThat(body.path("max_tokens").asInt()).isEqualTo(1234);
        assertThat(body.path("stream").asBoolean()).isFalse();
        assertThat(body.path("messages")).hasSize(2);
        assertThat(body.path("messages").get(1).path("content").asText()).isEqualTo("原始提示");
    }

    @Test
    void joinsTextPartsWhenTheRelayReturnsContentAsAnArray() {
        server.enqueue(new MockResponse().setHeader("Content-Type", "application/json").setBody("""
                {"choices":[{"message":{"content":[{"type":"text","text":"第一段"},{"type":"text","text":"第二段"}]}}]}
                """));

        assertThat(client.chat(endpoint(), "s", "u", 10).text()).isEqualTo("第一段\n第二段");
    }

    @Test
    void upstreamErrorCarriesTheStatusAndNeverEchoesTheKey() {
        server.enqueue(new MockResponse().setResponseCode(401).setBody(
                "{\"error\":{\"message\":\"Incorrect API key provided: " + RAW_KEY + "\"}}"));

        assertThatThrownBy(() -> client.chat(endpoint(), "s", "u", 10))
                .isInstanceOf(LlmApiException.class)
                .satisfies(failure -> {
                    LlmApiException api = (LlmApiException) failure;
                    assertThat(api.getHttpStatus()).isEqualTo(401);
                    assertThat(api.isRetryable()).isFalse();
                    assertThat(api.getMessage()).contains("401").contains("***").doesNotContain(RAW_KEY);
                });
    }

    @Test
    void serverErrorsAndRateLimitsAreRetryable() {
        server.enqueue(new MockResponse().setResponseCode(500).setBody("boom"));
        assertThatThrownBy(() -> client.chat(endpoint(), "s", "u", 10))
                .isInstanceOf(LlmApiException.class)
                .satisfies(failure -> assertThat(((LlmApiException) failure).isRetryable()).isTrue());

        server.enqueue(new MockResponse().setResponseCode(429).setBody("{}"));
        assertThatThrownBy(() -> client.chat(endpoint(), "s", "u", 10))
                .isInstanceOf(LlmApiException.class)
                .satisfies(failure -> assertThat(((LlmApiException) failure).isRetryable()).isTrue());
    }

    @Test
    void probeAcceptsAnEmptyAnswerButNotANonChatPayload() throws Exception {
        // 推理模型在很小的输出预算下可能正文为空，只要响应形状对就算连通
        server.enqueue(new MockResponse().setHeader("Content-Type", "application/json")
                .setBody("{\"choices\":[{\"message\":{\"content\":\"\"},\"finish_reason\":\"length\"}]}"));

        long latencyMs = client.probe(endpoint());

        assertThat(latencyMs).isGreaterThanOrEqualTo(0);
        RecordedRequest request = server.takeRequest();
        assertThat(request.getPath()).isEqualTo("/v1/chat/completions");
        assertThat(request.getHeader("Authorization")).isEqualTo("Bearer " + RAW_KEY);

        server.enqueue(new MockResponse().setHeader("Content-Type", "application/json").setBody("{}"));
        assertThatThrownBy(() -> client.probe(endpoint()))
                .isInstanceOf(LlmApiException.class)
                .hasMessageContaining("Chat Completions");
    }

    @Test
    void probeReportsUpstreamFailures() {
        server.enqueue(new MockResponse().setResponseCode(404).setBody("{\"error\":\"model not found\"}"));

        assertThatThrownBy(() -> client.probe(endpoint()))
                .isInstanceOf(LlmApiException.class)
                .hasMessageContaining("404")
                .hasMessageContaining("model not found");
    }

    @Test
    void emptyContentAndUnexpectedPayloadsAreErrors() {
        server.enqueue(new MockResponse().setHeader("Content-Type", "application/json")
                .setBody("{\"choices\":[{\"message\":{\"content\":\"\"}}]}"));
        assertThatThrownBy(() -> client.chat(endpoint(), "s", "u", 10))
                .isInstanceOf(LlmApiException.class)
                .hasMessageContaining("没有返回内容");

        server.enqueue(new MockResponse().setHeader("Content-Type", "application/json").setBody("{\"ok\":true}"));
        assertThatThrownBy(() -> client.chat(endpoint(), "s", "u", 10))
                .isInstanceOf(LlmApiException.class)
                .hasMessageContaining("Chat Completions");
    }

    @Test
    void longErrorBodiesAreTruncated() {
        server.enqueue(new MockResponse().setResponseCode(400).setBody("x".repeat(2000)));

        assertThatThrownBy(() -> client.chat(endpoint(), "s", "u", 10))
                .isInstanceOf(LlmApiException.class)
                .satisfies(failure -> assertThat(failure.getMessage().length()).isLessThan(300));
    }

    private ExternalLlmClient.Endpoint endpoint() {
        env.put(ExternalLlmClient.ENV_API_KEY, RAW_KEY);
        env.put(ExternalLlmClient.ENV_MODEL, "gpt-6.1-sol");
        env.put(ExternalLlmClient.ENV_BASE_URL, server.url("/v1").toString());
        return client.resolveEndpoint().orElseThrow();
    }
}
