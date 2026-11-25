package com.aicodeassistant.settings;

import com.aicodeassistant.exception.RequestValidationException;
import com.aicodeassistant.mcp.TokenEncryptionService;
import com.aicodeassistant.settings.LlmProviderSettingsService.ProviderInput;
import com.aicodeassistant.settings.LlmProviderSettingsService.ProviderView;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;

import java.nio.file.Path;
import java.util.Arrays;
import java.util.List;

import static com.aicodeassistant.settings.SettingsTestSupport.ENCRYPTION_KEY;
import static com.aicodeassistant.settings.SettingsTestSupport.encryption;
import static com.aicodeassistant.settings.SettingsTestSupport.globalDb;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 服务商池：密钥落库必须加密、下发必须打码；其余字段的校验与键的生成规则。
 */
class LlmProviderSettingsServiceTest {

    private static final String RAW_KEY = "sk-test-0123456789abcdef";

    @TempDir
    Path temp;

    private JdbcTemplate jdbc;
    private LlmProviderSettingsService service;

    @BeforeEach
    void setUp() {
        jdbc = globalDb(temp);
        service = newService();
    }

    @Test
    void storesOnlyTheEncryptedKeyAndNeverReturnsItInViews() {
        var created = service.create(zhipu(RAW_KEY, List.of("glm-5.4")));

        // 中文名得到中文键；进程内部拿到的是明文，供注册 Provider 使用
        assertThat(created.key()).isEqualTo("智谱");
        assertThat(created.config().apiKey()).isEqualTo(RAW_KEY);

        String storedValue = jdbc.queryForObject(
                "SELECT value FROM settings WHERE category = 'llm_provider' AND key = ?", String.class,
                created.key());
        assertThat(storedValue).doesNotContain(RAW_KEY).contains("ENC:");
        assertThat(storedValue).contains("\"name\":\"智谱\"").contains("glm-5.4");

        ProviderView view = service.list().getFirst();
        assertThat(view.apiKeyMasked()).isEqualTo("••••cdef");
        assertThat(view.hasApiKey()).isTrue();
        assertThat(view.defaultModel()).isEqualTo("glm-5.4");
        assertThat(view.updatedAt()).isNotBlank();
    }

    @Test
    void blankKeyOnUpdateKeepsTheStoredKeyAndNewInstanceDecryptsIt() {
        String key = service.create(zhipu(RAW_KEY, List.of("glm-5.3", "glm-5.4"))).key();

        // 留空表示不修改
        service.update(key, new ProviderInput("智谱官方", "https://open.bigmodel.cn/api/paas/v4",
                "   ", List.of("glm-5.4"), null, true));

        // 新实例 = 模拟进程重启后从库重新加载
        var reloaded = newService().getAllProviderEntries().getFirst();
        assertThat(reloaded.key()).isEqualTo(key);
        assertThat(reloaded.config().name()).isEqualTo("智谱官方");
        assertThat(reloaded.config().apiKey()).isEqualTo(RAW_KEY);
        assertThat(reloaded.config().models()).containsExactly("glm-5.4");
    }

    @Test
    void creatingWithoutAKeySavesAKeylessProvider() {
        var created = service.create(zhipu("", List.of("ollama/llama3")));

        assertThat(created.config().apiKey()).isEmpty();
        assertThat(service.list().getFirst().hasApiKey()).isFalse();
        assertThat(service.list().getFirst().apiKeyMasked()).isEmpty();
    }

    @Test
    void encryptionKeyMustBeStableBeforeAKeyCanBeSaved() {
        var unstable = new LlmProviderSettingsService(new SettingsRepository(jdbc),
                new StubEncryptionService(false), new ObjectMapper());

        assertThat(unstable.encryptionKeyIsStable()).isFalse();
        assertCode(() -> unstable.create(zhipu(RAW_KEY, List.of("glm-5.4"))), "ENCRYPTION_KEY_REQUIRED");
        // 拒绝之后库里不能留下半条记录
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM settings", Integer.class)).isZero();

        assertThat(service.encryptionKeyIsStable()).isTrue();
    }

    @Test
    void keysAreUniqueAndDoNotChangeWhenTheDisplayNameChanges() {
        String first = service.create(zhipu("sk-first-key-1111111", List.of("glm-5.4"))).key();
        String second = service.create(zhipu("sk-second-key-2222222", List.of("glm-5.3"))).key();
        String third = service.create(zhipu("sk-third-key-33333333", List.of("glm-5.3"))).key();

        assertThat(List.of(first, second, third)).containsExactly("智谱", "智谱-2", "智谱-3");

        // 改显示名不改键；场景绑定引用的就是这个键
        service.update(first, new ProviderInput("GLM 官方", "https://open.bigmodel.cn/api/paas/v4",
                null, List.of("glm-5.4"), null, null));
        assertThat(service.list()).extracting(ProviderView::key).containsExactly(first, second, third);
        assertThat(service.list().getFirst().name()).isEqualTo("GLM 官方");
    }

    @Test
    void rejectsInvalidInput() {
        assertCode(() -> service.create(zhipu(RAW_KEY, List.of())), "INVALID_PROVIDER");
        assertCode(() -> service.create(zhipu(RAW_KEY, List.of("  , \n"))), "INVALID_PROVIDER");
        assertCode(() -> service.create(input("", "https://x.example/v1", List.of("glm-5.4"), null)),
                "INVALID_PROVIDER");
        assertCode(() -> service.create(input("x", "x.example/v1", List.of("glm-5.4"), null)),
                "INVALID_PROVIDER");
        assertCode(() -> service.create(input("x", "https://x.example/v1", List.of("glm-5.4"), "gpt-6.2-sol")),
                "INVALID_PROVIDER");
        // 模型 ID 大小写敏感：不做归一
        assertCode(() -> service.create(input("x", "https://x.example/v1", List.of("glm-5.4"), "GLM-5.4")),
                "INVALID_PROVIDER");
        // 只有协议头、没有主机名的地址现在就会被拦下，而不是等到发请求才报错
        assertCode(() -> service.create(input("x", "https://", List.of("glm-5.4"), null)), "INVALID_PROVIDER");
        assertCode(() -> service.update("nope", zhipu(RAW_KEY, List.of("glm-5.4"))), "PROVIDER_NOT_FOUND");
        assertCode(() -> service.delete("nope"), "PROVIDER_NOT_FOUND");
    }

    @Test
    void baseUrlTrailingSlashesAreStrippedAndDefaultModelFallsBackToTheFirst() {
        var created = service.create(input("Relay", "https://relay.example/v1/",
                List.of("gpt-6.2-sol", "gpt-6.1-sol"), "  "));

        assertThat(created.config().baseUrl()).isEqualTo("https://relay.example/v1");
        assertThat(created.config().defaultModel()).isEqualTo("gpt-6.2-sol");
        assertThat(created.config().enabled()).isTrue();
    }

    @Test
    void deleteRemovesTheEntryAndReloadPicksUpExternalEdits() {
        String key = service.create(zhipu(RAW_KEY, List.of("glm-5.4"))).key();
        service.delete(key);
        assertThat(service.list()).isEmpty();
        assertThatThrownBy(() -> service.delete(key))
                .isInstanceOf(RequestValidationException.class);

        jdbc.update("""
                INSERT INTO settings(category, key, value, metadata, updated_at)
                VALUES ('llm_provider', 'manual', ?, NULL, '2026-11-25T00:00:00Z')
                """, "{\"name\":\"手写\",\"baseUrl\":\"https://manual.example/v1\",\"apiKey\":\"\","
                        + "\"models\":[\"glm-5.4\"],\"defaultModel\":\"glm-5.4\",\"enabled\":true}");
        // 缓存里还没有这条
        assertThat(service.list()).isEmpty();
        service.reload();
        assertThat(service.list()).extracting(ProviderView::key).containsExactly("manual");
    }

    @Test
    void unreadableRowsAreSkippedInsteadOfBreakingTheWholePool() {
        String key = service.create(zhipu(RAW_KEY, List.of("glm-5.4"))).key();
        jdbc.update("""
                INSERT INTO settings(category, key, value, metadata, updated_at)
                VALUES ('llm_provider', 'broken', 'not json', NULL, '2026-11-25T00:00:00Z')
                """);
        service.reload();

        assertThat(service.list()).extracting(ProviderView::key).containsExactly(key);
    }

    @Test
    void normalizeModelsSplitsTrimsDeduplicatesAndKeepsCase() {
        assertThat(LlmProviderSettingsService.normalizeModels(null)).isEmpty();
        assertThat(LlmProviderSettingsService.normalizeModels(
                Arrays.asList(" glm-5.4, gpt-6.2-sol\n\nGLM-5.4", "gpt-6.2-sol", null, " , ")))
                .containsExactly("glm-5.4", "gpt-6.2-sol", "GLM-5.4");
    }

    @Test
    void keysKeepLettersAndDigitsOfAnyScriptAndFoldEverythingElse() {
        assertThat(LlmProviderSettingsService.normalizeKey("智谱")).isEqualTo("智谱");
        assertThat(LlmProviderSettingsService.normalizeKey("  Fire -- AI!! ")).isEqualTo("fire-ai");
        assertThat(LlmProviderSettingsService.normalizeKey("DeepSeek 官方")).isEqualTo("deepseek-官方");
        assertThat(LlmProviderSettingsService.normalizeKey("!!!")).isEqualTo("provider");
        assertThat(LlmProviderSettingsService.normalizeKey(null)).isEqualTo("provider");
    }

    @Test
    void maskKeepsOnlyTheLastFourCharacters() {
        assertThat(LlmProviderSettingsService.mask(null)).isEmpty();
        assertThat(LlmProviderSettingsService.mask("short")).isEqualTo("••••");
        assertThat(LlmProviderSettingsService.mask("sk-1234567890")).isEqualTo("••••7890");
    }

    // ───── 辅助 ─────

    private LlmProviderSettingsService newService() {
        return new LlmProviderSettingsService(new SettingsRepository(jdbc), encryption(), new ObjectMapper());
    }

    private static ProviderInput zhipu(String apiKey, List<String> models) {
        return new ProviderInput("智谱", "https://open.bigmodel.cn/api/paas/v4", apiKey, models, null, null);
    }

    private static ProviderInput input(String name, String baseUrl, List<String> models, String defaultModel) {
        return new ProviderInput(name, baseUrl, RAW_KEY, models, defaultModel, null);
    }

    private static void assertCode(org.assertj.core.api.ThrowableAssert.ThrowingCallable call, String code) {
        assertThatThrownBy(call).isInstanceOf(RequestValidationException.class).extracting("code").isEqualTo(code);
    }

    /** 加解密照常用固定密钥，只覆盖"密钥来源是否稳定"这一个开关，避免真的去生成密钥文件。 */
    private static final class StubEncryptionService extends TokenEncryptionService {
        private final boolean persistent;

        StubEncryptionService(boolean persistent) {
            super(ENCRYPTION_KEY);
            this.persistent = persistent;
        }

        @Override
        public boolean keyIsPersistent() {
            return persistent;
        }
    }
}
