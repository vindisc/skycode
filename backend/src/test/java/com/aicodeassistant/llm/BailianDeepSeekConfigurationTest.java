package com.aicodeassistant.llm;

import com.aicodeassistant.controller.ModelController;
import com.aicodeassistant.llm.impl.OpenAiCompatibleProvider;
import com.aicodeassistant.settings.SceneBindingService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Tag;
import org.springframework.boot.context.properties.bind.Bindable;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.io.ClassPathResource;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.mock;

@Tag("smoke")
class BailianDeepSeekConfigurationTest {
    private static final String BAILIAN = "deepseek-v4.1-flash";

    @Test
    void actualYamlDefaultsRouteBailianAndDirectDeepSeekIndependently() throws Exception {
        // 本 fork 把 app.model.* 的 yaml 默认值换成了自用的模型（HuoshenAI gpt-6 系列）。
        // 这个用例验证的是"百炼托管与 DeepSeek 直连互相独立路由"，与默认是哪个模型无关，
        // 所以显式用环境变量指回上游示例模型，不依赖 yaml 默认值。MockEnvironment 自带的
        // 属性源排在最前，优先于下面追加的 yaml。
        MockEnvironment env = new MockEnvironment()
                .withProperty("LLM_PROVIDER_DASHSCOPE_TOKEN_PLAN_API_KEY", "test-token-plan")
                .withProperty("LLM_PROVIDER_DEEPSEEK_API_KEY", "test-direct")
                .withProperty("LLM_DEFAULT_MODEL", BAILIAN)
                .withProperty("LLM_VISION_FALLBACK_MODEL", BAILIAN)
                .withProperty("LLM_FAST_MODEL", BAILIAN)
                .withProperty("app.model.tier-chain[0]", BAILIAN);
        for (var source : new YamlPropertySourceLoader().load("application", new ClassPathResource("application.yml"))) {
            env.getPropertySources().addLast(source);
        }
        LlmProvidersProperties configs = Binder.get(env).bind("llm", Bindable.of(LlmProvidersProperties.class)).get();
        var bailianConfig = configs.providers().get("dashscope-token-plan");
        var directConfig = configs.providers().get("deepseek");
        assertEquals(BAILIAN, env.getProperty("app.model.default"));
        assertEquals("deepseek-flash", env.getProperty("app.compact.model"));
        assertEquals("deepseek", env.getProperty("app.compact.provider"));
        assertEquals(BAILIAN, env.getProperty("app.model.vision-fallback"));
        assertEquals(BAILIAN, env.getProperty("app.model.fast"));
        assertEquals(BAILIAN, env.getProperty("app.model.tier-chain[0]"));
        assertFalse(configs.providers().values().stream().anyMatch(p -> p.models().contains("qwen3.7-plus")));
        assertEquals(BAILIAN, bailianConfig.defaultModel());
        assertTrue(bailianConfig.baseUrl().contains("token-plan.cn-beijing.maas.aliyuncs.com"));
        assertEquals("https://api.deepseek.com/v1", directConfig.baseUrl());
        assertEquals("test-token-plan", bailianConfig.apiKey());
        assertEquals("test-direct", directConfig.apiKey());
        // Token Plan 的模型清单必须精确等于 application.yml 默认值：四个下架模型不得回归。
        assertThat(bailianConfig.models())
                .containsExactly("deepseek-v4.1-flash", "bailian/glm-5.3", "qwen4-max-preview", "qwen4-max")
                .doesNotContain("deepseek-v4-pro-0813", "deepseek-v4-flash-0731");

        var registry = new LlmProviderRegistry(List.of(provider("deepseek", directConfig),
                provider("dashscope-token-plan", bailianConfig)), env);
        ReflectionTestUtils.setField(registry, "configuredDefaultModel", env.getProperty("app.model.default"));
        assertEquals("dashscope-token-plan", registry.getProvider(BAILIAN).getProviderName());
        assertEquals("deepseek", registry.getProvider("deepseek-flash").getProviderName());
        assertEquals(BAILIAN, registry.listAvailableModels().getFirst());
        // Direct DeepSeek is registered first; global fast selection must still use Bailian.
        assertEquals(BAILIAN, registry.getFastModel());
        assertEquals(BAILIAN, registry.getLightweightModel());
        assertFalse(registry.supportsModel("qwen3.7-plus"));
        var models = new ModelRegistry(registry);
        assertTrue(registry.getProvider("qwen4-max").supportsThinking("qwen4-max"));
        assertThat(models.getCapabilities("qwen4-max")).usingRecursiveComparison()
                .ignoringFields("modelId", "displayName")
                .isEqualTo(models.getCapabilities("qwen4-max-preview"));
        assertFalse(models.isKnownModel("qwen3.7-plus"));
        assertEquals(ModelCapabilities.DEFAULT, models.getCapabilities("qwen3.7-plus"));
        ModelCapabilities caps = models.getCapabilities(BAILIAN);
        assertEquals(393216, caps.maxOutputTokens());
        assertEquals(1000000, caps.contextWindow());
        assertEquals(4, caps.maxImages());
        assertTrue(caps.supportsImages() && caps.supportsThinking() && caps.supportsToolUse());
        assertEquals(600, models.getCapabilities("deepseek-flash").maxImages());
        assertEquals(BAILIAN, new VisionModelRouter(registry, models, mock(SceneBindingService.class))
                .resolveVisionModel("bailian/glm-5.3"));
        var response = new ModelController(registry, models).listModels(null).getBody();
        assertNotNull(response);
        assertEquals(BAILIAN, response.defaultModel());
        assertEquals("DeepSeek V4.1 Flash（百炼）", response.models().getFirst().displayName());
        ReflectionTestUtils.setField(registry, "configuredFastModel", "deepseek-flash");
        assertEquals("deepseek-flash", registry.getFastModel());
    }

    private OpenAiCompatibleProvider provider(String name, LlmProvidersProperties.ProviderConfig config) {
        return new OpenAiCompatibleProvider(name, new ObjectMapper(),
                new LlmHttpProperties(new LlmHttpProperties.PoolProperties(2, 30), 10, 10, true),
                new ApiKeyRotationManager(config.apiKey()), config.apiKey(), config.baseUrl(),
                config.defaultModel(), config.models());
    }
}
