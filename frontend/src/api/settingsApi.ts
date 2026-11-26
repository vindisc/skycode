/**
 * 设置页「模型服务商」「场景分派」的接口封装。
 * 字段与后端 LlmProviderSettingsController / SceneBindingController 的响应记录一一对应。
 * 密钥只写不读：请求体里可以带明文，响应里永远只有打码后的形式。
 *
 * 注意：后端序列化时会省略值为 null 的字段，所以下面标成 `?: T | null` 的字段收到时是 undefined。
 * 判断"有没有"一律用 == null / != null，不能和 null 做严格比较。
 */

import { request } from './request';

export interface LlmProviderView {
    /** 池里的实际存储键：创建后不变，改显示名不影响它 */
    key: string;
    name: string;
    baseUrl: string;
    /** 打码后的密钥（只保留末 4 位）；没有密钥时为空串 */
    apiKeyMasked: string;
    hasApiKey: boolean;
    models: string[];
    defaultModel: string;
    enabled: boolean;
    updatedAt: string;
}

export interface ProviderModelSkip {
    model: string;
    reason: string;
}

/** 最近一次同步里，池中一个条目注册进运行时的结果。 */
/** 一个不在内置能力表里的模型，以及给它登记能力时依据的参数（会原样显示给用户）。 */
export interface InferredModel {
    model: string;
    basis: string;
}

export interface ProviderRouting {
    providerKey: string;
    providerName: string;
    /** 注册名（db:&lt;key&gt;）；没注册时字段缺失 */
    registeredAs?: string | null;
    registeredModels: string[];
    /** 注册的模型里不在内置能力表里的那些；没有就是空数组 */
    inferredModels?: InferredModel[];
    /** 实际生效的默认模型；没注册时字段缺失 */
    defaultModel?: string | null;
    skippedModels: ProviderModelSkip[];
    /** 整个条目被跳过的原因；已注册时字段缺失 */
    skipReason?: string | null;
    /** 有需要用户处理的问题：这个条目里有模型没能注册成功。已停用、模型都由别处提供不算 */
    needsAttention: boolean;
}

export interface LlmProviderInput {
    name: string;
    baseUrl: string;
    /** 留空表示保持原值不变 */
    apiKey?: string | null;
    models: string[];
    defaultModel?: string | null;
    enabled?: boolean | null;
}

export interface LlmProviderListResponse {
    providers: LlmProviderView[];
    /** 为 false 表示后端没有稳定的加密密钥，保存带密钥的服务商会遭到拒绝 */
    apiKeyStorageReady: boolean;
    routing: ProviderRouting[];
}

export interface LlmProviderResponse {
    provider: LlmProviderView;
    routing: ProviderRouting[];
}

/** 从接口获取模型清单的入参：apiKey 与 providerKey 二选一（编辑时带后者，复用已保存的密钥） */
export interface DiscoverModelsInput {
    baseUrl: string;
    apiKey?: string | null;
    providerKey?: string | null;
}

export interface LlmProviderTestResponse {
    ok: boolean;
    model: string;
    latencyMs: number;
    /** 连通时字段缺失 */
    error?: string | null;
}

/**
 * 场景绑定。source 指向哪一类服务商：
 * - configured：配置文件里定义的，providerKey 是注册名（huoshenai、deepseek…）
 * - pool：设置页里添加的，providerKey 是实际存储键
 * 早期存的绑定没有 source，一律按 pool 处理。
 */
export interface SceneBinding {
    source?: 'pool' | 'configured';
    providerKey: string;
    modelId: string;
}

export interface SceneView {
    key: string;
    label: string;
    description: string;
    /** 没有绑定时字段缺失 */
    binding?: SceneBinding | null;
    /** 绑定指向的服务商当前的显示名；没有绑定或服务商已被删除时字段缺失 */
    providerName?: string | null;
    /** 绑定此刻是否真的生效 */
    active: boolean;
}

export interface SceneModelOption {
    id: string;
    supportsImages: boolean;
}

export interface SceneProviderOption {
    /** 与 SceneBinding.source 相同 */
    source: 'pool' | 'configured';
    key: string;
    name: string;
    models: SceneModelOption[];
}

export interface ScenesResponse {
    scenes: SceneView[];
    /** 可选服务商，只含已启用的 */
    providers: SceneProviderOption[];
}

const PROVIDERS = '/api/settings/llm-providers';
const SCENES = '/api/settings/scenes';
const segment = encodeURIComponent;

export const settingsApi = {
    listProviders: () => request<LlmProviderListResponse>(PROVIDERS),

    createProvider: (input: LlmProviderInput) =>
        request<LlmProviderResponse>(PROVIDERS, { method: 'POST', body: JSON.stringify(input) }),

    updateProvider: (key: string, input: LlmProviderInput) =>
        request<LlmProviderResponse>(`${PROVIDERS}/${segment(key)}`, {
            method: 'PUT',
            body: JSON.stringify(input),
        }),

    deleteProvider: (key: string) =>
        request<void>(`${PROVIDERS}/${segment(key)}`, { method: 'DELETE' }),

    /** 丢弃后端缓存、从库重新读取，再同步一次运行时注册表 */
    reloadProviders: () =>
        request<LlmProviderListResponse>(`${PROVIDERS}/reload`, { method: 'POST' }),

    /**
     * 向服务商的 /models 接口要模型清单，返回去重排序后的模型 ID；只读，不保存任何东西。
     * 后端的响应是 { models: [...] }，这里把数组取出来再交给调用方。
     */
    discoverModels: async (input: DiscoverModelsInput): Promise<string[]> => {
        const data = await request<{ models?: string[] }>(`${PROVIDERS}/discover`, {
            method: 'POST',
            body: JSON.stringify(input),
        });
        return Array.isArray(data?.models) ? data.models : [];
    },

    /** 连通性测试：model 留空表示测该服务商的默认模型 */
    testProvider: (key: string, model?: string) =>
        request<LlmProviderTestResponse>(`${PROVIDERS}/${segment(key)}/test`, {
            method: 'POST',
            body: JSON.stringify(model ? { model } : {}),
        }),

    listScenes: () => request<ScenesResponse>(SCENES),

    saveSceneBinding: (scene: string, source: SceneBinding['source'], providerKey: string, modelId: string) =>
        request<{ binding: SceneBinding }>(`${SCENES}/${segment(scene)}`, {
            method: 'PUT',
            body: JSON.stringify({ source, providerKey, modelId }),
        }),

    clearSceneBinding: (scene: string) =>
        request<void>(`${SCENES}/${segment(scene)}`, { method: 'DELETE' }),
};

/**
 * 配置文件（application.yml + 环境变量）里定义的一个服务商，叠加设置页里对它的修改。
 * name 是注册名；改它存的是"覆盖"，删掉覆盖就回到配置文件的值。
 */
export interface ConfiguredProviderView {
    name: string;
    displayName: string;
    baseUrl: string;
    /** 打码后的密钥；没有密钥时为空串 */
    apiKeyMasked: string;
    hasApiKey: boolean;
    /** 生效的密钥来自配置文件，而不是页面上填的 */
    keyFromConfig: boolean;
    models: string[];
    defaultModel: string;
    /** 页面上有没有把它停用 */
    enabled: boolean;
    /** 在设置页里改过（存了覆盖） */
    overridden: boolean;
    /** 已经注册进运行时：已启用、有密钥、有模型 */
    active: boolean;
    /** 接口地址能不能在页面上改（目前只有 DeepSeek，其余写死在配置里） */
    baseUrlEditable: boolean;
}

/** 修改配置里的服务商。apiKey 留空表示不改密钥；models 不传表示不改模型清单。 */
export interface ConfiguredProviderInput {
    apiKey?: string | null;
    baseUrl?: string | null;
    models?: string[] | null;
    defaultModel?: string | null;
    enabled?: boolean | null;
}

export interface ConfiguredProviderResponse {
    provider: ConfiguredProviderView;
    routing: ProviderRouting[];
}

const CONFIGURED_PROVIDERS = '/api/settings/configured-providers';

export const configuredProvidersApi = {
    list: () => request<ConfiguredProviderView[]>(CONFIGURED_PROVIDERS),

    save: (name: string, input: ConfiguredProviderInput) =>
        request<ConfiguredProviderResponse>(`${CONFIGURED_PROVIDERS}/${segment(name)}`, {
            method: 'PUT',
            body: JSON.stringify(input),
        }),

    /** 删掉设置页里的修改，回到配置文件的值 */
    reset: (name: string) => request<void>(`${CONFIGURED_PROVIDERS}/${segment(name)}`, { method: 'DELETE' }),

    /** 连通性测试：按此刻生效的配置发一次最小对话请求；model 留空表示测默认模型 */
    test: (name: string, model?: string) =>
        request<LlmProviderTestResponse>(`${CONFIGURED_PROVIDERS}/${segment(name)}/test`, {
            method: 'POST',
            body: JSON.stringify(model ? { model } : {}),
        }),

    /** 从接口获取模型清单，用此刻生效的地址和密钥 */
    discoverModels: (name: string) =>
        request<string[]>(`${CONFIGURED_PROVIDERS}/discover`, { method: 'POST', body: JSON.stringify({ name }) }),
};
