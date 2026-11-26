package com.aicodeassistant.controller;

import com.aicodeassistant.exception.RequestValidationException;
import com.aicodeassistant.llm.DbProviderRegistrySync;
import com.aicodeassistant.llm.LlmProviderRegistry;
import com.aicodeassistant.llm.LlmProvidersProperties;
import com.aicodeassistant.llm.ProviderModelDiscovery;
import com.aicodeassistant.prompt.optimize.ExternalLlmClient;
import com.aicodeassistant.settings.ConfiguredProviderService;
import com.aicodeassistant.settings.ConfiguredProviderService.ConfiguredProviderInput;
import com.aicodeassistant.settings.SettingsRepository;
import com.aicodeassistant.settings.SettingsTestSupport;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;

import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * /api/settings/configured-providers — 配置文件里那批服务商的接口：
 * 改动之后立即同步运行时；响应里只有打码后的密钥。
 */
class ConfiguredProviderSettingsControllerTest {

    private static final String ENV_KEY = "sk-from-env-controller-123456";

    @TempDir
    Path temp;

    private final DbProviderRegistrySync sync = mock(DbProviderRegistrySync.class);
    private final LlmProviderRegistry registry = mock(LlmProviderRegistry.class);
    private final ExternalLlmClient external = mock(ExternalLlmClient.class);
    private final ProviderModelDiscovery discovery = mock(ProviderModelDiscovery.class);
    private JdbcTemplate jdbc;
    private ConfiguredProviderService configured;
    private ConfiguredProviderSettingsController controller;

    @BeforeEach
    void setUp() {
        jdbc = SettingsTestSupport.globalDb(temp);
        Map<String, LlmProvidersProperties.ProviderConfig> templates = new LinkedHashMap<>();
        templates.put("huoshenai", new LlmProvidersProperties.ProviderConfig(ENV_KEY, "https://huoshenai.net/v1",
                "gpt-6.2-sol", List.of("gpt-6.2-sol", "gpt-6.1-sol")));
        configured = new ConfiguredProviderService(new LlmProvidersProperties(templates), new SettingsRepository(jdbc),
                SettingsTestSupport.encryption(), new ObjectMapper());
        controller = new ConfiguredProviderSettingsController(configured, sync, registry, external, discovery);
        when(sync.sync()).thenReturn(new DbProviderRegistrySync.SyncResult(List.of()));
    }

    @Test
    void listMasksTheKeyAndReportsWhetherTheProviderIsRegistered() throws Exception {
        when(registry.findProviderByName("huoshenai")).thenReturn(java.util.Optional.empty());

        var response = controller.list();

        assertThat(response).hasSize(1);
        var view = response.getFirst();
        assertThat(view.name()).isEqualTo("huoshenai");
        assertThat(view.displayName()).isEqualTo("HuoshenAI 中转站");
        assertThat(view.apiKeyMasked()).isEqualTo("••••3456");
        assertThat(view.keyFromConfig()).isTrue();
        assertThat(view.active()).isFalse();
        assertThat(new ObjectMapper().writeValueAsString(response)).doesNotContain(ENV_KEY);

        when(registry.findProviderByName("huoshenai")).thenReturn(java.util.Optional.of(mock(com.aicodeassistant.llm.LlmProvider.class)));
        assertThat(controller.list().getFirst().active()).isTrue();
    }

    @Test
    void presetsWithoutAKeyAreNotListedUnlessTheyWereEditedOnThePage() {
        Map<String, LlmProvidersProperties.ProviderConfig> templates = new LinkedHashMap<>();
        templates.put("huoshenai", new LlmProvidersProperties.ProviderConfig(ENV_KEY, "https://huoshenai.net/v1",
                "gpt-6.2-sol", List.of("gpt-6.2-sol")));
        templates.put("openai", new LlmProvidersProperties.ProviderConfig("", "https://api.openai.com/v1",
                "gpt-6-astra", List.of("gpt-6-astra")));
        configured = new ConfiguredProviderService(new LlmProvidersProperties(templates), new SettingsRepository(jdbc),
                SettingsTestSupport.encryption(), new ObjectMapper());
        controller = new ConfiguredProviderSettingsController(configured, sync, registry, external, discovery);

        // 设置页只列用户实际在用的：预置但没配密钥的不出现
        assertThat(controller.list()).extracting(view -> view.name()).containsExactly("huoshenai");

        // 在页面上改过的例外，否则用户找不到自己刚改的那一条
        controller.save("openai", new ConfiguredProviderInput(null, null, List.of("gpt-6-astra", "gpt-6-astra-mini"), null, null));
        assertThat(controller.list()).extracting(view -> view.name()).containsExactly("huoshenai", "openai");
    }

    @Test
    void savingResyncsTheRuntimeRegistryAndReturnsTheUpdatedProvider() {
        when(sync.sync()).thenReturn(new DbProviderRegistrySync.SyncResult(List.of()));

        var response = controller.save("huoshenai",
                new ConfiguredProviderInput(null, null, List.of("gpt-6.2-sol", "gpt-6.1-sol", "gpt-6-sol"), "gpt-6-sol", null));

        verify(sync, times(1)).sync();
        assertThat(response.provider().models()).containsExactly("gpt-6.2-sol", "gpt-6.1-sol", "gpt-6-sol");
        assertThat(response.provider().defaultModel()).isEqualTo("gpt-6-sol");
        assertThat(response.provider().overridden()).isTrue();
        assertThat(response.provider().keyFromConfig()).isTrue();
    }

    @Test
    void aRejectedSaveDoesNotResync() {
        assertThatThrownBy(() -> controller.save("nope", new ConfiguredProviderInput(null, null, null, null, null)))
                .isInstanceOf(RequestValidationException.class).extracting("code").isEqualTo("PROVIDER_NOT_FOUND");
        assertThatThrownBy(() -> controller.save("huoshenai", new ConfiguredProviderInput(null, null, List.of(), null, null)))
                .isInstanceOf(RequestValidationException.class);
        verify(sync, never()).sync();
    }

    @Test
    void resetReturnsToTheConfigFileAndResyncs() {
        controller.save("huoshenai", new ConfiguredProviderInput(null, null, List.of("gpt-6.2-sol"), null, null));
        when(sync.sync()).thenReturn(new DbProviderRegistrySync.SyncResult(List.of()));

        assertThat(controller.reset("huoshenai").getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        assertThat(configured.effective("huoshenai").orElseThrow().overridden()).isFalse();

        // 没改过的没有可恢复的
        assertCode(() -> controller.reset("huoshenai"), "PROVIDER_NOT_FOUND");
    }

    @Test
    void connectivityTestUsesTheEffectiveKeyAndReportsFailuresAsAResult() {
        when(external.probe(any())).thenReturn(30L);
        var ok = controller.test("huoshenai", null);
        assertThat(ok.ok()).isTrue();
        assertThat(ok.model()).isEqualTo("gpt-6.2-sol");
        assertThat(ok.latencyMs()).isEqualTo(30L);
        var captor = org.mockito.ArgumentCaptor.forClass(ExternalLlmClient.Endpoint.class);
        verify(external).probe(captor.capture());
        assertThat(captor.getValue().apiKey()).isEqualTo(ENV_KEY);
        assertThat(captor.getValue().baseUrl()).isEqualTo("https://huoshenai.net/v1");

        when(external.probe(any())).thenThrow(new com.aicodeassistant.llm.LlmApiException("优化模型返回 HTTP 401", false, 401));
        var failed = controller.test("huoshenai", new LlmProviderSettingsController.TestRequest("gpt-6.1-sol"));
        assertThat(failed.ok()).isFalse();
        assertThat(failed.error()).contains("401");

        assertCode(() -> controller.test("huoshenai", new LlmProviderSettingsController.TestRequest("glm-5.4")), "INVALID_PROVIDER");
        assertCode(() -> controller.test("nope", null), "PROVIDER_NOT_FOUND");
    }

    @Test
    void discoverUsesTheEffectiveConnectionAndSavesNothing() {
        when(discovery.listModels(anyString(), anyString())).thenReturn(List.of("gpt-6.2-sol", "gpt-6.1-sol"));

        var response = controller.discover(new ConfiguredProviderSettingsController.DiscoverRequest("huoshenai"));

        assertThat(response.models()).containsExactly("gpt-6.2-sol", "gpt-6.1-sol");
        verify(discovery).listModels("https://huoshenai.net/v1", ENV_KEY);
        verify(sync, never()).sync();
        assertCode(() -> controller.discover(new ConfiguredProviderSettingsController.DiscoverRequest("nope")), "PROVIDER_NOT_FOUND");
    }

    private static void assertCode(org.assertj.core.api.ThrowableAssert.ThrowingCallable call, String code) {
        assertThatThrownBy(call).isInstanceOf(RequestValidationException.class).extracting("code").isEqualTo(code);
    }
}
