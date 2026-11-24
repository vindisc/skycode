package com.aicodeassistant.settings;

import java.util.List;

/** 设置页里保存的值类型。 */
public final class Setting {

    private Setting() {}

    /**
     * 服务商池里的一个条目。落库时只有 {@code apiKey} 字段加密，其余字段明文便于排查。
     *
     * @param models       逗号、换行或空格分隔后归一的模型 ID 列表，大小写保持原样
     * @param defaultModel 该服务商的默认模型，必定属于 {@code models}
     */
    public record LlmProviderConfig(
            String name,
            String baseUrl,
            String apiKey,
            List<String> models,
            String defaultModel,
            boolean enabled
    ) {}

    /**
     * 场景绑定：只存引用，不重复保存密钥。
     *
     * @param providerKey 服务商池里的实际存储键（不是显示名）
     * @param modelId     该服务商名下的模型 ID
     */
    public record SceneBinding(String providerKey, String modelId) {}
}
