package com.aicodeassistant.controller;

import com.aicodeassistant.controller.SceneBindingController.BindingRequest;
import com.aicodeassistant.exception.RequestValidationException;
import com.aicodeassistant.llm.LlmProviderRegistry;
import com.aicodeassistant.llm.ModelRegistry;
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
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * /api/settings/scenes — 场景清单由接口下发；可选服务商的键是池里的实际存储键。
 */
class SceneBindingControllerTest {

    private static final String RAW_KEY = "sk-scene-controller-key-123456";

    @TempDir
    Path temp;

    private LlmProviderSettingsService pool;
    private SceneBindingService service;
    private SceneBindingController controller;

    @BeforeEach
    void setUp() {
        JdbcTemplate jdbc = SettingsTestSupport.globalDb(temp);
        ObjectMapper mapper = new ObjectMapper();
        pool = new LlmProviderSettingsService(new SettingsRepository(jdbc), SettingsTestSupport.encryption(), mapper);
        ModelRegistry modelRegistry = new ModelRegistry(
                new LlmProviderRegistry(List.of(), new MockEnvironment()));
        service = new SceneBindingService(new SettingsRepository(jdbc), pool, modelRegistry, mapper);
        controller = new SceneBindingController(service, pool, modelRegistry);
    }

    @Test
    void listsScenesWithTheirBindingStateAndOnlyEnabledProviders() {
        String zhipu = addProvider("智谱", List.of("glm-5.3", "glm-5.4"), true);
        addProvider("停用的", List.of("MiniMax-M3"), false);
        service.save(SceneBindingService.PROMPT_OPTIMIZE, zhipu, "glm-5.3");

        var response = controller.list();

        assertThat(response.scenes()).hasSize(2);
        var promptOptimize = scene(response, "prompt_optimize");
        assertThat(promptOptimize.label()).isEqualTo("提示词优化");
        assertThat(promptOptimize.binding().providerKey()).isEqualTo(zhipu);
        assertThat(promptOptimize.binding().modelId()).isEqualTo("glm-5.3");
        assertThat(promptOptimize.providerName()).isEqualTo("智谱");
        assertThat(promptOptimize.active()).isTrue();

        var visionFallback = scene(response, "vision_fallback");
        assertThat(visionFallback.binding()).isNull();
        assertThat(visionFallback.providerName()).isNull();
        assertThat(visionFallback.active()).isFalse();

        assertThat(response.providers()).hasSize(1);
        var provider = response.providers().getFirst();
        assertThat(provider.key()).isEqualTo(zhipu);
        // 每个模型带上收不收图，前端据此限制图片兜底的可选项
        assertThat(provider.models()).containsExactly(
                new SceneBindingController.ModelOption("glm-5.3", false),
                new SceneBindingController.ModelOption("glm-5.4", true));
    }

    @Test
    void bindingToAProviderThatGotDisabledIsReportedAsInactive() {
        String zhipu = addProvider("智谱", List.of("glm-5.4"), true);
        service.save(SceneBindingService.VISION_FALLBACK, zhipu, "glm-5.4");
        pool.update(zhipu, new ProviderInput("智谱", "https://open.bigmodel.cn/api/paas/v4", null,
                List.of("glm-5.4"), null, false));

        var view = scene(controller.list(), "vision_fallback");

        assertThat(view.binding()).isNotNull();
        assertThat(view.providerName()).isEqualTo("智谱");
        assertThat(view.active()).isFalse();
        assertThat(controller.list().providers()).isEmpty();
    }

    @Test
    void bindingToAModelTheProviderNoLongerListsIsReportedAsInactive() {
        String zhipu = addProvider("智谱", List.of("glm-5.4", "glm-5.3"), true);
        service.save(SceneBindingService.PROMPT_OPTIMIZE, zhipu, "glm-5.3");
        pool.update(zhipu, new ProviderInput("智谱", "https://open.bigmodel.cn/api/paas/v4", null,
                List.of("glm-5.4"), null, null));

        var view = scene(controller.list(), "prompt_optimize");

        assertThat(view.binding().modelId()).isEqualTo("glm-5.3");
        assertThat(view.active()).isFalse();
    }

    @Test
    void savesAndClearsBindings() {
        String zhipu = addProvider("智谱", List.of("glm-5.4"), true);

        var saved = controller.save("vision_fallback", new BindingRequest(zhipu, "glm-5.4"));

        assertThat(saved.binding().providerKey()).isEqualTo(zhipu);
        assertThat(saved.binding().modelId()).isEqualTo("glm-5.4");
        assertThat(service.resolve(SceneBindingService.VISION_FALLBACK)).isPresent();

        assertThat(controller.clear("vision_fallback").getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        assertThat(service.find(SceneBindingService.VISION_FALLBACK)).isEmpty();
    }

    @Test
    void rejectsUnknownScenesMalformedBodiesAndTextOnlyVisionModels() {
        String zhipu = addProvider("智谱", List.of("glm-5.3", "glm-5.4"), true);

        assertCode(() -> controller.save("main_conversation", new BindingRequest(zhipu, "glm-5.4")), "UNKNOWN_SCENE");
        assertCode(() -> controller.save("prompt_optimize", null), "INVALID_SCENE_BINDING");
        assertCode(() -> controller.save("vision_fallback", new BindingRequest(zhipu, "glm-5.3")),
                "INVALID_SCENE_BINDING");
        assertCode(() -> controller.clear("nope"), "UNKNOWN_SCENE");
    }

    // ───── 辅助 ─────

    private String addProvider(String name, List<String> models, boolean enabled) {
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
