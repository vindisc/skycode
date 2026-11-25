/**
 * 输入框工具栏上的「优化提示词」（桌面）：把当前草稿交给一个独立的小模型改写。
 * 优化用的模型由设置页的「场景分派」决定；还没配置时，点击直接带用户去那里。
 * 点击逻辑在 useOptimizePrompt 里，和手机端「更多操作」里的同一行共用。
 */

import { Wand2 } from 'lucide-react';
import { useOptimizePrompt } from './useOptimizePrompt';

interface OptimizeButtonProps {
    /** 当前草稿，以及它在 promptDraftStore 里的键（优化结果要写回的地方） */
    draft: string;
    draftKey: string;
    disabled: boolean;
}

export function OptimizeButton({ draft, draftKey, disabled }: OptimizeButtonProps) {
    const { unconfigured, handleClick } = useOptimizePrompt(draft, draftKey);

    return (
        <button
            type="button"
            aria-label="优化提示词"
            title={unconfigured
                ? '还没有配置优化用的模型，点击去设置'
                : '把这段提示词改写得更清晰'}
            disabled={disabled}
            onClick={handleClick}
            className="panel-control flex h-10 w-10 items-center justify-center shrink-0 rounded-[10px] text-t2 transition-interactive duration-fast hover:bg-hover2 hover:text-t1 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent2-ring disabled:opacity-50"
        >
            <Wand2 size={18} aria-hidden="true" />
        </button>
    );
}

export default OptimizeButton;
