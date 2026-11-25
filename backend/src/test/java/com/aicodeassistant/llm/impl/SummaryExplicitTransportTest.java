package com.aicodeassistant.llm.impl;

import com.aicodeassistant.llm.ApiKeyRotationManager;
import com.aicodeassistant.llm.LlmCallContext;
import com.aicodeassistant.llm.LlmHttpProperties;
import com.aicodeassistant.llm.SummaryRequest;
import com.aicodeassistant.llm.SummaryResult;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.util.List;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 场景分派里明确指定的摘要目标：不经过端点和型号白名单，请求按最通用的写法发。
 */
class SummaryExplicitTransportTest {

    private final ObjectMapper mapper = new ObjectMapper();
    private MockWebServer relay;
    private OpenAiCompatibleProvider provider;

    @BeforeEach
    void setUp() throws IOException {
        relay = new MockWebServer();
        relay.start();
        provider = new OpenAiCompatibleProvider("relay", mapper,
                new LlmHttpProperties(new LlmHttpProperties.PoolProperties(1, 5), 5, 5, false),
                new ApiKeyRotationManager("sk-relay"), "sk-relay", relay.url("/v1").toString(),
                "gpt-6.2-sol", List.of("gpt-6.2-sol", "deepseek-flash", "some-new-model"));
    }

    @AfterEach
    void tearDown() throws IOException {
        relay.shutdown();
    }

    @Test
    void anExplicitTargetIsAcceptedEvenThoughTheEndpointIsNotWhitelisted() {
        // 老路：中转站不在白名单里，型号也不在内置的几个里 → 不支持
        assertThat(provider.supportsSummary("gpt-6.2-sol", SummaryRequest.ThinkingMode.MAX)).isFalse();
        assertThat(provider.summarize(request("gpt-6.2-sol", 500), LlmCallContext.unscoped()).failureReason())
                .isEqualTo("unsupported_summary");

        // 用户明确指定的路：只要求这个 Provider 的清单里有这个模型
        assertThat(provider.supportsExplicitSummary("gpt-6.2-sol")).isTrue();
        assertThat(provider.supportsExplicitSummary("not-listed")).isFalse();
        assertThat(provider.summarizeExplicit(request("not-listed", 500), LlmCallContext.unscoped()).failureReason())
                .isEqualTo("unsupported_summary");
    }

    @Test
    void anUnknownModelIsSentWithMaxTokensAndNoVendorSpecificThinkingParameters() throws Exception {
        relay.enqueue(ok("<summary>ok</summary>"));

        SummaryResult result = provider.summarizeExplicit(request("some-new-model", 777), LlmCallContext.unscoped());

        assertThat(result.failureReason()).isNull();
        assertThat(result.content()).isEqualTo("<summary>ok</summary>");
        JsonNode body = takeBody();
        assertThat(body.get("model").asText()).isEqualTo("some-new-model");
        assertThat(body.get("max_tokens").asInt()).isEqualTo(777);
        assertThat(body.has("max_completion_tokens")).isFalse();
        // 不认识的型号不加厂商私有参数：加了可能被上游以"未知参数"拒掉
        assertThat(body.has("enable_thinking")).isFalse();
        assertThat(body.has("thinking")).isFalse();
        assertThat(body.has("reasoning_effort")).isFalse();
    }

    @Test
    void aDeepSeekModelKeepsItsOwnRequestShape() throws Exception {
        relay.enqueue(ok("<summary>ok</summary>"));

        provider.summarizeExplicit(request("deepseek-flash", 1000), LlmCallContext.unscoped());

        JsonNode body = takeBody();
        assertThat(body.get("max_tokens").asInt()).isEqualTo(1000);
        assertThat(body.path("thinking").path("type").asText()).isEqualTo("enabled");
        assertThat(body.get("reasoning_effort").asText()).isEqualTo("max");
        assertThat(body.has("enable_thinking")).isFalse();
    }

    @Test
    void upstreamErrorsAndEmptyAnswersAreReportedAsFailures() {
        relay.enqueue(new MockResponse().setResponseCode(400).setBody("{\"error\":\"bad request\"}"));
        assertThat(provider.summarizeExplicit(request("gpt-6.2-sol", 500), LlmCallContext.unscoped()).failureReason())
                .isEqualTo("summary_http_400");

        relay.enqueue(ok("not a summary"));
        SummaryResult result = provider.summarizeExplicit(request("gpt-6.2-sol", 500), LlmCallContext.unscoped());
        assertThat(result.failureReason()).isNull();
        assertThat(result.content()).isEqualTo("not a summary");
    }

    private MockResponse ok(String content) {
        return new MockResponse().setHeader("Content-Type", "application/json").setBody(
                "{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":" + mapper.valueToTree(content)
                        + "},\"finish_reason\":\"stop\"}]}");
    }

    private JsonNode takeBody() throws Exception {
        RecordedRequest recorded = relay.takeRequest(5, TimeUnit.SECONDS);
        assertThat(recorded).isNotNull();
        assertThat(recorded.getPath()).isEqualTo("/v1/chat/completions");
        assertThat(recorded.getHeader("Authorization")).isEqualTo("Bearer sk-relay");
        return mapper.readTree(recorded.getBody().readUtf8());
    }

    private static SummaryRequest request(String model, int maxTokens) {
        return new SummaryRequest(model, SummaryRequest.ThinkingMode.MAX, "system", "user", maxTokens,
                System.nanoTime() + TimeUnit.SECONDS.toNanos(30));
    }
}
