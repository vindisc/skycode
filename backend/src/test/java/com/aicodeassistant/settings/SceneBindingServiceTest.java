package com.aicodeassistant.settings;

import com.aicodeassistant.exception.RequestValidationException;
import com.aicodeassistant.llm.LlmProviderRegistry;
import com.aicodeassistant.llm.LlmProvidersProperties;
import com.aicodeassistant.llm.ModelRegistry;
import com.aicodeassistant.llm.ModelScenes;
import com.aicodeassistant.settings.LlmProviderSettingsService.ProviderInput;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.env.MockEnvironment;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;

import static com.aicodeassistant.settings.SettingsTestSupport.encryption;
import static com.aicodeassistant.settings.SettingsTestSupport.globalDb;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 场景分派：绑定只存引用；图片理解兜底必须选一个能力表里收图的模型；
 * 引用的服务商被停用或删除后绑定自动失效，由调用方回落默认配置。
 */
class SceneBindingServiceTest {

    private static final String BASE_URL = "https://open.bigmodel.cn/api/paas/v4";
    private static final String RAW_KEY = "sk-scene-test-key-1234567890";

    @TempDir
    Path temp;

    private JdbcTemplate jdbc;
    private static final String CONFIG_KEY = "sk-config-key-1234567890";

    private LlmProviderSettingsService pool;
    private ConfiguredProviderService configured;
    private LlmProviderRegistry registry;
    private SceneBindingService service;

    @BeforeEach
    void setUp() {
        jdbc = globalDb(temp);
        ObjectMapper mapper = new ObjectMapper();
        pool = new LlmProviderSettingsService(new SettingsRepository(jdbc), encryption(), mapper);
        // 配置文件里定义的服务商：一个有密钥（huoshenai），一个没有（minimax）
        Map<String, LlmProvidersProperties.ProviderConfig> templates = new java.util.LinkedHashMap<>();
        templates.put("huoshenai", new LlmProvidersProperties.ProviderConfig(CONFIG_KEY,
                "https://huoshenai.net/v1", "gpt-6.2-sol", List.of("gpt-6.2-sol", "gpt-6.1-sol")));
        templates.put("minimax", new LlmProvidersProperties.ProviderConfig("", "https://api.minimax.chat/v1",
                "MiniMax-M3", List.of("MiniMax-M3")));
        configured = new ConfiguredProviderService(new LlmProvidersProperties(templates),
                new SettingsRepository(jdbc), SettingsTestSupport.encryption(), mapper);
        configured.seedIfNeeded();
        registry = new LlmProviderRegistry(List.of(), new MockEnvironment());
        ModelRegistry modelRegistry = new ModelRegistry(registry);
        service = new SceneBindingService(new SettingsRepository(jdbc), pool, configured, modelRegistry, registry, mapper);
    }

    @Test
    void onlyListsScenesThatActuallyHaveAConsumer() {
        assertThat(service.scenes()).extracting(SceneBindingService.Scene::key).containsExactly(
                "main_default", "compact_summary", "fast", "sub_agent", "vision_fallback", "prompt_optimize");
        assertThat(service.scenes()).allSatisfy(scene -> {
            assertThat(scene.label()).isNotBlank();
            assertThat(scene.description()).isNotBlank();
        });
    }

    @Test
    void nothingBoundResolvesToEmpty() {
        assertThat(service.find(SceneBindingService.PROMPT_OPTIMIZE)).isEmpty();
        assertThat(service.resolve(SceneBindingService.PROMPT_OPTIMIZE)).isEmpty();
    }

    @Test
    void storesOnlyAReferenceAndResolvesTheConnectionDetailsOnRead() {
        var provider = pool.create(new ProviderInput("智谱", BASE_URL, RAW_KEY,
                List.of("glm-5.4", "gpt-6.2-sol"), null, null));

        service.save(SceneBindingService.PROMPT_OPTIMIZE, SceneBindingService.SOURCE_POOL, provider.key(), "gpt-6.2-sol");

        String stored = jdbc.queryForObject(
                "SELECT value FROM settings WHERE category = 'scene_binding'", String.class);
        assertThat(stored).contains(provider.key()).contains("gpt-6.2-sol").doesNotContain(RAW_KEY);

        var resolved = service.resolve(SceneBindingService.PROMPT_OPTIMIZE).orElseThrow();
        assertThat(resolved.providerKey()).isEqualTo(provider.key());        assertThat(resolved.providerName()).isEqualTo("智谱");
        assertThat(resolved.baseUrl()).isEqualTo(BASE_URL);
        assertThat(resolved.apiKey()).isEqualTo(RAW_KEY);
        assertThat(resolved.modelId()).isEqualTo("gpt-6.2-sol");
    }

    @Test
    void bindingUsesTheStorageKeyNotTheDisplayName() {
        var provider = pool.create(new ProviderInput("智谱", BASE_URL, RAW_KEY, List.of("glm-5.4"), null, null));
        pool.update(provider.key(), new ProviderInput("GLM 官方", BASE_URL, null, List.of("glm-5.4"), null, null));

        // 显示名改了，存储键没变；从显示名反推的键对不上
        assertThat(provider.key()).isEqualTo("智谱");
        assertThat(service.save(SceneBindingService.VISION_FALLBACK, SceneBindingService.SOURCE_POOL, "智谱", "glm-5.4").providerKey())
                .isEqualTo("智谱");
        assertThatThrownBy(() -> service.save(SceneBindingService.VISION_FALLBACK, SceneBindingService.SOURCE_POOL, "glm-official", "glm-5.4"))
                .isInstanceOf(RequestValidationException.class)
                .extracting("code").isEqualTo("PROVIDER_NOT_FOUND");
    }

    @Test
    void visionFallbackMustBeAnImageCapableModel() {
        var provider = pool.create(new ProviderInput("智谱", BASE_URL, RAW_KEY,
                List.of("glm-5.3", "glm-5.4"), null, null));

        // glm-5.3 在能力表里登记为不收图
        assertCode(() -> service.save(SceneBindingService.VISION_FALLBACK, SceneBindingService.SOURCE_POOL, provider.key(), "glm-5.3"),
                "INVALID_SCENE_BINDING");
        // 提示词优化没有这个限制
        assertThat(service.save(SceneBindingService.PROMPT_OPTIMIZE, SceneBindingService.SOURCE_POOL, provider.key(), "glm-5.3").modelId())
                .isEqualTo("glm-5.3");
        assertThat(service.save(SceneBindingService.VISION_FALLBACK, SceneBindingService.SOURCE_POOL, provider.key(), "glm-5.4").modelId())
                .isEqualTo("glm-5.4");
    }

    @Test
    void anUnregisteredPoolModelIsJudgedByTheCapabilitiesItWillGet() {
        // 两个都不在内置能力表里：glm-9-vision 会沿用 glm-5.4 的参数（收图），codex-auto-review 只有通用参数（不收图）
        var provider = pool.create(new ProviderInput("中转站", "https://relay.example/v1", RAW_KEY,
                List.of("glm-9-vision", "codex-auto-review"), null, null));

        assertThat(service.save(SceneBindingService.VISION_FALLBACK, SceneBindingService.SOURCE_POOL, provider.key(), "glm-9-vision").modelId())
                .isEqualTo("glm-9-vision");
        assertCode(() -> service.save(SceneBindingService.VISION_FALLBACK, SceneBindingService.SOURCE_POOL, provider.key(), "codex-auto-review"),
                "INVALID_SCENE_BINDING");
    }

    @Test
    void rejectsUnknownScenesProvidersAndUnlistedModels() {
        var provider = pool.create(new ProviderInput("智谱", BASE_URL, RAW_KEY, List.of("glm-5.4"), null, null));

        assertCode(() -> service.save("main_conversation", SceneBindingService.SOURCE_POOL, provider.key(), "glm-5.4"), "UNKNOWN_SCENE");
        assertCode(() -> service.save(SceneBindingService.PROMPT_OPTIMIZE, SceneBindingService.SOURCE_POOL, "nope", "glm-5.4"), "PROVIDER_NOT_FOUND");
        assertCode(() -> service.save(SceneBindingService.PROMPT_OPTIMIZE, SceneBindingService.SOURCE_POOL, provider.key(), "gpt-6.2-sol"),
                "INVALID_SCENE_BINDING");
        assertCode(() -> service.save(SceneBindingService.PROMPT_OPTIMIZE, SceneBindingService.SOURCE_POOL, provider.key(), " "), "INVALID_SCENE_BINDING");
        assertCode(() -> service.save(SceneBindingService.PROMPT_OPTIMIZE, SceneBindingService.SOURCE_POOL, " ", "glm-5.4"), "INVALID_SCENE_BINDING");
    }

    @Test
    void disabledOrDeletedProviderMakesTheBindingInactive() {
        var provider = pool.create(new ProviderInput("智谱", BASE_URL, RAW_KEY, List.of("glm-5.4"), null, null));
        service.save(SceneBindingService.PROMPT_OPTIMIZE, SceneBindingService.SOURCE_POOL, provider.key(), "glm-5.4");

        pool.update(provider.key(), new ProviderInput("智谱", BASE_URL, null, List.of("glm-5.4"), null, false));
        assertThat(service.find(SceneBindingService.PROMPT_OPTIMIZE)).isPresent();
        assertThat(service.resolve(SceneBindingService.PROMPT_OPTIMIZE)).isEmpty();

        pool.update(provider.key(), new ProviderInput("智谱", BASE_URL, null, List.of("glm-5.4"), null, true));
        assertThat(service.resolve(SceneBindingService.PROMPT_OPTIMIZE)).isPresent();

        pool.delete(provider.key());
        assertThat(service.resolve(SceneBindingService.PROMPT_OPTIMIZE)).isEmpty();
    }

    @Test
    void bindingGoesStaleWhenTheProviderDropsTheBoundModel() {
        var provider = pool.create(new ProviderInput("智谱", BASE_URL, RAW_KEY,
                List.of("glm-5.4", "glm-5.3"), null, null));
        service.save(SceneBindingService.PROMPT_OPTIMIZE, SceneBindingService.SOURCE_POOL, provider.key(), "glm-5.3");
        assertThat(service.resolve(SceneBindingService.PROMPT_OPTIMIZE)).isPresent();

        pool.update(provider.key(), new ProviderInput("智谱", BASE_URL, null, List.of("glm-5.4"), null, null));

        // 绑定还在，但指向的模型已经不在清单里：不能拿着它去调用
        assertThat(service.find(SceneBindingService.PROMPT_OPTIMIZE)).isPresent();
        assertThat(service.resolve(SceneBindingService.PROMPT_OPTIMIZE)).isEmpty();
    }

    @Test
    void clearRemovesTheBinding() {
        var provider = pool.create(new ProviderInput("智谱", BASE_URL, RAW_KEY, List.of("glm-5.4"), null, null));
        service.save(SceneBindingService.PROMPT_OPTIMIZE, SceneBindingService.SOURCE_POOL, provider.key(), "glm-5.4");

        service.clear(SceneBindingService.PROMPT_OPTIMIZE);
        service.clear(SceneBindingService.PROMPT_OPTIMIZE);

        assertThat(service.find(SceneBindingService.PROMPT_OPTIMIZE)).isEmpty();
    }

    @Test
    void aBindingCanPointAtAProviderDefinedInTheConfigFile() {
        Setting.SceneBinding saved = service.save(ModelScenes.MAIN_DEFAULT,
                SceneBindingService.SOURCE_CONFIGURED, "huoshenai", "gpt-6.1-sol");

        assertThat(saved.isConfigured()).isTrue();
        var resolved = service.resolve(ModelScenes.MAIN_DEFAULT).orElseThrow();
        assertThat(resolved.source()).isEqualTo(SceneBindingService.SOURCE_CONFIGURED);
        // 配置里的服务商按原名注册，没有 db: 前缀
        assertThat(resolved.registryName()).isEqualTo("huoshenai");
        assertThat(resolved.providerName()).isEqualTo("HuoshenAI 中转站");
        assertThat(resolved.apiKey()).isEqualTo(CONFIG_KEY);
        assertThat(resolved.modelId()).isEqualTo("gpt-6.1-sol");
    }

    @Test
    void aProviderThatIsNotInTheSettingsStoreIsRejected() {
        // minimax 在 .env 里没配密钥：一次性导入不进库，设置页里没有它，绑定直接被拒
        assertCode(() -> service.save(ModelScenes.MAIN_DEFAULT, SceneBindingService.SOURCE_CONFIGURED, "minimax", "MiniMax-M3"),
                "PROVIDER_NOT_FOUND");
        assertCode(() -> service.save(ModelScenes.MAIN_DEFAULT, SceneBindingService.SOURCE_CONFIGURED,
                "no-such-provider", "x"), "PROVIDER_NOT_FOUND");
        assertCode(() -> service.save(ModelScenes.MAIN_DEFAULT, "elsewhere", "huoshenai", "gpt-6.2-sol"),
                "INVALID_SCENE_BINDING");
        assertCode(() -> service.save(ModelScenes.FAST, SceneBindingService.SOURCE_CONFIGURED, "huoshenai", "glm-5.4"),
                "INVALID_SCENE_BINDING");
    }

    @Test
    void aConfiguredProviderDisabledOnTheSettingsPageDeactivatesItsBindings() {
        configured.save("huoshenai", new ConfiguredProviderService.ConfiguredProviderInput(
                null, null, List.of("gpt-6.2-sol", "gpt-6.1-sol"), null, false));
        service.save(ModelScenes.MAIN_DEFAULT, SceneBindingService.SOURCE_CONFIGURED, "huoshenai", "gpt-6.2-sol");

        assertThat(service.resolve(ModelScenes.MAIN_DEFAULT)).isEmpty();

        configured.save("huoshenai", new ConfiguredProviderService.ConfiguredProviderInput(
                null, null, List.of("gpt-6.2-sol", "gpt-6.1-sol"), null, true));
        assertThat(service.resolve(ModelScenes.MAIN_DEFAULT)).isPresent();
    }

    @Test
    void bindingsStoredBeforeSourcesExistedStillPointAtThePool() throws Exception {
        // 早期的绑定记录没有 source 字段
        jdbc.update("""
                INSERT INTO settings(category, key, value, metadata, updated_at)
                VALUES ('scene_binding', 'prompt_optimize', '{"providerKey":"old","modelId":"glm-5.4"}', NULL, '2026-11-25T00:00:00Z')
                """);
        service.reload();

        assertThat(service.find(SceneBindingService.PROMPT_OPTIMIZE).orElseThrow().isConfigured()).isFalse();
    }

    @Test
    void supportedBoundModelOnlyReturnsAModelThatARegisteredProviderActuallyServes() {
        service.save(ModelScenes.MAIN_DEFAULT, SceneBindingService.SOURCE_POOL, addPoolProvider(), "glm-5.4");
        // 绑定本身可用，但运行时还没有任何 Provider 提供这个模型
        assertThat(service.resolve(ModelScenes.MAIN_DEFAULT)).isPresent();
        assertThat(service.supportedBoundModel(ModelScenes.MAIN_DEFAULT)).isEmpty();

        registry.register(new com.aicodeassistant.llm.impl.OpenAiCompatibleProvider("db:zhipu", new ObjectMapper(),
                new com.aicodeassistant.llm.LlmHttpProperties(new com.aicodeassistant.llm.LlmHttpProperties.PoolProperties(1, 5), 5, 5, false),
                new com.aicodeassistant.llm.ApiKeyRotationManager("k"), "k", "https://open.bigmodel.cn/api/paas/v4",
                "glm-5.4", List.of("glm-5.4")));

        assertThat(service.supportedBoundModel(ModelScenes.MAIN_DEFAULT)).contains("glm-5.4");
        assertThat(service.supportedBoundModel(ModelScenes.FAST)).isEmpty();
    }

    private String addPoolProvider() {
        return pool.create(new ProviderInput("智谱", "https://open.bigmodel.cn/api/paas/v4", RAW_KEY,
                List.of("glm-5.4"), null, null)).key();
    }

    private static void assertCode(org.assertj.core.api.ThrowableAssert.ThrowingCallable call, String code) {
        assertThatThrownBy(call).isInstanceOf(RequestValidationException.class).extracting("code").isEqualTo(code);
    }
}
