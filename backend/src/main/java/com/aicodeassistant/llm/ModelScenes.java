package com.aicodeassistant.llm;

/** 场景分派里的场景键。每个场景都必须有消费方，否则界面上选了也不会生效。 */
public final class ModelScenes {

    /** 新会话默认使用的模型（已打开的会话保持各自选的模型）。消费方：LlmProviderRegistry.getDefaultModel。 */
    public static final String MAIN_DEFAULT = "main_default";
    /** 上下文太长时生成摘要用的模型。消费方：ContextCompactor。 */
    public static final String COMPACT_SUMMARY = "compact_summary";
    /** 后台小任务用的模型：可视化意图识别、记忆重排。消费方：LlmProviderRegistry.getFastModel。 */
    public static final String FAST = "fast";
    /** 子 Agent 默认使用的模型；没绑定时跟随主对话。消费方：SubAgentExecutor。 */
    public static final String SUB_AGENT = "sub_agent";
    /** 当前模型不支持图片时改用的模型。消费方：VisionModelRouter。 */
    public static final String VISION_FALLBACK = "vision_fallback";
    /** 输入框「优化提示词」用的模型。消费方：ExternalLlmClient。 */
    public static final String PROMPT_OPTIMIZE = "prompt_optimize";

    private ModelScenes() {}
}
