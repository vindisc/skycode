package com.aicodeassistant.settings;

import com.aicodeassistant.exception.RequestValidationException;
import com.aicodeassistant.llm.ApiKeyRotationManager;
import com.aicodeassistant.llm.LlmProvidersProperties;
import com.aicodeassistant.settings.ConfiguredProviderService.ConfiguredProviderInput;
import com.aicodeassistant.settings.ConfiguredProviderService.ConfiguredProviderView;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;

import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static com.aicodeassistant.settings.SettingsTestSupport.encryption;
import static com.aicodeassistant.settings.SettingsTestSupport.globalDb;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 配置文件里定义的服务商 + 设置页里的覆盖：页面只存用户改过的部分，其余沿用配置。
 */
class ConfiguredProviderServiceTest {

    private static final String ENV_KEY = "sk-from-env-1234567890";
    private static final String PAGE_KEY = "sk-typed-on-page-1234567890";

    @TempDir
    Path temp;

    private JdbcTemplate jdbc;
    private Map<String, LlmProvidersProperties.ProviderConfig> templates;
    private ConfiguredProviderService service;

    @BeforeEach
    void setUp() {
        jdbc = globalDb(temp);
        templates = new LinkedHashMap<>();
        templates.put("huoshenai", new LlmProvidersProperties.ProviderConfig(ENV_KEY, "https://huoshenai.net/v1",
                "gpt-6.2-sol", List.of("gpt-6.2-sol", "gpt-6.1-sol")));
        templates.put("zhipu", new LlmProvidersProperties.ProviderConfig("", "https://open.bigmodel.cn/api/paas/v4",
                "glm-5.3", List.of("glm-5.3")));
        templates.put("deepseek", new LlmProvidersProperties.ProviderConfig("sk-ds", "https://api.deepseek.com/v1",
                "deepseek-flash", List.of("deepseek-flash")));
        service = newService();
    }

    @Test
    void withoutAnOverrideTheConfiguredValuesApply() {
        var huoshen = service.effective("huoshenai").orElseThrow();

        assertThat(huoshen.usable()).isTrue();
        assertThat(huoshen.apiKey()).isEqualTo(ENV_KEY);
        assertThat(huoshen.keyFromConfig()).isTrue();
        assertThat(huoshen.overridden()).isFalse();
        assertThat(huoshen.models()).containsExactly("gpt-6.2-sol", "gpt-6.1-sol");
        assertThat(huoshen.displayName()).isEqualTo("HuoshenAI 中转站");
        assertThat(huoshen.keySelectionStrategy()).isEqualTo(ApiKeyRotationManager.KeySelectionStrategy.ROUND_ROBIN);

        // 配置里没配密钥的：不算可用
        assertThat(service.effective("zhipu").orElseThrow().usable()).isFalse();
        assertThat(service.effective("no-such-provider")).isEmpty();
        assertThat(service.names()).containsExactly("huoshenai", "zhipu", "deepseek");
    }

    @Test
    void aTypedKeyIsStoredEncryptedAndViewsOnlyShowItMasked() {
        service.save("zhipu", new ConfiguredProviderInput(PAGE_KEY, null, List.of("glm-5.3", "glm-5.4"), null, null));

        String stored = jdbc.queryForObject(
                "SELECT value FROM settings WHERE category = 'configured_provider_override' AND key = 'zhipu'", String.class);
        assertThat(stored).doesNotContain(PAGE_KEY).contains("ENC:");

        var effective = newService().effective("zhipu").orElseThrow();
        assertThat(effective.usable()).isTrue();
        assertThat(effective.apiKey()).isEqualTo(PAGE_KEY);
        assertThat(effective.keyFromConfig()).isFalse();
        assertThat(effective.overridden()).isTrue();
        // 清单里没填默认模型：取第一个
        assertThat(effective.defaultModel()).isEqualTo("glm-5.3");

        ConfiguredProviderView view = service.views(name -> false).get(1);
        assertThat(view.name()).isEqualTo("zhipu");
        assertThat(view.apiKeyMasked()).isEqualTo("••••7890");
        assertThat(view.hasApiKey()).isTrue();
        assertThat(view.keyFromConfig()).isFalse();
        assertThat(view.overridden()).isTrue();
        assertThat(view.active()).isFalse();
    }

    @Test
    void aBlankKeyKeepsWhicheverKeyWasAlreadyInEffect() {
        // 只改模型清单：密钥继续用配置文件里的那把
        service.save("huoshenai", new ConfiguredProviderInput("  ", null, List.of("gpt-6.2-sol"), null, null));
        var effective = service.effective("huoshenai").orElseThrow();
        assertThat(effective.apiKey()).isEqualTo(ENV_KEY);
        assertThat(effective.keyFromConfig()).isTrue();
        assertThat(effective.models()).containsExactly("gpt-6.2-sol");

        // 配置文件里后来换了密钥，照样生效（页面上没存这把密钥）
        templates.put("huoshenai", new LlmProvidersProperties.ProviderConfig("sk-rotated-in-env",
                "https://huoshenai.net/v1", "gpt-6.2-sol", List.of("gpt-6.2-sol")));
        assertThat(service.effective("huoshenai").orElseThrow().apiKey()).isEqualTo("sk-rotated-in-env");

        // 在页面上填过密钥之后，再留空保存：沿用页面上那把
        service.save("huoshenai", new ConfiguredProviderInput(PAGE_KEY, null, List.of("gpt-6.2-sol"), null, null));
        service.save("huoshenai", new ConfiguredProviderInput(null, null, List.of("gpt-6.2-sol", "gpt-6.1-sol"), "gpt-6.1-sol", null));
        var typed = service.effective("huoshenai").orElseThrow();
        assertThat(typed.apiKey()).isEqualTo(PAGE_KEY);
        assertThat(typed.keyFromConfig()).isFalse();
        assertThat(typed.defaultModel()).isEqualTo("gpt-6.1-sol");
    }

    @Test
    void aNullModelListAndANullEnabledMeanKeepAndOnlyToggleWhatIsGiven() {
        service.save("huoshenai", new ConfiguredProviderInput(null, null, null, null, false));

        var disabled = service.effective("huoshenai").orElseThrow();
        assertThat(disabled.enabled()).isFalse();
        assertThat(disabled.usable()).isFalse();
        assertThat(disabled.models()).containsExactly("gpt-6.2-sol", "gpt-6.1-sol");
    }

    @Test
    void resetReturnsToTheConfiguredValues() {
        service.save("zhipu", new ConfiguredProviderInput(PAGE_KEY, null, List.of("glm-5.4"), null, null));
        assertThat(service.reset("zhipu")).isTrue();

        assertThat(service.effective("zhipu").orElseThrow().usable()).isFalse();
        assertThat(service.reset("zhipu")).isFalse();
        assertThat(jdbc.queryForObject(
                "SELECT COUNT(*) FROM settings WHERE category = 'configured_provider_override'", Integer.class)).isZero();
    }

    @Test
    void onlyDeepSeekAllowsEditingTheBaseUrl() {
        assertThat(ConfiguredProviderService.baseUrlEditable("deepseek")).isTrue();
        assertThat(ConfiguredProviderService.baseUrlEditable("huoshenai")).isFalse();

        service.save("deepseek", new ConfiguredProviderInput(null, "https://relay.example/v1/", null, null, null));
        assertThat(service.effective("deepseek").orElseThrow().baseUrl()).isEqualTo("https://relay.example/v1");

        // 其余服务商的地址是写死的：传了也不改
        service.save("huoshenai", new ConfiguredProviderInput(null, "https://evil.example/v1", null, null, null));
        assertThat(service.effective("huoshenai").orElseThrow().baseUrl()).isEqualTo("https://huoshenai.net/v1");
        assertThat(service.views(name -> true).stream().filter(v -> v.name().equals("huoshenai")).findFirst().orElseThrow()
                .baseUrlEditable()).isFalse();

        assertCode(() -> service.save("deepseek", new ConfiguredProviderInput(null, "https://", null, null, null)),
                "INVALID_PROVIDER");
        assertCode(() -> service.save("deepseek", new ConfiguredProviderInput(null, "relay.example/v1", null, null, null)),
                "INVALID_PROVIDER");
    }

    @Test
    void rejectsUnknownProvidersBadInputAndModelsOwnedByAnotherProvider() {
        assertCode(() -> service.save("nope", new ConfiguredProviderInput(null, null, null, null, null)), "PROVIDER_NOT_FOUND");
        assertCode(() -> service.save("zhipu", null), "INVALID_PROVIDER");
        assertCode(() -> service.save("zhipu", new ConfiguredProviderInput(null, null, List.of(" , "), null, null)),
                "INVALID_PROVIDER");
        // gpt-6.2-sol 已经由 huoshenai 提供：同一个模型不能放在两个服务商下，否则运行时按模型找服务商会报歧义
        assertCode(() -> service.save("zhipu", new ConfiguredProviderInput(PAGE_KEY, null, List.of("glm-5.3", "gpt-6.2-sol"), null, null)),
                "INVALID_PROVIDER");
        // 已下架的模型不收
        service.save("zhipu", new ConfiguredProviderInput(PAGE_KEY, null, List.of("glm-5.3", "qwen3.8-flash"), null, null));
        assertThat(service.effective("zhipu").orElseThrow().models()).containsExactly("glm-5.3");
    }

    @Test
    void savingAKeyRequiresAStableEncryptionKey() {
        var unstable = new ConfiguredProviderService(new LlmProvidersProperties(templates),
                new SettingsRepository(jdbc), new StubEncryptionService(false), new com.fasterxml.jackson.databind.ObjectMapper());

        assertThatThrownBy(() -> unstable.save("zhipu", new ConfiguredProviderInput(PAGE_KEY, null, null, null, null)))
                .isInstanceOf(RequestValidationException.class).extracting("code").isEqualTo("ENCRYPTION_KEY_REQUIRED");
    }

    @Test
    void unreadableRowsAreSkippedAndReloadPicksUpOutsideEdits() {
        jdbc.update("""
                INSERT INTO settings(category, key, value, metadata, updated_at)
                VALUES ('configured_provider_override', 'zhipu', 'not json', NULL, '2026-11-25T00:00:00Z')
                """);
        assertThat(service.effective("zhipu").orElseThrow().overridden()).isFalse();

        jdbc.update("""
                UPDATE settings SET value = ?
                WHERE category = 'configured_provider_override' AND key = 'zhipu'
                """, "{\"apiKey\":null,\"baseUrl\":null,\"models\":[\"glm-5.4\"],\"defaultModel\":\"glm-5.4\",\"enabled\":true}");
        service.reload();
        assertThat(service.effective("zhipu").orElseThrow().models()).containsExactly("glm-5.4");
    }

    // ───── 辅助 ─────

    private ConfiguredProviderService newService() {
        return new ConfiguredProviderService(new LlmProvidersProperties(templates), new SettingsRepository(jdbc),
                encryption(), new com.fasterxml.jackson.databind.ObjectMapper());
    }

    private static void assertCode(org.assertj.core.api.ThrowableAssert.ThrowingCallable call, String code) {
        assertThatThrownBy(call).isInstanceOf(RequestValidationException.class).extracting("code").isEqualTo(code);
    }

    /** 加解密照常用固定密钥，只覆盖"密钥来源是否稳定"这一个开关。 */
    private static final class StubEncryptionService extends com.aicodeassistant.mcp.TokenEncryptionService {
        private final boolean persistent;

        StubEncryptionService(boolean persistent) {
            super(SettingsTestSupport.ENCRYPTION_KEY);
            this.persistent = persistent;
        }

        @Override
        public boolean keyIsPersistent() {
            return persistent;
        }
    }

}
