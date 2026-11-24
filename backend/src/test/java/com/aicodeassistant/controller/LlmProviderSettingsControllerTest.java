package com.aicodeassistant.controller;

import com.aicodeassistant.exception.RequestValidationException;
import com.aicodeassistant.llm.DbProviderRegistrySync;
import com.aicodeassistant.llm.DbProviderRegistrySync.ModelSkip;
import com.aicodeassistant.llm.DbProviderRegistrySync.ProviderSync;
import com.aicodeassistant.llm.DbProviderRegistrySync.SyncResult;
import com.aicodeassistant.llm.LlmApiException;
import com.aicodeassistant.prompt.optimize.ExternalLlmClient;
import com.aicodeassistant.settings.LlmProviderSettingsService;
import com.aicodeassistant.settings.LlmProviderSettingsService.ProviderInput;
import com.aicodeassistant.settings.SettingsRepository;
import com.aicodeassistant.settings.SettingsTestSupport;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;

import java.nio.file.Path;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * /api/settings/llm-providers — 服务商池的接口层：响应里只能有打码后的密钥，
 * 每次改动都要触发一次运行时同步并把结果带回去。
 */
class LlmProviderSettingsControllerTest {

    private static final String RAW_KEY = "sk-controller-test-key-1234567890";

    @TempDir
    Path temp;

    private final DbProviderRegistrySync sync = mock(DbProviderRegistrySync.class);
    private final ExternalLlmClient external = mock(ExternalLlmClient.class);
    private LlmProviderSettingsService pool;
    private LlmProviderSettingsController controller;

    @BeforeEach
    void setUp() {
        JdbcTemplate jdbc = SettingsTestSupport.globalDb(temp);
        pool = new LlmProviderSettingsService(new SettingsRepository(jdbc), SettingsTestSupport.encryption(),
                new ObjectMapper());
        controller = new LlmProviderSettingsController(pool, sync, external);
    }

    @Test
    void responsesNeverCarryTheRawKey() throws Exception {
        SyncResult result = routing("db:relay", "gpt-6.2-sol");
        when(sync.sync()).thenReturn(result);
        when(sync.last()).thenReturn(result);

        var created = controller.create(input("relay", "gpt-6.2-sol"));
        var listed = controller.list();

        ObjectMapper mapper = new ObjectMapper();
        assertThat(mapper.writeValueAsString(created)).doesNotContain(RAW_KEY);
        assertThat(mapper.writeValueAsString(listed)).doesNotContain(RAW_KEY);
        assertThat(created.provider().apiKeyMasked()).isEqualTo("••••7890");
        assertThat(created.routing()).hasSize(1);
        assertThat(listed.providers()).extracting(p -> p.key()).containsExactly("relay");
        assertThat(listed.apiKeyStorageReady()).isTrue();
        assertThat(listed.routing()).hasSize(1);
    }

    @Test
    void everyMutationResyncsTheRuntimeRegistry() {
        when(sync.sync()).thenReturn(routing("db:relay", "gpt-6.2-sol"));

        controller.create(input("relay", "gpt-6.2-sol"));
        controller.update("relay", new ProviderInput("中转站", "https://relay.example/v1", null,
                List.of("gpt-6.2-sol", "gpt-6.1-sol"), null, null));
        controller.reload();
        assertThat(controller.delete("relay").getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);

        verify(sync, times(4)).sync();
        assertThat(pool.list()).isEmpty();
    }

    @Test
    void routingCanBeFetchedWithoutTriggeringASync() {
        assertThat(controller.routingOnly().routing()).isEmpty();
        when(sync.last()).thenReturn(routing("db:relay", "gpt-6.2-sol"));
        assertThat(controller.routingOnly().routing()).hasSize(1);
        verify(sync, never()).sync();
    }

    @Test
    void connectivityTestReportsLatencyAndUsesTheStoredConnectionDetails() {
        String key = pool.create(new ProviderInput("中转站", "https://relay.example/v1/", RAW_KEY,
                List.of("gpt-6.2-sol", "gpt-6.1-sol"), "gpt-6.1-sol", null)).key();
        when(external.probe(any())).thenReturn(42L);

        var result = controller.test(key, null);

        assertThat(result.ok()).isTrue();
        assertThat(result.model()).isEqualTo("gpt-6.1-sol");
        assertThat(result.latencyMs()).isEqualTo(42L);
        assertThat(result.error()).isNull();
        ArgumentCaptor<ExternalLlmClient.Endpoint> endpoint = ArgumentCaptor.forClass(ExternalLlmClient.Endpoint.class);
        verify(external).probe(endpoint.capture());
        assertThat(endpoint.getValue().apiKey()).isEqualTo(RAW_KEY);
        assertThat(endpoint.getValue().baseUrl()).isEqualTo("https://relay.example/v1");

        // 也可以指定测哪个模型。times(2) 会把两次调用都重新捕获一遍，所以取最后一个
        controller.test(key, new LlmProviderSettingsController.TestRequest(" gpt-6.2-sol "));
        verify(external, times(2)).probe(endpoint.capture());
        assertThat(endpoint.getAllValues().getLast().model()).isEqualTo("gpt-6.2-sol");
    }

    @Test
    void failedConnectivityTestIsAResultNotAnException() {
        String key = pool.create(input("relay", "gpt-6.2-sol")).key();
        when(external.probe(any())).thenThrow(new LlmApiException("优化模型返回 HTTP 401", false, 401));

        var result = controller.test(key, null);

        assertThat(result.ok()).isFalse();
        assertThat(result.error()).contains("401");
    }

    @Test
    void connectivityTestRejectsUnknownProvidersAndUnlistedModels() {
        String key = pool.create(input("relay", "gpt-6.2-sol")).key();

        assertCode(() -> controller.test("nope", null), "PROVIDER_NOT_FOUND");
        assertCode(() -> controller.test(key, new LlmProviderSettingsController.TestRequest("glm-5.4")),
                "INVALID_PROVIDER");
        assertCode(() -> controller.create(new ProviderInput("x", "https://x.example/v1", RAW_KEY, List.of(), null, null)),
                "INVALID_PROVIDER");
        verify(sync, never()).sync();
        verify(external, never()).probe(any());
    }

    // ───── 辅助 ─────

    private static ProviderInput input(String name, String model) {
        return new ProviderInput(name, "https://relay.example/v1", RAW_KEY, List.of(model), null, null);
    }

    private static SyncResult routing(String registeredAs, String model) {
        return new SyncResult(List.of(new ProviderSync("relay", "中转站", registeredAs, List.of(model),
                model, List.of(new ModelSkip(model, "示例原因")), null, false)));
    }

    private static void assertCode(org.assertj.core.api.ThrowableAssert.ThrowingCallable call, String code) {
        assertThatThrownBy(call).isInstanceOf(RequestValidationException.class).extracting("code").isEqualTo(code);
    }
}
