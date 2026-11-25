package com.aicodeassistant.controller;

import com.aicodeassistant.exception.RequestValidationException;
import com.aicodeassistant.llm.DbProviderRegistrySync;
import com.aicodeassistant.llm.DbProviderRegistrySync.ModelSkip;
import com.aicodeassistant.llm.DbProviderRegistrySync.ProviderSync;
import com.aicodeassistant.llm.DbProviderRegistrySync.SyncResult;
import com.aicodeassistant.llm.LlmApiException;
import com.aicodeassistant.llm.LlmHttpProperties;
import com.aicodeassistant.llm.ProviderModelDiscovery;
import com.aicodeassistant.prompt.optimize.ExternalLlmClient;
import com.aicodeassistant.settings.LlmProviderSettingsService;
import com.aicodeassistant.settings.LlmProviderSettingsService.ProviderInput;
import com.aicodeassistant.settings.SettingsRepository;
import com.aicodeassistant.settings.SettingsTestSupport;
import com.fasterxml.jackson.databind.ObjectMapper;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;

import java.io.IOException;
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
 * 每次改动都要触发一次运行时同步并把结果带回去；从接口获取模型清单走服务商的 /models。
 */
class LlmProviderSettingsControllerTest {

    private static final String RAW_KEY = "sk-controller-test-key-1234567890";

    @TempDir
    Path temp;

    private final DbProviderRegistrySync sync = mock(DbProviderRegistrySync.class);
    private final ExternalLlmClient external = mock(ExternalLlmClient.class);
    private MockWebServer relay;
    private LlmProviderSettingsService pool;
    private LlmProviderSettingsController controller;

    @BeforeEach
    void setUp() throws IOException {
        JdbcTemplate jdbc = SettingsTestSupport.globalDb(temp);
        pool = new LlmProviderSettingsService(new SettingsRepository(jdbc), SettingsTestSupport.encryption(),
                new ObjectMapper());
        relay = new MockWebServer();
        relay.start();
        controller = new LlmProviderSettingsController(pool, sync, external, new ProviderModelDiscovery(
                new LlmHttpProperties(new LlmHttpProperties.PoolProperties(1, 5), 5, 5, false), new ObjectMapper()));
    }

    @AfterEach
    void tearDown() throws IOException {
        relay.shutdown();
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

    @Test
    void discoverAsksTheRelayForItsModelListUsingTheKeyTypedInTheForm() throws Exception {
        relay.enqueue(new MockResponse().setHeader("Content-Type", "application/json").setBody("""
                {"object":"list","data":[{"id":"gpt-6.2-sol"},{"id":"codex-auto-review"},{"id":"gpt-6.2-sol"}]}
                """));

        var response = controller.discover(new LlmProviderSettingsController.DiscoverRequest(
                relay.url("/v1").toString(), "sk-typed-in-form", null));

        // 去重、排序
        assertThat(response.models()).containsExactly("codex-auto-review", "gpt-6.2-sol");
        var request = relay.takeRequest();
        assertThat(request.getMethod()).isEqualTo("GET");
        assertThat(request.getPath()).isEqualTo("/v1/models");
        assertThat(request.getHeader("Authorization")).isEqualTo("Bearer sk-typed-in-form");
        // 只读清单，什么都不保存
        assertThat(pool.list()).isEmpty();
        verify(sync, never()).sync();
    }

    @Test
    void discoverReusesTheStoredKeyWhenEditingASavedProvider() throws Exception {
        String key = pool.create(input("relay", "gpt-6.2-sol")).key();
        relay.enqueue(new MockResponse().setHeader("Content-Type", "application/json").setBody("""
                {"data":[{"id":"glm-5.4"}]}
                """));

        controller.discover(new LlmProviderSettingsController.DiscoverRequest(
                relay.url("/v1").toString(), null, key));

        assertThat(relay.takeRequest().getHeader("Authorization")).isEqualTo("Bearer " + RAW_KEY);
    }

    @Test
    void discoverRequiresACompleteHttpAddress() {
        assertCode(() -> controller.discover(null), "INVALID_PROVIDER");
        assertCode(() -> controller.discover(new LlmProviderSettingsController.DiscoverRequest("  ", "k", null)),
                "INVALID_PROVIDER");
        assertCode(() -> controller.discover(new LlmProviderSettingsController.DiscoverRequest("api.example.com/v1", "k", null)),
                "INVALID_PROVIDER");
        assertThat(relay.getRequestCount()).isZero();
    }

    @Test
    void discoverSurfacesRelayFailuresWithoutEchoingTheKey() {
        relay.enqueue(new MockResponse().setResponseCode(401).setBody(
                "{\"error\":{\"message\":\"Incorrect API key provided: sk-secret-key-123456\"}}"));

        assertThatThrownBy(() -> controller.discover(new LlmProviderSettingsController.DiscoverRequest(
                relay.url("/v1").toString(), "sk-secret-key-123456", null)))
                .isInstanceOf(LlmApiException.class)
                .hasMessageContaining("401")
                .hasMessageContaining("***")
                .hasMessageNotContaining("sk-secret-key-123456");
    }

    @Test
    void discoverRejectsAResponseThatIsNotAModelList() {
        relay.enqueue(new MockResponse().setHeader("Content-Type", "application/json").setBody("{\"ok\":true}"));

        assertThatThrownBy(() -> controller.discover(new LlmProviderSettingsController.DiscoverRequest(
                relay.url("/v1").toString(), "k", null)))
                .isInstanceOf(LlmApiException.class)
                .hasMessageContaining("不是模型清单");
    }

    // ───── 辅助 ─────

    private static ProviderInput input(String name, String model) {
        return new ProviderInput(name, "https://relay.example/v1", RAW_KEY, List.of(model), null, null);
    }

    private static SyncResult routing(String registeredAs, String model) {
        return new SyncResult(List.of(new ProviderSync("relay", "中转站", registeredAs, List.of(model), List.of(),
                model, List.of(new ModelSkip(model, "示例原因")), null, false)));
    }

    private static void assertCode(org.assertj.core.api.ThrowableAssert.ThrowingCallable call, String code) {
        assertThatThrownBy(call).isInstanceOf(RequestValidationException.class).extracting("code").isEqualTo(code);
    }
}
