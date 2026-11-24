/**
 * 设置页「模型服务商」「场景分派」的接口封装。
 * 字段与后端 LlmProviderSettingsController / SceneBindingController 的响应记录一一对应。
 * 密钥只写不读：请求体里可以带明文，响应里永远只有打码后的形式。
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
export interface ProviderRouting {
    providerKey: string;
    providerName: string;
    /** 注册名（db:&lt;key&gt;）；没注册时为 null */
    registeredAs: string | null;
    registeredModels: string[];
    /** 实际生效的默认模型；没注册时为 null */
    defaultModel: string | null;
    skippedModels: ProviderModelSkip[];
    /** 整个条目被跳过的原因；已注册时为 null */
    skipReason: string | null;
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

export interface LlmProviderTestResponse {
    ok: boolean;
    model: string;
    latencyMs: number;
    /** 为 null 表示连通 */
    error: string | null;
}

export interface SceneBinding {
    providerKey: string;
    modelId: string;
}

export interface SceneView {
    key: string;
    label: string;
    description: string;
    binding: SceneBinding | null;
    /** 绑定指向的服务商当前的显示名；服务商已被删除时为 null */
    providerName: string | null;
    /** 绑定此刻是否真的生效 */
    active: boolean;
}

export interface SceneModelOption {
    id: string;
    supportsImages: boolean;
}

export interface SceneProviderOption {
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

    /** 连通性测试：model 留空表示测该服务商的默认模型 */
    testProvider: (key: string, model?: string) =>
        request<LlmProviderTestResponse>(`${PROVIDERS}/${segment(key)}/test`, {
            method: 'POST',
            body: JSON.stringify(model ? { model } : {}),
        }),

    listScenes: () => request<ScenesResponse>(SCENES),

    saveSceneBinding: (scene: string, providerKey: string, modelId: string) =>
        request<{ binding: SceneBinding }>(`${SCENES}/${segment(scene)}`, {
            method: 'PUT',
            body: JSON.stringify({ providerKey, modelId }),
        }),

    clearSceneBinding: (scene: string) =>
        request<void>(`${SCENES}/${segment(scene)}`, { method: 'DELETE' }),
};
