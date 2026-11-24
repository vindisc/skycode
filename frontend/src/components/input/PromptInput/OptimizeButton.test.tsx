/**
 * OptimizeButton — 输入框工具栏上的「优化提示词」入口：
 * 打开优化面板并带上草稿；没配置优化模型时带用户去设置；空草稿不发请求。
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OptimizeButton } from './OptimizeButton';
import { useDialogStore } from '@/store/dialogStore';
import { useNotificationStore } from '@/store/notificationStore';

const api = vi.hoisted(() => ({ status: vi.fn(), optimize: vi.fn() }));

vi.mock('@/api/promptOptimizeApi', () => ({ promptOptimizeApi: api }));

const ENABLED = { enabled: true, model: 'gpt-6.1-sol', providerName: '火神', source: 'scene_binding' };
const DISABLED = { enabled: false, model: null, providerName: null, source: null };

beforeEach(() => {
    vi.clearAllMocks();
    useDialogStore.setState({ activeDialog: null, dialogData: {} });
    useNotificationStore.setState({ notifications: [] });
    api.status.mockResolvedValue(ENABLED);
});

describe('OptimizeButton', () => {
    it('opens the optimize panel with the draft and its key', async () => {
        render(<OptimizeButton draft="  帮我写个函数 " draftKey="s1" disabled={false} />);
        await waitFor(() => expect(api.status).toHaveBeenCalledTimes(1));

        fireEvent.click(screen.getByRole('button', { name: '优化提示词' }));

        expect(useDialogStore.getState()).toMatchObject({
            activeDialog: 'promptOptimize',
            dialogData: { prompt: '  帮我写个函数 ', draftKey: 's1' },
        });
    });

    it('goes straight to the scene settings when no optimization model is configured', async () => {
        api.status.mockResolvedValue(DISABLED);
        render(<OptimizeButton draft="帮我写个函数" draftKey="s1" disabled={false} />);
        await waitFor(() => expect(screen.getByRole('button', { name: '优化提示词' }).title)
            .toBe('还没有配置优化用的模型，点击去设置'));

        fireEvent.click(screen.getByRole('button', { name: '优化提示词' }));

        expect(useDialogStore.getState()).toMatchObject({
            activeDialog: 'settings',
            dialogData: { tab: 'scenes' },
        });
    });

    it('does nothing but notify on an empty draft', async () => {
        render(<OptimizeButton draft="   " draftKey="s1" disabled={false} />);
        await waitFor(() => expect(api.status).toHaveBeenCalledTimes(1));

        fireEvent.click(screen.getByRole('button', { name: '优化提示词' }));

        expect(useDialogStore.getState().activeDialog).toBeNull();
        expect(useNotificationStore.getState().notifications.map(n => n.message))
            .toContain('先写点内容，再来优化提示词');
    });

    it('still opens the panel when the status cannot be fetched', async () => {
        api.status.mockRejectedValue(new Error('offline'));
        render(<OptimizeButton draft="帮我写个函数" draftKey="s1" disabled={false} />);
        await waitFor(() => expect(api.status).toHaveBeenCalledTimes(1));

        fireEvent.click(screen.getByRole('button', { name: '优化提示词' }));

        expect(useDialogStore.getState().activeDialog).toBe('promptOptimize');
    });

    it('respects the disabled prop', () => {
        render(<OptimizeButton draft="帮我写个函数" draftKey="s1" disabled />);
        expect(screen.getByRole('button', { name: '优化提示词' })).toBeDisabled();
    });
});
