package com.aicodeassistant.controller;

import com.aicodeassistant.controller.SceneBindingController.BindingRequest;
import com.aicodeassistant.exception.RequestValidationException;
import com.aicodeassistant.llm.LlmProviderRegistry;
import com.aicodeassistant.llm.LlmProvidersProperties;
import com.aicodeassistant.llm.ModelRegistry;
import com.aicodeassistant.settings.ConfiguredProviderService;
import com.aicodeassistant.settings.LlmProviderSettingsService;
import com.aicodeassistant.settings.LlmProviderSettingsService.ProviderInput;
import com.aicodeassistant.settings.SceneBindingService;
import com.aicodeassistant.settings.SettingsRepository;
import com.aicodeassistant.settings.SettingsTestSupport;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.env.MockEnvironment;

import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * /api/settings/scenes — 场景清单由接口下发；可选服务商分两类（配置里的、设置页里加的），
 * 键分别是注册名和实际存储键。
 */
class SceneBindingControllerTest {

    private static final String RAW_KEY = "sk-scene-controller-key-123456";
    private static final String CONFIG_KEY = "sk-config-controller-key-1234";

    @TempDir
    Path temp;

    private LlmProviderSettingsService pool;
    private ConfiguredProviderService configured;
    private SceneBindingService service;
    private SceneBindingController controller;

    @BeforeEach
    void setUp() {
        JdbcTemplate jdbc = SettingsTestSupport.globalDb(temp);
        ObjectMapper mapper = new ObjectMapper();
        pool = new LlmProviderSettingsService(new SettingsRepository(jdbc), SettingsTestSupport.encryption(), mapper);
        Map<String, LlmProvidersProperties.ProviderConfig> templates = new LinkedHashMap<>();
        templates.put("huoshenai", new LlmProvidersProperties.ProviderConfig(CONFIG_KEY,
                "https://huoshenai.net/v1", "gpt-6.2-sol", List.of("gpt-6.2-sol", "gpt-6.1-sol")));
        templates.put("minimax", new LlmProvidersProperties.ProviderConfig("", "https://api.minimax.chat/v1",
                "MiniMax-M3", List.of("MiniMax-M3")));
        configured = new ConfiguredProviderService(new LlmProvidersProperties(templates),
                new SettingsRepository(jdbc), SettingsTestSupport.encryption(), mapper);
        configured.seedIfNeeded();
        ModelRegistry modelRegistry = new ModelRegistry(new LlmProviderRegistry(List.of(), new MockEnvironment()));
        service = new SceneBindingService(new SettingsRepository(jdbc), pool, configured, modelRegistry,
                new LlmProviderRegistry(List.of(), new MockEnvironment()), mapper);
        controller = new SceneBindingController(service, pool, configured, modelRegistry);
    }

    @Test
    void listsScenesWithTheirBindingStateAndBothKindsOfProviders() {
        String zhipu = addPoolProvider("智谱", List.of("glm-5.3", "glm-5.4"), true);
        addPoolProvider("停用的", List.of("MiniMax-M3"), false);
        service.save(SceneBindingService.PROMPT_OPTIMIZE, SceneBindingService.SOURCE_POOL, zhipu, "glm-5.3");

        var response = controller.list();

        assertThat(response.scenes()).hasSize(6);
        var promptOptimize = scene(response, "prompt_optimize");
        assertThat(promptOptimize.label()).isEqualTo("提示词优化");
        assertThat(promptOptimize.binding().providerKey()).isEqualTo(zhipu);
        assertThat(promptOptimize.binding().modelId()).isEqualTo("glm-5.3");
        assertThat(promptOptimize.binding().isConfigured()).isFalse();
        assertThat(promptOptimize.providerName()).isEqualTo("智谱");
        assertThat(promptOptimize.active()).isTrue();

        var visionFallback = scene(response, "vision_fallback");
        assertThat(visionFallback.binding()).isNull();
        assertThat(visionFallback.providerName()).isNull();
        assertThat(visionFallback.active()).isFalse();

        // 有密钥的配置里的服务商可以选；没密钥的、停用的池条目不列
        assertThat(response.providers()).extracting(SceneBindingController.ProviderOption::source)
                .containsExactly(SceneBindingService.SOURCE_CONFIGURED, SceneBindingService.SOURCE_POOL);
        var configuredOption = response.providers().getFirst();
        assertThat(configuredOption.key()).isEqualTo("huoshenai");
        assertThat(configuredOption.name()).isEqualTo("HuoshenAI 中转站");
        var poolOption = response.providers().get(1);
        assertThat(poolOption.key()).isEqualTo(zhipu);
        // 每个模型带上收不收图，前端据此限制图片兜底的可选项
        assertThat(poolOption.models()).containsExactly(
                new SceneBindingController.ModelOption("glm-5.3", false),
                new SceneBindingController.ModelOption("glm-5.4", true));
    }

    @Test
    void keepsNamingTheProviderOfABindingThatBecameInactive() {
        String zhipu = addPoolProvider("智谱", List.of("glm-5.4"), true);
        service.save(SceneBindingService.VISION_FALLBACK, SceneBindingService.SOURCE_POOL, zhipu, "glm-5.4");
        pool.update(zhipu, new ProviderInput("智谱", "https://open.bigmodel.cn/api/paas/v4", null,
                List.of("glm-5.4"), null, false));

        var view = scene(controller.list(), "vision_fallback");

        assertThat(view.binding()).isNotNull();
        assertThat(view.providerName()).isEqualTo("智谱");
        assertThat(view.active()).isFalse();
        // 停用的池条目不再可选；配置里能用的服务商照常列出
        assertThat(controller.list().providers()).extracting(SceneBindingController.ProviderOption::key)
                .containsExactly("huoshenai");
    }

    @Test
    void aBindingCanTargetAConfiguredProvider() {
        var saved = controller.save("main_default", new BindingRequest(
                SceneBindingService.SOURCE_CONFIGURED, "huoshenai", "gpt-6.1-sol"));

        assertThat(saved.binding().isConfigured()).isTrue();
        var view = scene(controller.list(), "main_default");
        assertThat(view.providerName()).isEqualTo("HuoshenAI 中转站");
        assertThat(view.active()).isTrue();

        // source 留空按设置页里加的服务商处理；按注册名找不到
        assertCode(() -> controller.save("main_default", new BindingRequest(null, "huoshenai", "gpt-6.1-sol")),
                "PROVIDER_NOT_FOUND");
    }

    @Test
    void bindingToAModelTheProviderNoLongerListsIsReportedAsInactive() {
        String zhipu = addPoolProvider("智谱", List.of("glm-5.4", "glm-5.3"), true);
        service.save(SceneBindingService.PROMPT_OPTIMIZE, SceneBindingService.SOURCE_POOL, zhipu, "glm-5.3");
        pool.update(zhipu, new ProviderInput("智谱", "https://open.bigmodel.cn/api/paas/v4", null,
                List.of("glm-5.4"), null, null));

        var view = scene(controller.list(), "prompt_optimize");

        assertThat(view.binding().modelId()).isEqualTo("glm-5.3");
        assertThat(view.active()).isFalse();
    }

    @Test
    void savesAndClearsBindings() {
        String zhipu = addPoolProvider("智谱", List.of("glm-5.4"), true);

        var saved = controller.save("vision_fallback", new BindingRequest(SceneBindingService.SOURCE_POOL, zhipu, "glm-5.4"));

        assertThat(saved.binding().providerKey()).isEqualTo(zhipu);
        assertThat(saved.binding().modelId()).isEqualTo("glm-5.4");
        assertThat(service.resolve(SceneBindingService.VISION_FALLBACK)).isPresent();

        assertThat(controller.clear("vision_fallback").getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        assertThat(service.find(SceneBindingService.VISION_FALLBACK)).isEmpty();
    }

    @Test
    void rejectsUnknownScenesMalformedBodiesAndTextOnlyVisionModels() {
        String zhipu = addPoolProvider("智谱", List.of("glm-5.3", "glm-5.4"), true);
        String source = SceneBindingService.SOURCE_POOL;

        assertCode(() -> controller.save("main_conversation", new BindingRequest(source, zhipu, "glm-5.4")), "UNKNOWN_SCENE");
        assertCode(() -> controller.save("prompt_optimize", null), "INVALID_SCENE_BINDING");
        assertCode(() -> controller.save("vision_fallback", new BindingRequest(source, zhipu, "glm-5.3")),
                "INVALID_SCENE_BINDING");
        assertCode(() -> controller.clear("nope"), "UNKNOWN_SCENE");
    }

    // ───── 辅助 ─────

    private String addPoolProvider(String name, List<String> models, boolean enabled) {
        return pool.create(new ProviderInput(name, "https://open.bigmodel.cn/api/paas/v4", RAW_KEY,
                models, null, enabled)).key();
    }

    private static SceneBindingController.SceneView scene(
            SceneBindingController.ScenesResponse response, String key) {
        return response.scenes().stream().filter(s -> s.key().equals(key)).findFirst().orElseThrow();
    }

    private static void assertCode(org.assertj.core.api.ThrowableAssert.ThrowingCallable call, String code) {
        assertThatThrownBy(call).isInstanceOf(RequestValidationException.class).extracting("code").isEqualTo(code);
    }
}
