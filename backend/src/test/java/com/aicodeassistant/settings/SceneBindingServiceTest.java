package com.aicodeassistant.settings;

import com.aicodeassistant.exception.RequestValidationException;
import com.aicodeassistant.llm.LlmProviderRegistry;
import com.aicodeassistant.llm.ModelRegistry;
import com.aicodeassistant.settings.LlmProviderSettingsService.ProviderInput;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.env.MockEnvironment;

import java.nio.file.Path;
import java.util.List;

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
    private LlmProviderSettingsService pool;
    private SceneBindingService service;

    @BeforeEach
    void setUp() {
        jdbc = globalDb(temp);
        ObjectMapper mapper = new ObjectMapper();
        pool = new LlmProviderSettingsService(new SettingsRepository(jdbc), encryption(), mapper);
        ModelRegistry modelRegistry = new ModelRegistry(
                new LlmProviderRegistry(List.of(), new MockEnvironment()));
        service = new SceneBindingService(new SettingsRepository(jdbc), pool, modelRegistry, mapper);
    }

    @Test
    void onlyListsScenesThatActuallyHaveAConsumer() {
        assertThat(service.scenes()).extracting(SceneBindingService.Scene::key)
                .containsExactly("prompt_optimize", "vision_fallback");
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

        service.save(SceneBindingService.PROMPT_OPTIMIZE, provider.key(), "gpt-6.2-sol");

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
        assertThat(service.save(SceneBindingService.VISION_FALLBACK, "智谱", "glm-5.4").providerKey())
                .isEqualTo("智谱");
        assertThatThrownBy(() -> service.save(SceneBindingService.VISION_FALLBACK, "glm-official", "glm-5.4"))
                .isInstanceOf(RequestValidationException.class)
                .extracting("code").isEqualTo("PROVIDER_NOT_FOUND");
    }

    @Test
    void visionFallbackMustBeAnImageCapableModel() {
        var provider = pool.create(new ProviderInput("智谱", BASE_URL, RAW_KEY,
                List.of("glm-5.3", "glm-5.4"), null, null));

        // glm-5.3 在能力表里登记为不收图
        assertCode(() -> service.save(SceneBindingService.VISION_FALLBACK, provider.key(), "glm-5.3"),
                "INVALID_SCENE_BINDING");
        // 提示词优化没有这个限制
        assertThat(service.save(SceneBindingService.PROMPT_OPTIMIZE, provider.key(), "glm-5.3").modelId())
                .isEqualTo("glm-5.3");
        assertThat(service.save(SceneBindingService.VISION_FALLBACK, provider.key(), "glm-5.4").modelId())
                .isEqualTo("glm-5.4");
    }

    @Test
    void rejectsUnknownScenesProvidersAndUnlistedModels() {
        var provider = pool.create(new ProviderInput("智谱", BASE_URL, RAW_KEY, List.of("glm-5.4"), null, null));

        assertCode(() -> service.save("main_conversation", provider.key(), "glm-5.4"), "UNKNOWN_SCENE");
        assertCode(() -> service.save(SceneBindingService.PROMPT_OPTIMIZE, "nope", "glm-5.4"), "PROVIDER_NOT_FOUND");
        assertCode(() -> service.save(SceneBindingService.PROMPT_OPTIMIZE, provider.key(), "gpt-6.2-sol"),
                "INVALID_SCENE_BINDING");
        assertCode(() -> service.save(SceneBindingService.PROMPT_OPTIMIZE, provider.key(), " "), "INVALID_SCENE_BINDING");
        assertCode(() -> service.save(SceneBindingService.PROMPT_OPTIMIZE, " ", "glm-5.4"), "INVALID_SCENE_BINDING");
    }

    @Test
    void disabledOrDeletedProviderMakesTheBindingInactive() {
        var provider = pool.create(new ProviderInput("智谱", BASE_URL, RAW_KEY, List.of("glm-5.4"), null, null));
        service.save(SceneBindingService.PROMPT_OPTIMIZE, provider.key(), "glm-5.4");

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
        service.save(SceneBindingService.PROMPT_OPTIMIZE, provider.key(), "glm-5.3");
        assertThat(service.resolve(SceneBindingService.PROMPT_OPTIMIZE)).isPresent();

        pool.update(provider.key(), new ProviderInput("智谱", BASE_URL, null, List.of("glm-5.4"), null, null));

        // 绑定还在，但指向的模型已经不在清单里：不能拿着它去调用
        assertThat(service.find(SceneBindingService.PROMPT_OPTIMIZE)).isPresent();
        assertThat(service.resolve(SceneBindingService.PROMPT_OPTIMIZE)).isEmpty();
    }

    @Test
    void clearRemovesTheBinding() {
        var provider = pool.create(new ProviderInput("智谱", BASE_URL, RAW_KEY, List.of("glm-5.4"), null, null));
        service.save(SceneBindingService.PROMPT_OPTIMIZE, provider.key(), "glm-5.4");

        service.clear(SceneBindingService.PROMPT_OPTIMIZE);
        service.clear(SceneBindingService.PROMPT_OPTIMIZE);

        assertThat(service.find(SceneBindingService.PROMPT_OPTIMIZE)).isEmpty();
    }

    private static void assertCode(org.assertj.core.api.ThrowableAssert.ThrowingCallable call, String code) {
        assertThatThrownBy(call).isInstanceOf(RequestValidationException.class).extracting("code").isEqualTo(code);
    }
}
