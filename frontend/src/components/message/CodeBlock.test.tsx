import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useConfigStore } from '@/store/configStore';
import type { ThemeConfig } from '@/types';
import CodeBlock from './CodeBlock';

const originalTheme = useConfigStore.getState().theme;
const longCode = Array.from({ length: 100 }, (_, i) => `const value${i} = ${i};`).join('\n');

function setMode(mode: ThemeConfig['mode']) {
    act(() => { useConfigStore.getState().setTheme({ mode }); });
}

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    act(() => { useConfigStore.setState({ theme: originalTheme }); });
});

describe('CodeBlock 基础主题配色与交互回归', () => {
    it.each(['light', 'dark'] as const)('%s：标题、控件与长代码使用基础色域，不带内联局部色域', mode => {
        setMode(mode);
        const { container } = render(
            <div className="user-message"><div className="bg-surfacev2">
                <CodeBlock code={longCode} fileName="source.ts" />
            </div></div>,
        );
        const block = container.querySelector<HTMLElement>('.code-block')!;
        expect(block.style.color).toBe('');
        expect(block.style.getPropertyValue('--code-ink-text')).toBe('');
        expect(block.style.getPropertyValue('--code-ink-muted')).toBe('');
        expect(screen.getByText('source.ts')).toHaveClass('text-t3');
        expect(screen.getByRole('button', { name: 'Copy code' })).toHaveClass('text-t4', 'hover:text-t1');
        const pre = container.querySelector('pre')!;
        expect(pre).toHaveClass('text-t1');
        expect(pre.textContent).toBe(longCode);
        expect(container.querySelector('.token')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Enable highlighting' }));
        expect(screen.queryByRole('button', { name: 'Enable highlighting' })).toBeNull();
        expect(container.querySelector('.token')).not.toBeNull();
    });

    it.each(['light', 'dark'] as const)('%s：复制保留完整文本及绿色成功反馈', async mode => {
        vi.useFakeTimers();
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { clipboard: { writeText } });
        setMode(mode);
        render(<CodeBlock code={longCode} />);
        const copyButton = screen.getByRole('button', { name: 'Copy code' });
        await act(async () => { fireEvent.click(copyButton); });
        expect(writeText).toHaveBeenCalledWith(longCode);
        expect(copyButton).toHaveAttribute('title', '已复制');
        // 成功反馈沿用语义色 text-ok，无内联覆盖色
        const check = copyButton.querySelector('.lucide-check')!;
        expect(check).toHaveClass('text-ok');
        expect(check).not.toHaveAttribute('style');
        act(() => { vi.advanceTimersByTime(2000); });
        expect(copyButton).toHaveAttribute('title', '复制');
    });
});
