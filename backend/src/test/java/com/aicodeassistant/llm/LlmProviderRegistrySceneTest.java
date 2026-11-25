package com.aicodeassistant.llm;

import com.aicodeassistant.llm.impl.OpenAiCompatibleProvider;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 场景分派接到注册表上的两个钩子：主对话默认模型、后台小任务。没绑定、绑定失效、查询出错，都要走回配置文件里的值。
 */
class LlmProviderRegistrySceneTest {

    private LlmProviderRegistry registry;

    @BeforeEach
    void setUp() {
        registry = new LlmProviderRegistry(List.of(
                provider("huoshenai", List.of("gpt-6.2-sol", "gpt-6.1-sol")),
                provider("zhipu", List.of("glm-5.4"))), new MockEnvironment());
        ReflectionTestUtils.setField(registry, "configuredDefaultModel", "gpt-6.2-sol");
        ReflectionTestUtils.setField(registry, "configuredFastModel", "gpt-6-sol");   // 没有任何 Provider 提供
    }

    @Test
    void withoutSceneBindingsTheConfiguredValuesApply() {
        assertThat(registry.getDefaultModel()).isEqualTo("gpt-6.2-sol");
        // 配置的快速模型不可用：退到第一个 Provider 的快速模型
        assertThat(registry.getFastModel()).isEqualTo("gpt-6.2-sol");
        assertThat(registry.sceneBoundModel(ModelScenes.MAIN_DEFAULT)).isEmpty();
    }

    @Test
    void aBoundModelWinsOverTheConfiguredDefaultAndFastModel() {
        registry.setSceneModelLookup(scene -> switch (scene) {
            case ModelScenes.MAIN_DEFAULT -> Optional.of("glm-5.4");
            case ModelScenes.FAST -> Optional.of("gpt-6.1-sol");
            default -> Optional.empty();
        });

        assertThat(registry.getDefaultModel()).isEqualTo("glm-5.4");
        assertThat(registry.getFastModel()).isEqualTo("gpt-6.1-sol");
        // 这两处是同一个入口，都要跟着变
        assertThat(registry.getLightweightModel()).isEqualTo("gpt-6.1-sol");
        assertThat(registry.getMainLoopModel()).isEqualTo("glm-5.4");
    }

    @Test
    void aBindingToAModelNoProviderServesRightNowIsIgnored() {
        registry.setSceneModelLookup(scene -> Optional.of("gone-model"));

        assertThat(registry.getDefaultModel()).isEqualTo("gpt-6.2-sol");
        assertThat(registry.sceneBoundModel(ModelScenes.MAIN_DEFAULT)).isEmpty();
    }

    @Test
    void aFailingLookupNeverBreaksTheDefaultResolution() {
        registry.setSceneModelLookup(scene -> { throw new IllegalStateException("settings table locked"); });

        assertThat(registry.getDefaultModel()).isEqualTo("gpt-6.2-sol");
        assertThat(registry.getFastModel()).isEqualTo("gpt-6.2-sol");

        // 传 null 即卸掉
        registry.setSceneModelLookup(null);
        assertThat(registry.getDefaultModel()).isEqualTo("gpt-6.2-sol");
    }

    @Test
    void configuredProvidersAreReplacedOrRemovedByNameWithoutTouchingThePool() {
        registry.replaceDbProviders(List.of(provider("db:pool", List.of("MiniMax-M3"))));

        registry.applyConfiguredProviders(
                List.of(provider("zhipu", List.of("glm-5.4", "glm-5.3"))),
                List.of("huoshenai"));

        assertThat(registry.registeredProviderNames()).containsExactly("zhipu", "db:pool");
        assertThat(registry.getProvider("glm-5.3").getProviderName()).isEqualTo("zhipu");
        assertThat(registry.getProvider("MiniMax-M3").getProviderName()).isEqualTo("db:pool");
        // 默认模型原本是 huoshenai 的：它没了，退到剩下的 Provider 里可用的
        assertThat(registry.getDefaultModel()).isEqualTo("glm-5.4");
    }

    @Test
    void applyConfiguredProvidersRefusesPoolNames() {
        assertThatThrownBy(() -> registry.applyConfiguredProviders(
                List.of(provider("db:sneaky", List.of("MiniMax-M3"))), List.of()))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("db:");
        // 移除名单里的池名字不会被动到
        registry.applyConfiguredProviders(List.of(), List.of("db:pool", "huoshenai"));
        assertThat(registry.findProviderByName("huoshenai")).isEmpty();
    }

    private static OpenAiCompatibleProvider provider(String name, List<String> models) {
        return new OpenAiCompatibleProvider(name, new ObjectMapper(),
                new LlmHttpProperties(new LlmHttpProperties.PoolProperties(1, 5), 5, 5, false),
                new ApiKeyRotationManager("sk-test"), "sk-test", "https://example.invalid/v1",
                models.getFirst(), models);
    }
}
