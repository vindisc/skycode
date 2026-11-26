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
 * 设置页里带注册名的那批服务商：定义存在库里、页面是唯一来源；
 * .env 只在第一次启动时提供一次性导入的初始值。
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
    void firstRunImportsUsableProvidersFromTheEnvOnce() {
        service.seedIfNeeded();

        // 导入的是配了密钥、能用的那几个；没配密钥的不进库
        assertThat(service.effectiveProviders()).extracting(e -> e.name())
                .containsExactly("huoshenai", "deepseek");
        var huoshen = service.effective("huoshenai").orElseThrow();
        assertThat(huoshen.usable()).isTrue();
        assertThat(huoshen.apiKey()).isEqualTo(ENV_KEY);
        assertThat(huoshen.models()).containsExactly("gpt-6.2-sol", "gpt-6.1-sol");
        assertThat(huoshen.displayName()).isEqualTo("HuoshenAI 中转站");
        assertThat(huoshen.keySelectionStrategy()).isEqualTo(ApiKeyRotationManager.KeySelectionStrategy.ROUND_ROBIN);

        // .env 后来怎么改都不再生效：导入是一次性的
        templates.put("moonshot", new LlmProvidersProperties.ProviderConfig("sk-new", "https://api.moonshot.cn/v1",
                "kimi-k3.1", List.of("kimi-k3.1")));
        templates.put("huoshenai", new LlmProvidersProperties.ProviderConfig("sk-rotated-in-env",
                "https://huoshenai.net/v1", "gpt-6.2-sol", List.of("gpt-6.2-sol")));
        var restarted = newService();
        restarted.seedIfNeeded();
        assertThat(restarted.effectiveProviders()).extracting(e -> e.name()).containsExactly("huoshenai", "deepseek");
        assertThat(restarted.effective("huoshenai").orElseThrow().apiKey()).isEqualTo(ENV_KEY);
        assertThat(restarted.effective("moonshot")).isEmpty();

        // 页面上删掉的，重启也不会因为 .env 里还有而回来
        restarted.delete("deepseek");
        newService().seedIfNeeded();
        assertThat(newService().effective("deepseek")).isEmpty();
    }

    @Test
    void seedingWithoutAStableEncryptionKeyImportsTheProviderWithoutItsKey() {
        var unstable = new ConfiguredProviderService(new LlmProvidersProperties(templates),
                new SettingsRepository(jdbc), new StubEncryptionService(false), new com.fasterxml.jackson.databind.ObjectMapper());

        unstable.seedIfNeeded();

        var huoshen = unstable.effective("huoshenai").orElseThrow();
        assertThat(huoshen.apiKey()).isNull();
        assertThat(huoshen.usable()).isFalse();
        assertThat(huoshen.baseUrl()).isEqualTo("https://huoshenai.net/v1");
    }

    @Test
    void aTypedKeyIsStoredEncryptedAndViewsOnlyShowItMasked() {
        service.seedIfNeeded();
        service.save("huoshenai", new ConfiguredProviderInput(PAGE_KEY, null, List.of("gpt-6.2-sol", "gpt-6.1-sol", "gpt-6-sol"), null, null));

        String stored = jdbc.queryForObject(
                "SELECT value FROM settings WHERE category = 'configured_provider' AND key = 'huoshenai'", String.class);
        assertThat(stored).doesNotContain(PAGE_KEY).doesNotContain(ENV_KEY).contains("ENC:");

        var effective = newService().effective("huoshenai").orElseThrow();
        assertThat(effective.usable()).isTrue();
        assertThat(effective.apiKey()).isEqualTo(PAGE_KEY);
        // 清单里没填默认模型：取第一个
        assertThat(effective.defaultModel()).isEqualTo("gpt-6.2-sol");

        ConfiguredProviderView view = service.views(name -> false).get(0);
        assertThat(view.name()).isEqualTo("huoshenai");
        assertThat(view.apiKeyMasked()).isEqualTo("••••7890");
        assertThat(view.hasApiKey()).isTrue();
        assertThat(view.active()).isFalse();
    }

    @Test
    void aBlankKeyKeepsTheStoredKeyAndNullFieldsKeepTheirValues() {
        service.seedIfNeeded();
        // 只改模型清单：密钥继续用导入时那把
        service.save("huoshenai", new ConfiguredProviderInput("  ", null, List.of("gpt-6.2-sol"), null, null));
        var effective = service.effective("huoshenai").orElseThrow();
        assertThat(effective.apiKey()).isEqualTo(ENV_KEY);
        assertThat(effective.models()).containsExactly("gpt-6.2-sol");

        // 在页面上填过密钥之后，再留空保存：沿用页面上那把
        service.save("huoshenai", new ConfiguredProviderInput(PAGE_KEY, null, List.of("gpt-6.2-sol"), null, null));
        service.save("huoshenai", new ConfiguredProviderInput(null, null, List.of("gpt-6.2-sol", "gpt-6.1-sol"), "gpt-6.1-sol", null));
        var typed = service.effective("huoshenai").orElseThrow();
        assertThat(typed.apiKey()).isEqualTo(PAGE_KEY);
        assertThat(typed.defaultModel()).isEqualTo("gpt-6.1-sol");

        // 只停用：其余保持
        service.save("huoshenai", new ConfiguredProviderInput(null, null, null, null, false));
        var disabled = service.effective("huoshenai").orElseThrow();
        assertThat(disabled.enabled()).isFalse();
        assertThat(disabled.usable()).isFalse();
        assertThat(disabled.models()).containsExactly("gpt-6.2-sol", "gpt-6.1-sol");
    }

    @Test
    void deleteRemovesTheProviderForGood() {
        service.seedIfNeeded();
        assertThat(service.delete("deepseek")).isTrue();
        assertThat(service.delete("deepseek")).isFalse();
        assertThat(service.effective("deepseek")).isEmpty();
        assertThat(service.views(ignored -> true)).extracting(ConfiguredProviderView::name).containsExactly("huoshenai");
        // 标记还在：重启不会把删掉的又导回来
        newService().seedIfNeeded();
        assertThat(newService().effective("deepseek")).isEmpty();
    }

    @Test
    void theBaseUrlIsEditableForEveryProvider() {
        service.seedIfNeeded();

        service.save("huoshenai", new ConfiguredProviderInput(null, "https://relay.example/v1/", null, null, null));
        assertThat(service.effective("huoshenai").orElseThrow().baseUrl()).isEqualTo("https://relay.example/v1");

        assertCode(() -> service.save("huoshenai", new ConfiguredProviderInput(null, "https://", null, null, null)),
                "INVALID_PROVIDER");
        assertCode(() -> service.save("huoshenai", new ConfiguredProviderInput(null, "relay.example/v1", null, null, null)),
                "INVALID_PROVIDER");
    }

    @Test
    void rejectsUnknownProvidersBadInputAndModelsOwnedByAnotherProvider() {
        service.seedIfNeeded();
        assertCode(() -> service.save("nope", new ConfiguredProviderInput(null, null, null, null, null)), "PROVIDER_NOT_FOUND");
        assertCode(() -> service.save("huoshenai", null), "INVALID_PROVIDER");
        assertCode(() -> service.save("huoshenai", new ConfiguredProviderInput(null, null, List.of(" , "), null, null)),
                "INVALID_PROVIDER");
        // deepseek-flash 已经由 deepseek 提供：同一个模型不能放在两个服务商下，否则运行时按模型找服务商会报歧义
        assertCode(() -> service.save("huoshenai", new ConfiguredProviderInput(null, null, List.of("gpt-6.2-sol", "deepseek-flash"), null, null)),
                "INVALID_PROVIDER");
        // 已下架的模型不收
        service.save("huoshenai", new ConfiguredProviderInput(null, null, List.of("gpt-6.2-sol", "qwen3.8-flash"), null, null));
        assertThat(service.effective("huoshenai").orElseThrow().models()).containsExactly("gpt-6.2-sol");
    }

    @Test
    void savingAKeyRequiresAStableEncryptionKey() {
        service.seedIfNeeded();
        var unstable = new ConfiguredProviderService(new LlmProvidersProperties(templates),
                new SettingsRepository(jdbc), new StubEncryptionService(false), new com.fasterxml.jackson.databind.ObjectMapper());

        assertThatThrownBy(() -> unstable.save("huoshenai", new ConfiguredProviderInput(PAGE_KEY, null, null, null, null)))
                .isInstanceOf(RequestValidationException.class).extracting("code").isEqualTo("ENCRYPTION_KEY_REQUIRED");
    }

    @Test
    void unreadableRowsAreSkippedAndReloadPicksUpOutsideEdits() {
        service.seedIfNeeded();
        jdbc.update("""
                UPDATE settings SET value = 'not json'
                WHERE category = 'configured_provider' AND key = 'deepseek'
                """);
        service.reload();
        assertThat(service.effective("deepseek")).isEmpty();
        assertThat(service.effective("huoshenai")).isPresent();

        jdbc.update("""
                UPDATE settings SET value = ?
                WHERE category = 'configured_provider' AND key = 'huoshenai'
                """, "{\"apiKey\":null,\"baseUrl\":\"https://huoshenai.net/v1\",\"models\":[\"gpt-6.2-sol\",\"gpt-6.1-sol\"],"
                        + "\"defaultModel\":\"gpt-6.1-sol\",\"enabled\":true,\"keySelectionStrategy\":null}");
        service.reload();
        assertThat(service.effective("huoshenai").orElseThrow().defaultModel()).isEqualTo("gpt-6.1-sol");
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
