package com.aicodeassistant.prompt.optimize;

import com.aicodeassistant.exception.RequestValidationException;
import com.aicodeassistant.llm.LlmApiException;
import com.aicodeassistant.prompt.optimize.PromptOptimizeController.OptimizeRequest;
import org.junit.jupiter.api.Test;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class PromptOptimizeControllerTest {

    private final ExternalLlmClient client = mock(ExternalLlmClient.class);
    private final PromptOptimizeController controller = new PromptOptimizeController(client);

    @Test
    void statusReportsTheEffectiveEndpointWithoutLeakingTheKey() {
        when(client.resolveEndpoint()).thenReturn(Optional.of(endpoint("sk-secret-key")));

        var status = controller.status();

        assertThat(status.enabled()).isTrue();
        assertThat(status.model()).isEqualTo("gpt-6.1-sol");
        assertThat(status.providerName()).isEqualTo("火神");
        assertThat(status.source()).isEqualTo("scene_binding");
    }

    @Test
    void statusIsDisabledWhenNoEndpointIsConfigured() {
        when(client.resolveEndpoint()).thenReturn(Optional.empty());

        var status = controller.status();

        assertThat(status.enabled()).isFalse();
        assertThat(status.model()).isNull();
    }

    @Test
    void optimizeReturnsTheRewrittenPrompt() {
        when(client.resolveEndpoint()).thenReturn(Optional.of(endpoint("k")));
        when(client.chat(any(), anyString(), eq("原始提示"), anyInt()))
                .thenReturn(new ExternalLlmClient.Completion("改写后的提示", "gpt-6.1-sol"));

        var response = controller.optimize(new OptimizeRequest("  原始提示  "));

        assertThat(response.optimized()).isEqualTo("改写后的提示");
        assertThat(response.model()).isEqualTo("gpt-6.1-sol");
        verify(client).chat(any(), eq(PromptOptimizeController.SYSTEM_PROMPT), eq("原始提示"),
                eq(PromptOptimizeController.MAX_OUTPUT_TOKENS));
    }

    @Test
    void rejectsEmptyAndOversizedPromptsBeforeCallingTheModel() {
        when(client.resolveEndpoint()).thenReturn(Optional.of(endpoint("k")));

        assertCode(() -> controller.optimize(null), "EMPTY_PROMPT");
        assertCode(() -> controller.optimize(new OptimizeRequest(null)), "EMPTY_PROMPT");
        assertCode(() -> controller.optimize(new OptimizeRequest("   ")), "EMPTY_PROMPT");
        assertCode(() -> controller.optimize(new OptimizeRequest("x".repeat(PromptOptimizeController.MAX_PROMPT_LENGTH + 1))),
                "PROMPT_TOO_LONG");
        verify(client, never()).chat(any(), anyString(), anyString(), anyInt());
    }

    @Test
    void unconfiguredEndpointIsReportedAsDisabledNotAsAnUpstreamFailure() {
        when(client.resolveEndpoint()).thenReturn(Optional.empty());

        assertCode(() -> controller.optimize(new OptimizeRequest("提示")), "PROMPT_OPTIMIZE_DISABLED");
    }

    @Test
    void upstreamFailuresSurfaceAsLlmApiExceptions() {
        when(client.resolveEndpoint()).thenReturn(Optional.of(endpoint("k")));
        when(client.chat(any(), anyString(), anyString(), anyInt()))
                .thenThrow(new LlmApiException("优化模型返回 HTTP 500", true, 500));

        // GlobalExceptionHandler 把它映射为 503 LLM_API_ERROR
        assertThatThrownBy(() -> controller.optimize(new OptimizeRequest("提示")))
                .isInstanceOf(LlmApiException.class)
                .satisfies(failure -> assertThat(((LlmApiException) failure).isRetryable()).isTrue());
    }

    private static ExternalLlmClient.Endpoint endpoint(String key) {
        return new ExternalLlmClient.Endpoint(ExternalLlmClient.SOURCE_SCENE_BINDING, "火神",
                "https://relay.example/v1", key, "gpt-6.1-sol");
    }

    private static void assertCode(org.assertj.core.api.ThrowableAssert.ThrowingCallable call, String code) {
        assertThatThrownBy(call).isInstanceOf(RequestValidationException.class).extracting("code").isEqualTo(code);
    }
}
