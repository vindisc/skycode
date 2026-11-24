package com.aicodeassistant.engine;

import com.aicodeassistant.config.oss.OssPublishProperties;
import com.aicodeassistant.llm.*;
import com.aicodeassistant.llm.impl.OpenAiCompatibleProvider;
import com.aicodeassistant.model.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okio.Buffer;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.env.MockEnvironment;

import java.time.Instant;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

/** Actual download, conversion, both guards, and the provider's final HTTP request. No API credentials. */
class UserImageRequestIntegrationTest {
    @ParameterizedTest
    @CsvSource({
            "moonshot-test, kimi-k3.1-pro-highspeed, false",
            "zenmux, anthropic/claude-fable-5.2, false",
            "zenmux, anthropic/claude-opus-5.5, false",
            "zenmux, anthropic/claude-sonnet-5.5, false",
            "zenmux, anthropic/claude-haiku-5.5, false",
            "zenmux, anthropic/claude-opus-5.5, true"
    })
    void sendsLargePngThroughBothRealGuardsAndKeepsUrlHistory(
            String providerName, String model, boolean historicalImage) throws Exception {
        try (var storage = new MockWebServer(); var api = new MockWebServer()) {
            storage.start(); api.start();
            byte[] png = UserImageTranscoderTest.png(640);
            storage.enqueue(new MockResponse().addHeader("Content-Type", "image/png")
                    .setBody(new Buffer().write(png)));
            String url = storage.url("/clipboard/image.png").toString();
            // Only the origin policy is substituted to permit the local HTTP fixture.
            var properties = mock(OssPublishProperties.class);
            when(properties.isTrustedClipboardImageUrl(url)).thenReturn(true);
            var original = UserImageTranscoderTest.message("stored-user-message", url);
            List<Message> history = historicalImage
                    ? List.of(original, new Message.AssistantMessage("previous-answer", Instant.now(),
                            List.of(new ContentBlock.TextBlock("I can see the image.")), "end_turn", null),
                            new Message.UserMessage("follow-up", Instant.now(),
                            List.of(new ContentBlock.TextBlock("describe the earlier image")), null, null))
                    : List.of(original);
            var models = new ModelRegistry(new LlmProviderRegistry(List.of(), new MockEnvironment()));
            var prepared = new UserImageTranscoder(properties).transcode(history, models.getCapabilities(model));
            var messages = MessageParamConverter.toMaps(new MessageNormalizer().normalizeTyped(prepared.messages()));
            int maxOutput = QueryConfig.getRecommendedMaxTokens(models, model);
            int inputBudget = models.getContextWindowForModel(model) - maxOutput - models.getContextWindowForModel(model) / 20;
            var checked = new TokenBudgetGuard().enforcePhase2(messages, inputBudget, Map.of(), Set.of(), 3.5);
            assertThat(checked.fitsBudget()).isTrue();
            api.enqueue(new MockResponse().addHeader("Content-Type", "text/event-stream").setBody(
                    "data: {\"id\":\"test\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"ok\"},\"finish_reason\":null}]}\n\n" +
                    "data: {\"id\":\"test\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n" +
                    "data: [DONE]\n\n"));
            var mapper = new ObjectMapper();
            var provider = new OpenAiCompatibleProvider(providerName, mapper,
                    new LlmHttpProperties(new LlmHttpProperties.PoolProperties(2, 30), 5, 5, true),
                    new ApiKeyRotationManager("test"), "test", api.url("/v1").toString(), model, List.of(model),
                    new FinalProviderPayloadGuard(models));
            var failure = new AtomicReference<Throwable>();
            provider.streamChat(model, checked.apiMessages(), "", List.of(), maxOutput, new ThinkingConfig.Disabled(),
                    LlmCallContext.unscoped(), new StreamChatCallback() {
                        public void onEvent(LlmStreamEvent event) {}
                        public void onComplete() {}
                        public void onError(Throwable error) { failure.set(error); }
                    });
            assertThat(failure.get()).isNull();
            var request = api.takeRequest(2, TimeUnit.SECONDS);
            assertThat(request).isNotNull();
            assertThat(request.getPath()).isEqualTo("/v1/chat/completions");
            var body = mapper.readTree(request.getBody().readUtf8());
            assertThat(body.path("model").asText()).isEqualTo(model);
            assertThat(body.path("messages")).hasSize(history.size());
            var imageUrl = body.path("messages").get(0).path("content").get(1).path("image_url").path("url").asText();
            assertThat(imageUrl).startsWith("data:image/png;base64,");
            assertThat(Base64.getDecoder().decode(imageUrl.substring(imageUrl.indexOf(',') + 1))).isEqualTo(png);
            assertThat(body.toString()).doesNotContain(url);
            assertThat(((ContentBlock.ImageBlock) original.content().get(1)).url()).isEqualTo(url);
            assertThat(storage.getRequestCount()).isEqualTo(1);
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "claude-sonnet-4-6", "claude-haiku-4-5", "openrouter/anthropic/claude-fable-5.2",
            "openai/gpt-5.6-sol", "openai/gpt-6-astra", "google/gemini-4-carbon",
            "x-ai/grok-4.7", "meta/muse-wonder-1.0", "deepseek-v4.1-flash"
    })
    void otherModelRoutesKeepUrlAttachmentsWithoutDownloading(String model) throws Exception {
        var models = new ModelRegistry(new LlmProviderRegistry(List.of(), new MockEnvironment()));
        var transcoder = new UserImageTranscoderTest.Stub(UserImageTranscoderTest.png(8));
        List<Message> history = List.of(UserImageTranscoderTest.message(
                "current", UserImageTranscoderTest.URL + "image.png"));

        var prepared = transcoder.transcode(history, models.getCapabilities(model));

        assertThat(prepared.messages()).isSameAs(history);
        assertThat(transcoder.downloads).isZero();
    }

    /** 纯文本模型：历史图片在请求副本里降级为占位文本，真实出网 payload 不含 image_url。 */
    @org.junit.jupiter.api.Test
    void textOnlyModelSendsPlaceholderInsteadOfHistoryImage() throws Exception {
        try (var api = new MockWebServer()) {
            api.start();
            String model = "glm-5.3";
            // 历史里有一张已持久化的图片，当前请求本身是纯文本
            List<Message> history = List.of(
                    UserImageTranscoderTest.message("stored-user-message", UserImageTranscoderTest.URL + "image.png"),
                    new Message.AssistantMessage("previous-answer", Instant.now(),
                            List.of(new ContentBlock.TextBlock("I can see the image.")), "end_turn", null),
                    new Message.UserMessage("follow-up", Instant.now(),
                            List.of(new ContentBlock.TextBlock("describe the earlier image")), null, null));
            var models = new ModelRegistry(new LlmProviderRegistry(List.of(), new MockEnvironment()));
            var caps = models.getCapabilities(model);
            assertThat(UserImageTranscoder.rejectsImages(caps)).isTrue();
            var transcoder = new UserImageTranscoderTest.Stub(UserImageTranscoderTest.png(8));
            var prepared = transcoder.transcode(history, caps);
            var messages = MessageParamConverter.toMaps(new MessageNormalizer().normalizeTyped(prepared.messages()));
            int maxOutput = QueryConfig.getRecommendedMaxTokens(models, model);
            var checked = new TokenBudgetGuard().enforcePhase2(messages,
                    models.getContextWindowForModel(model) - maxOutput, Map.of(), Set.of(), 3.5);
            api.enqueue(new MockResponse().addHeader("Content-Type", "text/event-stream").setBody(
                    "data: {\"id\":\"test\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"ok\"},\"finish_reason\":null}]}\n\n" +
                    "data: {\"id\":\"test\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n" +
                    "data: [DONE]\n\n"));
            var mapper = new ObjectMapper();
            var provider = new OpenAiCompatibleProvider("zhipu", mapper,
                    new LlmHttpProperties(new LlmHttpProperties.PoolProperties(2, 30), 5, 5, true),
                    new ApiKeyRotationManager("test"), "test", api.url("/v1").toString(), model, List.of(model),
                    new FinalProviderPayloadGuard(models));
            var failure = new AtomicReference<Throwable>();
            provider.streamChat(model, checked.apiMessages(), "", List.of(), maxOutput, new ThinkingConfig.Disabled(),
                    LlmCallContext.unscoped(), new StreamChatCallback() {
                        public void onEvent(LlmStreamEvent event) {}
                        public void onComplete() {}
                        public void onError(Throwable error) { failure.set(error); }
                    });
            assertThat(failure.get()).isNull();
            var request = api.takeRequest(2, TimeUnit.SECONDS);
            assertThat(request).isNotNull();
            var body = mapper.readTree(request.getBody().readUtf8());
            assertThat(body.path("model").asText()).isEqualTo(model);
            assertThat(body.path("messages")).hasSize(history.size());
            assertThat(body.toString()).doesNotContain("image_url");
            // 注意：全是 text 的 content 在出网时会被折叠成字符串而不是分块数组，
            // 所以这里两种形态都取成纯文本再断言，不按数组下标写。
            var firstContent = body.path("messages").get(0).path("content");
            assertThat(firstContent.isTextual() || firstContent.isArray()).isTrue();
            StringBuilder firstText = new StringBuilder();
            if (firstContent.isTextual()) {
                firstText.append(firstContent.asText());
            } else {
                firstContent.forEach(part -> {
                    assertThat(part.path("type").asText()).isEqualTo("text");
                    firstText.append(part.path("text").asText()).append('\n');
                });
            }
            assertThat(firstText.toString()).contains("look")
                    .contains(UserImageTranscoder.OMITTED_PREFIX + UserImageTranscoder.UNSUPPORTED_MODEL_REASON + "]");
            assertThat(transcoder.downloads).isZero();
            // 持久化历史里的原图引用未被改写，切回视觉模型时仍然可用
            assertThat(((ContentBlock.ImageBlock) ((Message.UserMessage) history.get(0)).content().get(1)).url())
                    .isEqualTo(UserImageTranscoderTest.URL + "image.png");
        }
    }
}
