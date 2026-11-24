/**
 * LlmProvidersSettings — 设置页「模型服务商」：
 * 列表只展示打码后的密钥与注册情况；保存、删除之后刷新服务商列表和模型列表。
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/request';
import type { LlmProviderListResponse, LlmProviderResponse, LlmProviderView, ProviderRouting } from '@/api/settingsApi';
import { useNotificationStore } from '@/store/notificationStore';
import { LlmProvidersSettings } from './LlmProvidersSettings';

const api = vi.hoisted(() => ({
    listProviders: vi.fn(),
    createProvider: vi.fn(),
    updateProvider: vi.fn(),
    deleteProvider: vi.fn(),
    reloadProviders: vi.fn(),
    testProvider: vi.fn(),
    listScenes: vi.fn(),
    saveSceneBinding: vi.fn(),
    clearSceneBinding: vi.fn(),
}));
const stores = vi.hoisted(() => ({ fetchModels: vi.fn() }));

vi.mock('@/api/settingsApi', () => ({ settingsApi: api }));
vi.mock('@/store/modelStore', () => ({ useModelStore: { getState: () => ({ fetchModels: stores.fetchModels }) } }));

const provider = (patch: Partial<LlmProviderView> = {}): LlmProviderView => ({
    key: '智谱',
    name: '智谱',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKeyMasked: '••••cdef',
    hasApiKey: true,
    models: ['glm-5.4', 'gpt-6.2-sol'],
    defaultModel: 'glm-5.4',
    enabled: true,
    updatedAt: '2026-11-25T00:00:00Z',
    ...patch,
});

const routing = (patch: Partial<ProviderRouting> = {}): ProviderRouting => ({
    providerKey: '智谱',
    providerName: '智谱',
    registeredAs: 'db:智谱',
    registeredModels: ['glm-5.4'],
    defaultModel: 'glm-5.4',
    skippedModels: [{ model: 'gpt-6.2-sol', reason: '已由配置里的服务商「huoshen」提供' }],
    skipReason: null,
    needsAttention: false,
    ...patch,
});

/** 没注册的条目：后端省略值为 null 的字段，响应里没有 registeredAs / defaultModel */
const unregisteredRouting = (patch: Partial<ProviderRouting> = {}): ProviderRouting => ({
    providerKey: '智谱',
    providerName: '智谱',
    registeredModels: [],
    skippedModels: [{ model: 'glm-5.4', reason: '已由配置里的服务商「zhipu」提供' }],
    skipReason: '没有可注册的模型',
    needsAttention: true,
    ...patch,
});

const listResponse = (patch: Partial<LlmProviderListResponse> = {}): LlmProviderListResponse => ({
    providers: [provider()],
    apiKeyStorageReady: true,
    routing: [routing()],
    ...patch,
});

beforeEach(() => {
    vi.clearAllMocks();
    api.listProviders.mockResolvedValue(listResponse());
    stores.fetchModels.mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('LlmProvidersSettings', () => {
    it('lists providers with masked keys, routing status and the reason for every skipped model', async () => {
        render(<LlmProvidersSettings />);

        expect(await screen.findByText('智谱')).toBeInTheDocument();
        expect(screen.getByText('密钥 ••••cdef')).toBeInTheDocument();
        expect(screen.getByText('已注册')).toBeInTheDocument();
        expect(screen.getByText('已注册为 db:智谱，默认模型 glm-5.4')).toBeInTheDocument();
        expect(screen.getByText(/— 已由配置里的服务商「huoshen」提供/)).toBeInTheDocument();
        // 被跳过的模型，鼠标悬停能看到原因
        expect(within(screen.getByLabelText('智谱 的模型')).getByText('gpt-6.2-sol'))
            .toHaveAttribute('title', '已由配置里的服务商「huoshen」提供');
    });

    it('reports an entry that the API returns without registeredAs as not registered', async () => {
        api.listProviders.mockResolvedValue(listResponse({ routing: [unregisteredRouting()] }));
        render(<LlmProvidersSettings />);
        const row = await screen.findByTestId('llm-provider-row-智谱');

        // 回归：registeredAs 缺失时曾因为 `!== null` 被误判成"已注册"
        expect(within(row).getByText('未注册')).toBeInTheDocument();
        expect(within(row).getByText('未注册：没有可注册的模型')).toBeInTheDocument();
        expect(screen.queryByText('已注册')).not.toBeInTheDocument();
        expect(screen.queryByText(/已注册为 db:/)).not.toBeInTheDocument();
    });

    it('warns with the right wording when a saved provider did not get registered', async () => {
        api.updateProvider.mockResolvedValue({ provider: provider(), routing: [unregisteredRouting()] });
        render(<LlmProvidersSettings />);
        await screen.findByText('智谱');

        fireEvent.click(screen.getByRole('button', { name: '编辑' }));
        await screen.findByTestId('llm-provider-form');
        fireEvent.click(screen.getByRole('button', { name: '保存' }));

        await waitFor(() => expect(useNotificationStore.getState().notifications.map(n => n.message))
            .toContain('「智谱」没有注册进运行时：没有可注册的模型'));
    });

    it('shows a load failure with a retry that works', async () => {
        api.listProviders.mockRejectedValueOnce(new Error('服务商列表加载失败'));
        render(<LlmProvidersSettings />);

        expect(await screen.findByRole('alert')).toHaveTextContent('服务商列表加载失败');
        fireEvent.click(screen.getByRole('button', { name: '重试' }));

        expect(await screen.findByText('智谱')).toBeInTheDocument();
        expect(api.listProviders).toHaveBeenCalledTimes(2);
    });

    it('creates a provider from the form and refreshes the model list', async () => {
        api.createProvider.mockResolvedValue({
            provider: provider({ key: 'relay', name: '中转站' }),
            routing: [routing({ providerKey: 'relay', providerName: '中转站', registeredAs: 'db:relay' })],
        } satisfies LlmProviderResponse);
        render(<LlmProvidersSettings />);
        await screen.findByText('智谱');

        fireEvent.click(screen.getByRole('button', { name: '添加服务商' }));
        fireEvent.change(screen.getByLabelText('服务商名称'), { target: { value: ' 中转站 ' } });
        fireEvent.change(screen.getByLabelText('接口地址'), { target: { value: 'https://relay.example/v1' } });
        fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-new-key' } });
        // 每行一个、逗号分隔、重复项都按后端的归一规则处理
        fireEvent.change(screen.getByLabelText('模型清单'), { target: { value: 'glm-5.4\nmistral-x, glm-5.4' } });
        fireEvent.click(screen.getByRole('button', { name: '保存' }));

        await waitFor(() => expect(api.createProvider).toHaveBeenCalledTimes(1));
        expect(api.createProvider).toHaveBeenCalledWith({
            name: '中转站',
            baseUrl: 'https://relay.example/v1',
            apiKey: 'sk-new-key',
            models: ['glm-5.4', 'mistral-x'],
            defaultModel: 'glm-5.4',
            enabled: true,
        });
        // 保存后重拉服务商列表，并让模型选择器看到新模型
        await waitFor(() => expect(stores.fetchModels).toHaveBeenCalledTimes(1));
        expect(api.listProviders).toHaveBeenCalledTimes(2);
        await waitFor(() => expect(screen.queryByTestId('llm-provider-form')).not.toBeInTheDocument());
    });

    it('blocks an incomplete form locally instead of calling the backend', async () => {
        render(<LlmProvidersSettings />);
        await screen.findByText('智谱');

        fireEvent.click(screen.getByRole('button', { name: '添加服务商' }));
        fireEvent.click(screen.getByRole('button', { name: '保存' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('请填写服务商名称');
        expect(api.createProvider).not.toHaveBeenCalled();
    });

    it('keeps the form open and shows the backend reason when saving is rejected', async () => {
        api.createProvider.mockRejectedValue(new ApiError('ENCRYPTION_KEY_REQUIRED', '当前运行环境没有稳定的加密密钥', 400));
        render(<LlmProvidersSettings />);
        await screen.findByText('智谱');

        fireEvent.click(screen.getByRole('button', { name: '添加服务商' }));
        fireEvent.change(screen.getByLabelText('服务商名称'), { target: { value: 'x' } });
        fireEvent.change(screen.getByLabelText('接口地址'), { target: { value: 'https://x.example/v1' } });
        fireEvent.change(screen.getByLabelText('模型清单'), { target: { value: 'glm-5.4' } });
        fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-key' } });
        fireEvent.click(screen.getByRole('button', { name: '保存' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('当前运行环境没有稳定的加密密钥');
        expect(screen.getByTestId('llm-provider-form')).toBeInTheDocument();
        expect(screen.getByLabelText('服务商名称')).toHaveValue('x');
        expect(stores.fetchModels).not.toHaveBeenCalled();
    });

    it('disables the key field and explains why when the backend has no stable encryption key', async () => {
        api.listProviders.mockResolvedValue(listResponse({ apiKeyStorageReady: false }));
        render(<LlmProvidersSettings />);
        await screen.findByText('智谱');

        fireEvent.click(screen.getByRole('button', { name: '添加服务商' }));

        expect(await screen.findByLabelText('API Key')).toBeDisabled();
        expect(screen.getAllByText(/ZHIKU_ENCRYPTION_KEY/).length).toBeGreaterThan(0);
    });

    it('edits without re-entering the key and with a new default model', async () => {
        api.updateProvider.mockResolvedValue({
            provider: provider({ defaultModel: 'gpt-6.2-sol' }),
            routing: [routing()],
        } satisfies LlmProviderResponse);
        render(<LlmProvidersSettings />);
        await screen.findByText('智谱');

        fireEvent.click(screen.getByRole('button', { name: '编辑' }));
        expect(await screen.findByLabelText('API Key')).toHaveAttribute('placeholder', '留空则保持不变（当前 ••••cdef）');
        expect(screen.getByLabelText('模型清单')).toHaveValue('glm-5.4\ngpt-6.2-sol');
        fireEvent.change(screen.getByLabelText('默认模型'), { target: { value: 'gpt-6.2-sol' } });
        fireEvent.click(screen.getByRole('button', { name: '保存' }));

        await waitFor(() => expect(api.updateProvider).toHaveBeenCalledTimes(1));
        expect(api.updateProvider).toHaveBeenCalledWith('智谱', {
            name: '智谱',
            baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
            apiKey: null,
            models: ['glm-5.4', 'gpt-6.2-sol'],
            defaultModel: 'gpt-6.2-sol',
            enabled: true,
        });
    });

    it('toggles enabled without touching the stored key', async () => {
        api.updateProvider.mockResolvedValue({ provider: provider({ enabled: false }), routing: [routing()] });
        render(<LlmProvidersSettings />);
        await screen.findByText('智谱');

        fireEvent.click(screen.getByRole('switch', { name: '启用 智谱' }));

        await waitFor(() => expect(api.updateProvider).toHaveBeenCalledWith('智谱', expect.objectContaining({
            apiKey: null,
            enabled: false,
            models: ['glm-5.4', 'gpt-6.2-sol'],
        })));
    });

    it('asks before deleting and does nothing when the user backs out', async () => {
        api.deleteProvider.mockResolvedValue(undefined);
        api.listProviders
            .mockResolvedValueOnce(listResponse())
            .mockResolvedValue(listResponse({ providers: [], routing: [] }));
        (window.confirm as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
        render(<LlmProvidersSettings />);
        await screen.findByText('智谱');

        fireEvent.click(screen.getByRole('button', { name: '删除' }));
        expect(window.confirm).toHaveBeenCalledWith('删除服务商「智谱」？池里它提供的模型将不能再使用。');
        expect(api.deleteProvider).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: '删除' }));
        await waitFor(() => expect(api.deleteProvider).toHaveBeenCalledWith('智谱'));
        expect(await screen.findByText('还没有添加服务商')).toBeInTheDocument();
    });

    it('shows the connectivity test result inline, failures included', async () => {
        api.testProvider.mockResolvedValue({ ok: true, model: 'glm-5.4', latencyMs: 42, error: null });
        render(<LlmProvidersSettings />);
        await screen.findByText('智谱');

        fireEvent.click(screen.getByRole('button', { name: '测试' }));
        expect(await screen.findByText('连通')).toBeInTheDocument();
        expect(screen.getByText('glm-5.4 · 42 ms')).toBeInTheDocument();

        api.testProvider.mockRejectedValue(new ApiError('PROVIDER_NOT_FOUND', '服务商不存在：智谱', 404));
        fireEvent.click(screen.getByRole('button', { name: '测试' }));
        expect(await screen.findByText('连接失败')).toBeInTheDocument();
        expect(screen.getByText('服务商不存在：智谱')).toBeInTheDocument();
        // 测试不改动任何东西，不该触发列表刷新
        expect(api.listProviders).toHaveBeenCalledTimes(1);
        expect(stores.fetchModels).not.toHaveBeenCalled();
    });

    it('reloads from the backend', async () => {
        // 第一次加载只有「智谱」；重新加载后多出一个在别处添加的服务商
        const afterReload = listResponse({ providers: [provider(), provider({ key: 'manual', name: '手动添加' })] });
        api.listProviders.mockResolvedValueOnce(listResponse()).mockResolvedValue(afterReload);
        api.reloadProviders.mockResolvedValue(afterReload);
        render(<LlmProvidersSettings />);
        await screen.findByText('智谱');

        fireEvent.click(screen.getByRole('button', { name: '重新加载' }));

        expect(await screen.findByText('手动添加')).toBeInTheDocument();
        expect(api.reloadProviders).toHaveBeenCalledTimes(1);
        expect(api.listProviders).toHaveBeenCalledTimes(2);
    });
});
