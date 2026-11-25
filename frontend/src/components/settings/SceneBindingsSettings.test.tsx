/**
 * SceneBindingsSettings — 设置页「场景分派」：
 * 场景与可选服务商都来自接口；图片理解兜底只能选收图的模型；保存的是池里的实际存储键。
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SceneView, ScenesResponse } from '@/api/settingsApi';
import { SceneBindingsSettings } from './SceneBindingsSettings';

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

vi.mock('@/api/settingsApi', () => ({ settingsApi: api }));

const ZHIPU = {
    source: 'pool' as const,
    key: '智谱',
    name: '智谱',
    models: [
        { id: 'glm-5.3', supportsImages: false },
        { id: 'glm-5.4', supportsImages: true },
    ],
};
const FIRE = {
    source: 'pool' as const,
    key: 'fire',
    name: '火神',
    models: [{ id: 'gpt-6.1-sol', supportsImages: true }],
};

// 未绑定的场景：后端省略值为 null 的字段，响应里没有 binding / providerName
const promptScene = (patch: Partial<SceneView> = {}): SceneView => ({
    key: 'prompt_optimize',
    label: '提示词优化',
    description: '输入框里「优化提示词」功能使用的模型。',
    active: false,
    ...patch,
});
const visionScene = (patch: Partial<SceneView> = {}): SceneView => ({
    key: 'vision_fallback',
    label: '图片理解兜底',
    description: '当前模型不支持图片时使用的模型。',
    binding: { source: 'pool', providerKey: '智谱', modelId: 'glm-5.4' },
    providerName: '智谱',
    active: true,
    ...patch,
});
const response = (patch: Partial<ScenesResponse> = {}): ScenesResponse => ({
    scenes: [promptScene(), visionScene()],
    providers: [ZHIPU, FIRE],
    ...patch,
});

beforeEach(() => {
    vi.clearAllMocks();
    api.listScenes.mockResolvedValue(response());
    api.saveSceneBinding.mockResolvedValue({ binding: { providerKey: 'fire', modelId: 'gpt-6.1-sol' } });
    api.clearSceneBinding.mockResolvedValue(undefined);
});

describe('SceneBindingsSettings', () => {
    it('lists the scenes from the API with their binding status', async () => {
        render(<SceneBindingsSettings />);

        expect(await screen.findByText('提示词优化')).toBeInTheDocument();
        expect(screen.getByText('图片理解兜底')).toBeInTheDocument();
        expect(screen.getByText('使用默认配置')).toBeInTheDocument();
        expect(screen.getByText('已生效')).toBeInTheDocument();
        expect(screen.getByText('当前：智谱 / glm-5.4')).toBeInTheDocument();
        expect(api.listScenes).toHaveBeenCalledTimes(1);
    });

    it('only offers image-capable models for the vision fallback', async () => {
        render(<SceneBindingsSettings />);
        await screen.findByText('图片理解兜底');

        const promptCard = screen.getByTestId('scene-card-prompt_optimize');
        const visionCard = screen.getByTestId('scene-card-vision_fallback');
        expect(Array.from(promptCard.querySelectorAll('select')[1].options).map(o => o.value))
            .toEqual(['glm-5.3', 'glm-5.4']);
        expect(Array.from(visionCard.querySelectorAll('select')[1].options).map(o => o.value))
            .toEqual(['glm-5.4']);
    });

    it('saves the real storage key and the chosen model', async () => {
        render(<SceneBindingsSettings />);
        await screen.findByText('图片理解兜底');

        const visionCard = screen.getByTestId('scene-card-vision_fallback');
        // 换服务商后，模型回落到该服务商下第一个可选的模型
        fireEvent.change(visionCard.querySelectorAll('select')[0], { target: { value: 'pool\u0000fire' } });
        expect((visionCard.querySelectorAll('select')[1] as HTMLSelectElement).value).toBe('gpt-6.1-sol');
        fireEvent.click(screen.getAllByRole('button', { name: '保存' })[1]);

        await waitFor(() => expect(api.saveSceneBinding).toHaveBeenCalledWith('vision_fallback', 'pool', 'fire', 'gpt-6.1-sol'));
        await waitFor(() => expect(api.listScenes).toHaveBeenCalledTimes(2));
    });

    it('does nothing to save when nothing changed', async () => {
        render(<SceneBindingsSettings />);
        await screen.findByText('图片理解兜底');

        const buttons = screen.getAllByRole('button', { name: '保存' });
        // 已生效的绑定：没改动，保存按钮禁用；未绑定的场景：默认选中第一项，与"未绑定"不同，可以保存
        expect(buttons[0]).toBeEnabled();
        expect(buttons[1]).toBeDisabled();
        expect(api.saveSceneBinding).not.toHaveBeenCalled();
    });

    it('clears an existing binding', async () => {
        render(<SceneBindingsSettings />);
        await screen.findByText('图片理解兜底');

        fireEvent.click(screen.getAllByRole('button', { name: '清除' })[1]);

        await waitFor(() => expect(api.clearSceneBinding).toHaveBeenCalledWith('vision_fallback'));
        // 没有绑定的场景不能清除
        expect(screen.getAllByRole('button', { name: '清除' })[0]).toBeDisabled();
    });

    it('explains when a binding has gone stale', async () => {
        api.listScenes.mockResolvedValue(response({
            scenes: [promptScene(), visionScene({ active: false })],
        }));
        render(<SceneBindingsSettings />);

        expect(await screen.findByText('已失效')).toBeInTheDocument();
        expect(screen.getByText(/这条分派已失效/)).toBeInTheDocument();
    });

    it('lets a stale binding be cleared even when no provider is left', async () => {
        // 服务商被删之后，绑定还在但已失效；此时没有可选服务商，操作区不渲染，清除入口不能跟着消失
        api.listScenes.mockResolvedValue(response({
            scenes: [promptScene(), visionScene({ active: false })],
            providers: [],
        }));
        render(<SceneBindingsSettings />);
        await screen.findByText('已失效');

        fireEvent.click(screen.getByRole('button', { name: '清除这条分派' }));

        await waitFor(() => expect(api.clearSceneBinding).toHaveBeenCalledWith('vision_fallback'));
        // 没有绑定的场景不出这个按钮
        expect(within(screen.getByTestId('scene-card-prompt_optimize')).queryByRole('button', { name: '清除这条分派' }))
            .not.toBeInTheDocument();
    });

    it('shows the backend reason when saving is rejected', async () => {
        api.saveSceneBinding.mockRejectedValue(new Error('模型 glm-5.3 不支持图片输入'));
        render(<SceneBindingsSettings />);
        await screen.findByText('图片理解兜底');

        fireEvent.click(screen.getAllByRole('button', { name: '保存' })[0]);

        expect(await screen.findByRole('alert')).toHaveTextContent('模型 glm-5.3 不支持图片输入');
    });

    it('points to the provider pool when no provider is enabled', async () => {
        const onGoToProviders = vi.fn();
        api.listScenes.mockResolvedValue(response({ providers: [] }));
        render(<SceneBindingsSettings onGoToProviders={onGoToProviders} />);

        fireEvent.click(await screen.findByRole('button', { name: '去添加' }));

        expect(onGoToProviders).toHaveBeenCalledTimes(1);
        expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    });

    it('shows a load failure with a retry', async () => {
        api.listScenes.mockRejectedValueOnce(new Error('场景列表加载失败'));
        render(<SceneBindingsSettings />);

        expect(await screen.findByRole('alert')).toHaveTextContent('场景列表加载失败');
        fireEvent.click(screen.getByRole('button', { name: '重试' }));
        expect(await screen.findByText('提示词优化')).toBeInTheDocument();
    });

    it('offers providers from the config file and from the settings page in separate groups', async () => {
        api.listScenes.mockResolvedValue(response({
            providers: [
                { source: 'configured', key: 'huoshenai', name: 'HuoshenAI 中转站', models: [{ id: 'gpt-6.1-sol', supportsImages: true }] },
                FIRE,
            ],
            scenes: [promptScene()],
        }));
        render(<SceneBindingsSettings />);
        await screen.findByText('提示词优化');

        const card = screen.getByTestId('scene-card-prompt_optimize');
        const groups = Array.from(card.querySelectorAll('optgroup'));
        expect(groups.map(group => group.label)).toEqual(['配置里的服务商', '设置页里添加的']);

        fireEvent.change(card.querySelectorAll('select')[0], { target: { value: 'configured\u0000huoshenai' } });
        fireEvent.click(within(card).getByRole('button', { name: '保存' }));

        await waitFor(() => expect(api.saveSceneBinding)
            .toHaveBeenCalledWith('prompt_optimize', 'configured', 'huoshenai', 'gpt-6.1-sol'));
    });

    it('a binding that points at a configured provider shows which one', async () => {
        api.listScenes.mockResolvedValue(response({
            providers: [{ source: 'configured', key: 'zhipu', name: '智谱', models: [{ id: 'glm-5.4', supportsImages: true }] }],
            scenes: [promptScene(), visionScene({ binding: { source: 'configured', providerKey: 'zhipu', modelId: 'glm-5.4' } })],
        }));
        render(<SceneBindingsSettings />);

        expect(await screen.findByText('当前：智谱 / glm-5.4')).toBeInTheDocument();
        expect(screen.getByText('已生效')).toBeInTheDocument();
        fireEvent.click(within(screen.getByTestId('scene-card-vision_fallback')).getByRole('button', { name: '清除' }));
        await waitFor(() => expect(api.clearSceneBinding).toHaveBeenCalledWith('vision_fallback'));
    });
});
