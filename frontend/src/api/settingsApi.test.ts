import { afterEach, describe, expect, it, vi } from 'vitest';
import { settingsApi } from './settingsApi';

/**
 * 只测「返回形状需要转换」的那个接口：后端回的是 { models: [...] }，
 * 组件那边的测试都把 discoverModels mock 成直接返回数组，测不到这一层。
 */
describe('settingsApi.discoverModels', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('unwraps the model list from the backend response and sends the form input as the body', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ models: ['codex-auto-review', 'gpt-6.2-sol'] }),
        });
        vi.stubGlobal('fetch', fetchMock);

        const models = await settingsApi.discoverModels({ baseUrl: 'https://relay.example/v1', apiKey: 'sk-k', providerKey: null });

        expect(models).toEqual(['codex-auto-review', 'gpt-6.2-sol']);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('/api/settings/llm-providers/discover');
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toEqual({ baseUrl: 'https://relay.example/v1', apiKey: 'sk-k', providerKey: null });
    });

    it('treats a response without a model list as an empty list instead of blowing up', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }));

        await expect(settingsApi.discoverModels({ baseUrl: 'https://relay.example/v1' })).resolves.toEqual([]);
    });
});
