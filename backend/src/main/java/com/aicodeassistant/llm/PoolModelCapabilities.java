package com.aicodeassistant.llm;

import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.function.Function;

/**
 * 给设置页服务商池里、不在内置能力表里的模型推算一份能力。
 * <p>
 * 内置表里的型号是写死在代码里的，中转站的模型却经常变；要求"必须先登记才能用"，
 * 等于每出一个新模型都得改代码重建。而未登记的模型只会拿到 {@link ModelCapabilities#DEFAULT}
 * （8K 窗口、不支持工具），算出的预算为负，一选就报错。
 * <p>
 * 推算规则：内置表里有同一家族（开头的字母段相同，例如都叫 gpt-…）的型号时，
 * 沿用其中最相近的一个；找不到就给一份通用参数。价格一律记为未知（0），不冒用别的型号的。
 */
public final class PoolModelCapabilities {

    /**
     * 通用参数。上下文取 200K：现在的主流对话模型都不低于这个数；估大了长会话会被上游拒，
     * 估小了只是提前压缩，所以宁可取偏小的一档。输出 32K，主循环会再按需要裁剪。
     */
    static final int GENERIC_CONTEXT_WINDOW = 200_000;
    static final int GENERIC_MAX_OUTPUT_TOKENS = 32_000;

    /** 字母段太短的（单个字母）不足以说明是同一家族，不拿来匹配。 */
    private static final int MIN_FAMILY_LENGTH = 2;

    private PoolModelCapabilities() {}

    /** capabilities 是登记进注册表的能力；basis 是给人看的依据，会原样显示在设置页上。 */
    public record Inferred(ModelCapabilities capabilities, String basis) {}

    /**
     * @param knownModelIds       内置表和 YAML 覆盖里登记过的模型 ID
     * @param staticCapabilities 按 ID 取上面这些模型的静态能力
     */
    public static Inferred infer(String modelId,
                                 Set<String> knownModelIds,
                                 Function<String, Optional<ModelCapabilities>> staticCapabilities) {
        String referenceId = closestReference(modelId, knownModelIds);
        if (referenceId == null) {
            return new Inferred(generic(modelId),
                    "通用参数（上下文 20 万、最大输出 3.2 万、支持工具、不支持图片）");
        }
        ModelCapabilities reference = staticCapabilities.apply(referenceId).orElse(null);
        if (reference == null) {
            return new Inferred(generic(modelId),
                    "通用参数（上下文 20 万、最大输出 3.2 万、支持工具、不支持图片）");
        }
        ModelCapabilities copied = new ModelCapabilities(
                modelId, modelId,
                reference.maxOutputTokens(), reference.contextWindow(),
                reference.supportsStreaming(), reference.supportsThinking(),
                reference.supportsImages(), reference.maxImages(),
                reference.supportsToolUse(),
                // 价格是别的型号的，不能冒用：记为未知
                0.0, 0.0,
                reference.tokenCharRatio(), reference.supportsCache(), reference.imageInputMode());
        return new Inferred(copied, "沿用 " + referenceId + " 的参数");
    }

    static ModelCapabilities generic(String modelId) {
        return new ModelCapabilities(modelId, modelId,
                GENERIC_MAX_OUTPUT_TOKENS, GENERIC_CONTEXT_WINDOW,
                true, false, false, 0, true,
                0.0, 0.0, 3.5, false);
    }

    /**
     * 在已知型号里找最相近的一个：必须同家族；前缀重合最长的优先；
     * 一样长时取字典序更大的（同一家族里版本更新的型号排在后面，例如 glm-5.4 排在 glm-5.3 后面）。
     *
     * @return 找不到同家族的型号时返回 null
     */
    static String closestReference(String modelId, Set<String> knownModelIds) {
        String family = family(modelId);
        if (family.length() < MIN_FAMILY_LENGTH) return null;
        String normalized = normalize(modelId);
        String bestId = null;
        int best = -1;
        for (String candidate : knownModelIds) {
            if (!family(candidate).equals(family)) continue;
            int common = commonPrefixLength(normalized, normalize(candidate));
            if (common > best || (common == best && bestId != null && candidate.compareTo(bestId) > 0)) {
                best = common;
                bestId = candidate;
            }
        }
        return bestId;
    }

    /** 型号归属的字母段：小写、去掉厂商前缀（openai/… 这类）、取开头的连续字母。glm-5.4 → glm。 */
    static String family(String modelId) {
        String id = normalize(modelId);
        int end = 0;
        while (end < id.length() && Character.isLetter(id.charAt(end))) end++;
        return id.substring(0, end);
    }

    private static String normalize(String modelId) {
        String lowered = modelId.toLowerCase(Locale.ROOT);
        int slash = lowered.lastIndexOf('/');
        return slash >= 0 ? lowered.substring(slash + 1) : lowered;
    }

    private static int commonPrefixLength(String a, String b) {
        int limit = Math.min(a.length(), b.length());
        int index = 0;
        while (index < limit && a.charAt(index) == b.charAt(index)) index++;
        return index;
    }
}
