package com.aicodeassistant.llm;

import com.aicodeassistant.llm.PoolModelCapabilities.Inferred;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 给不在内置能力表里的模型推算能力：同家族沿用最相近的型号，没有就给通用参数。
 */
class PoolModelCapabilitiesTest {

    private static final int GPT_CONTEXT = 1_050_000;

    /** 一小份仿真的已知型号表，字段取值只要能区分出"沿用了谁"就行。 */
    private static final Map<String, ModelCapabilities> KNOWN = Map.of(
            "gpt-6.2-sol", caps("gpt-6.2-sol", GPT_CONTEXT, true),
            "gpt-6.1-sol", caps("gpt-6.1-sol", GPT_CONTEXT, true),
            "gpt-6-sol", caps("gpt-6-sol", GPT_CONTEXT, true),
            "glm-5.3", caps("glm-5.3", 1_048_576, false),
            "glm-5.4", caps("glm-5.4", 1_048_576, true),
            "openai/gpt-6-astra", caps("openai/gpt-6-astra", GPT_CONTEXT, true),
            "x-ai/grok-4.7", caps("x-ai/grok-4.7", 500_000, true));

    private static ModelCapabilities caps(String id, int contextWindow, boolean images) {
        return new ModelCapabilities(id, id, 128_000, contextWindow,
                true, true, images, images ? 4 : 0, true, 0.01, 0.05, 3.5, false);
    }

    private static Inferred infer(String modelId) {
        return PoolModelCapabilities.infer(modelId, Set.copyOf(KNOWN.keySet()), id -> Optional.ofNullable(KNOWN.get(id)));
    }

    @Test
    void copiesTheClosestKnownModelOfTheSameFamily() {
        Inferred inferred = infer("gpt-6.3-sol");

        assertThat(inferred.basis()).isEqualTo("沿用 gpt-6.2-sol 的参数");
        ModelCapabilities caps = inferred.capabilities();
        // 能力登记在新的模型 ID 名下，不是参照型号的名下
        assertThat(caps.modelId()).isEqualTo("gpt-6.3-sol");
        assertThat(caps.displayName()).isEqualTo("gpt-6.3-sol");
        assertThat(caps.contextWindow()).isEqualTo(GPT_CONTEXT);
        assertThat(caps.supportsImages()).isTrue();
        assertThat(caps.maxImages()).isEqualTo(4);
        assertThat(caps.maxOutputTokens()).isEqualTo(128_000);
        assertThat(caps.supportsToolUse()).isTrue();
    }

    @Test
    void doesNotInheritTheReferenceModelsPrice() {
        // 价格是别的型号的，冒用会让费用显示失真
        assertThat(infer("gpt-6.3-sol").capabilities().costPer1kInput()).isZero();
        assertThat(infer("gpt-6.3-sol").capabilities().costPer1kOutput()).isZero();
    }

    @Test
    void prefersTheNewerModelWhenTwoAreEquallyClose() {
        // glm-5.9 和 glm-5.3、glm-5.4 的前缀重合一样长，取版本更新的 glm-5.4，连带继承了它收图的能力
        Inferred inferred = infer("glm-5.9");

        assertThat(inferred.basis()).isEqualTo("沿用 glm-5.4 的参数");
        assertThat(inferred.capabilities().supportsImages()).isTrue();
    }

    @Test
    void doesNotJumpAcrossFamiliesEvenWhenThePrefixIsLonger() {
        Inferred inferred = infer("grok-4.8");

        assertThat(inferred.basis()).isEqualTo("沿用 x-ai/grok-4.7 的参数");
        assertThat(inferred.capabilities().contextWindow()).isEqualTo(500_000);
    }

    @Test
    void ignoresVendorPrefixesAndLetterCase() {
        assertThat(infer("OpenAI/GPT-6.3-Sol").basis()).isEqualTo("沿用 gpt-6.2-sol 的参数");
        assertThat(infer("openai/gpt-6.3-sol").capabilities().modelId()).isEqualTo("openai/gpt-6.3-sol");
    }

    @Test
    void fallsBackToGenericCapabilitiesWhenNoKnownModelSharesTheFamily() {
        Inferred inferred = infer("codex-auto-review");

        assertThat(inferred.basis()).startsWith("通用参数");
        ModelCapabilities caps = inferred.capabilities();
        assertThat(caps.modelId()).isEqualTo("codex-auto-review");
        assertThat(caps.contextWindow()).isEqualTo(PoolModelCapabilities.GENERIC_CONTEXT_WINDOW);
        assertThat(caps.maxOutputTokens()).isEqualTo(PoolModelCapabilities.GENERIC_MAX_OUTPUT_TOKENS);
        // 通用参数必须够主循环算预算：不能是保守默认值那档（8K 窗口、不支持工具）
        assertThat(caps.contextWindow()).isGreaterThan(ModelCapabilities.DEFAULT.contextWindow());
        assertThat(caps.supportsToolUse()).isTrue();
        // 收不收图不知道，按不收处理：真有图会走视觉兜底
        assertThat(caps.supportsImages()).isFalse();
        assertThat(caps.supportsThinking()).isFalse();
    }

    @Test
    void aSingleLetterPrefixIsNotEnoughToCountAsTheSameFamily() {
        // 已知表里有 x-ai/grok-4.7；"x" 这个字母段太短，不能因为它以 x 开头就认定是同一家族
        assertThat(PoolModelCapabilities.closestReference("x", KNOWN.keySet())).isNull();
        assertThat(infer("x").basis()).startsWith("通用参数");
    }

    @Test
    void closestReferenceIsDeterministicRegardlessOfIterationOrder() {
        String first = PoolModelCapabilities.closestReference("glm-6", Set.of("glm-5.3", "glm-5.4"));
        String second = PoolModelCapabilities.closestReference("glm-6", Set.copyOf(List.of("glm-5.4", "glm-5.3")));

        assertThat(first).isEqualTo("glm-5.4").isEqualTo(second);
    }
}
