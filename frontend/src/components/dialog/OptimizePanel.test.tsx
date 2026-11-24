/**
 * OptimizePanel — 「优化提示词」结果面板：
 * 打开即请求优化；结果可改；能替换或追加到草稿；未配置时带用户去设置。
 */

import { StrictMode, type ReactElement } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/request';
import { OptimizePanel } from './OptimizePanel';
import { useDialogStore } from '@/store/dialogStore';
import { usePromptDraftStore } from '@/store/promptDraftStore';

const api = vi.hoisted(() => ({ status: vi.fn(), optimize: vi.fn() }));

vi.mock('@/api/promptOptimizeApi', () => ({ promptOptimizeApi: api }));

const ORIGINAL = '帮我写个函数';
const RESULT = {
    optimized: '请用 TypeScript 写一个函数：给定字符串数组，返回去重后的结果，并补上类型标注。',
    model: 'gpt-6.1-sol',
    providerName: '火神',
    source: 'scene_binding',
};

let onClose: ReturnType<typeof vi.fn>;

function openPanel(element?: ReactElement) {
    usePromptDraftStore.setState({
        drafts: { s1: { id: 'd1', input: ORIGINAL, attachments: [], localFiles: [], publishedLocalFiles: [] } },
    });
    useDialogStore.setState({ activeDialog: 'promptOptimize', dialogData: { prompt: ORIGINAL, draftKey: 's1' } });
    return render(element ?? <OptimizePanel onClose={onClose} />);
}

const draftText = () => usePromptDraftStore.getState().drafts.s1?.input;

beforeEach(() => {
    vi.clearAllMocks();
    onClose = vi.fn();
    api.optimize.mockResolvedValue(RESULT);
});

describe('OptimizePanel', () => {
    it('optimizes the prompt it was opened with and can replace the draft', async () => {
        openPanel();

        const output = await screen.findByLabelText('优化后的提示词');
        expect(api.optimize).toHaveBeenCalledTimes(1);
        expect(api.optimize).toHaveBeenCalledWith(ORIGINAL);
        expect(output).toHaveValue(RESULT.optimized);
        expect(screen.getByText(/由 火神 \/ gpt-6.1-sol 生成/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: '替换草稿' }));

        expect(draftText()).toBe(RESULT.optimized);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('can append below the original instead of replacing it', async () => {
        openPanel();
        await screen.findByLabelText('优化后的提示词');

        fireEvent.click(screen.getByRole('button', { name: '追加到草稿' }));

        expect(draftText()).toBe(`${ORIGINAL}\n${RESULT.optimized}`);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('applies the edited text, not the raw model output', async () => {
        openPanel();
        const output = await screen.findByLabelText('优化后的提示词');

        fireEvent.change(output, { target: { value: '  我改过的版本  ' } });
        fireEvent.click(screen.getByRole('button', { name: '替换草稿' }));

        expect(draftText()).toBe('我改过的版本');
    });

    it('does not apply an empty result', async () => {
        api.optimize.mockResolvedValue({ ...RESULT, optimized: '结果' });
        openPanel();
        const output = await screen.findByLabelText('优化后的提示词');

        fireEvent.change(output, { target: { value: '   ' } });

        expect(screen.getByRole('button', { name: '替换草稿' })).toBeDisabled();
        expect(screen.getByRole('button', { name: '追加到草稿' })).toBeDisabled();
        expect(draftText()).toBe(ORIGINAL);
    });

    it('sends exactly one request even when effects are re-run', async () => {
        openPanel(<StrictMode><OptimizePanel onClose={onClose} /></StrictMode>);

        expect(await screen.findByLabelText('优化后的提示词')).toHaveValue(RESULT.optimized);
        expect(api.optimize).toHaveBeenCalledTimes(1);
    });

    it('shows the failure and retries on request', async () => {
        api.optimize.mockRejectedValueOnce(new ApiError('LLM_API_ERROR', '优化模型返回 HTTP 500', 503));
        openPanel();

        expect(await screen.findByRole('alert')).toHaveTextContent('优化模型返回 HTTP 500');

        fireEvent.click(screen.getByRole('button', { name: '重试' }));

        expect(await screen.findByLabelText('优化后的提示词')).toHaveValue(RESULT.optimized);
        expect(api.optimize).toHaveBeenCalledTimes(2);
    });

    it('offers a way out when no optimization model is configured', async () => {
        api.optimize.mockRejectedValue(new ApiError('PROMPT_OPTIMIZE_DISABLED', '还没有配置优化提示词用的模型', 400));
        openPanel();

        fireEvent.click(await screen.findByRole('button', { name: '去设置' }));

        await waitFor(() => expect(useDialogStore.getState().activeDialog).toBe('settings'));
        expect(useDialogStore.getState().dialogData).toEqual({ tab: 'scenes' });
        expect(api.optimize).toHaveBeenCalledTimes(1);
    });
});
