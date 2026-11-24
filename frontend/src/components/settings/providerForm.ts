/**
 * 服务商表单的纯函数：表单文本 ⇄ 接口入参的转换与本地校验，不含界面状态。
 */

import type { LlmProviderInput, LlmProviderView } from '@/api/settingsApi';

export interface ProviderFormState {
    name: string;
    baseUrl: string;
    /** 密钥输入框的内容；编辑时留空表示保持已保存的密钥不变 */
    apiKey: string;
    /** 模型清单的原始文本：每行一个，或用逗号分隔 */
    modelsText: string;
    /** 留空表示取清单里的第一个 */
    defaultModel: string;
    enabled: boolean;
}

export const EMPTY_PROVIDER_FORM: ProviderFormState = {
    name: '',
    baseUrl: '',
    apiKey: '',
    modelsText: '',
    defaultModel: '',
    enabled: true,
};

/** 逗号、换行分隔都接受；去空白、去空项、去重，保持大小写与原顺序（与后端的归一规则一致）。 */
export function splitModelList(text: string): string[] {
    const out: string[] = [];
    for (const piece of text.split(/[\n\r,]+/)) {
        const model = piece.trim();
        if (model && !out.includes(model)) out.push(model);
    }
    return out;
}

export function formFromProvider(provider: LlmProviderView): ProviderFormState {
    return {
        name: provider.name,
        baseUrl: provider.baseUrl,
        apiKey: '',
        modelsText: provider.models.join('\n'),
        defaultModel: provider.defaultModel,
        enabled: provider.enabled,
    };
}

/** 界面本地能提前发现的问题；没有问题时返回 null。其余校验以后端为准。 */
export function validateProviderForm(form: ProviderFormState): string | null {
    if (!form.name.trim()) return '请填写服务商名称';
    if (!/^https?:\/\//i.test(form.baseUrl.trim())) return '接口地址必须以 http:// 或 https:// 开头';
    if (splitModelList(form.modelsText).length === 0) return '至少填写一个模型';
    return null;
}

export function providerInputFromForm(form: ProviderFormState): LlmProviderInput {
    const models = splitModelList(form.modelsText);
    const defaultModel = form.defaultModel.trim();
    return {
        name: form.name.trim(),
        baseUrl: form.baseUrl.trim(),
        // 留空 = 不修改已保存的密钥；新建时表示无密钥的服务商（例如本地模型）
        apiKey: form.apiKey.trim() || null,
        models,
        defaultModel: models.includes(defaultModel) ? defaultModel : (models[0] ?? null),
        enabled: form.enabled,
    };
}

/** 把接口返回的错误或任意异常转成可展示的文案。 */
export function messageOf(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
}
