import { describe, expect, it } from 'vitest';
import {
    EMPTY_PROVIDER_FORM,
    formFromProvider,
    providerInputFromForm,
    splitModelList,
    validateProviderForm,
} from './providerForm';
import type { LlmProviderView } from '@/api/settingsApi';

describe('providerForm', () => {
    it('splits the model list on commas and newlines, trimming and deduplicating', () => {
        expect(splitModelList(' glm-5.4, gpt-6.2-sol\r\n\nGLM-5.4\n gpt-6.2-sol ,, ')).toEqual([
            'glm-5.4',
            'gpt-6.2-sol',
            'GLM-5.4',
        ]);
        expect(splitModelList('')).toEqual([]);
    });

    it('validates locally before calling the backend', () => {
        expect(validateProviderForm(EMPTY_PROVIDER_FORM)).toBe('请填写服务商名称');
        expect(validateProviderForm({ ...EMPTY_PROVIDER_FORM, name: '智谱' })).toBe('接口地址必须以 http:// 或 https:// 开头');
        expect(validateProviderForm({ ...EMPTY_PROVIDER_FORM, name: '智谱', baseUrl: 'x.example/v1' }))
            .toBe('接口地址必须以 http:// 或 https:// 开头');
        expect(validateProviderForm({ ...EMPTY_PROVIDER_FORM, name: '智谱', baseUrl: 'https://x.example/v1' }))
            .toBe('至少填写一个模型');
        expect(validateProviderForm({
            ...EMPTY_PROVIDER_FORM,
            name: '智谱',
            baseUrl: 'https://x.example/v1',
            modelsText: ' , \n',
        })).toBe('至少填写一个模型');
        expect(validateProviderForm({
            ...EMPTY_PROVIDER_FORM,
            name: '智谱',
            baseUrl: 'https://x.example/v1',
            modelsText: 'glm-5.4',
        })).toBeNull();
    });

    it('builds the request body, falling back to the first model as default', () => {
        expect(providerInputFromForm({
            name: '  智谱 ',
            baseUrl: ' https://x.example/v1 ',
            apiKey: '  sk-key  ',
            modelsText: 'glm-5.4\nmistral-x',
            defaultModel: '',
            enabled: true,
        })).toEqual({
            name: '智谱',
            baseUrl: 'https://x.example/v1',
            apiKey: 'sk-key',
            models: ['glm-5.4', 'mistral-x'],
            defaultModel: 'glm-5.4',
            enabled: true,
        });
        // 填了不在清单里的默认模型：同样退到第一个，模型 ID 大小写敏感
        expect(providerInputFromForm({
            ...EMPTY_PROVIDER_FORM,
            name: 'x',
            baseUrl: 'https://x.example/v1',
            modelsText: 'glm-5.4',
            defaultModel: 'GLM-5.4',
        }).defaultModel).toBe('glm-5.4');
    });

    it('treats a blank key as "keep the stored one"', () => {
        const input = providerInputFromForm({ ...EMPTY_PROVIDER_FORM, apiKey: '   ' });
        expect(input.apiKey).toBeNull();
    });

    it('pre-fills the edit form without the key', () => {
        const provider: LlmProviderView = {
            key: '智谱',
            name: '智谱',
            baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
            apiKeyMasked: '••••cdef',
            hasApiKey: true,
            models: ['glm-5.4', 'glm-5.3'],
            defaultModel: 'glm-5.3',
            enabled: false,
            updatedAt: '2026-11-25T00:00:00Z',
        };
        expect(formFromProvider(provider)).toEqual({
            name: '智谱',
            baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
            apiKey: '',
            modelsText: 'glm-5.4\nglm-5.3',
            defaultModel: 'glm-5.3',
            enabled: false,
        });
    });
});
