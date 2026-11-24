/**
 * 输入框工具栏上的「优化提示词」：把当前草稿交给一个独立的小模型改写。
 * 优化用的模型由设置页的「场景分派」决定；还没配置时，点击直接带用户去那里。
 */

import { useEffect, useState } from 'react';
import { Wand2 } from 'lucide-react';
import { promptOptimizeApi, type PromptOptimizeStatus } from '@/api/promptOptimizeApi';
import { useDialogStore } from '@/store/dialogStore';
import { useNotificationStore } from '@/store/notificationStore';

interface OptimizeButtonProps {
    /** 当前草稿，以及它在 promptDraftStore 里的键（优化结果要写回的地方） */
    draft: string;
    draftKey: string;
    disabled: boolean;
}

export function OptimizeButton({ draft, draftKey, disabled }: OptimizeButtonProps) {
    const openDialog = useDialogStore(s => s.openDialog);
    const addNotification = useNotificationStore(s => s.addNotification);
    const [status, setStatus] = useState<PromptOptimizeStatus | null>(null);

    useEffect(() => {
        let cancelled = false;
        promptOptimizeApi.status()
            .then(result => { if (!cancelled) setStatus(result); })
            // 拿不到状态时不拦着用户：照常打开面板，由面板给出确切的结论
            .catch(() => { /* 面板会重新判断 */ });
        return () => { cancelled = true; };
    }, []);

    const unconfigured = status !== null && !status.enabled;

    const handleClick = () => {
        if (!draft.trim()) {
            addNotification({ key: 'prompt-optimize-empty', level: 'info', message: '先写点内容，再来优化提示词' });
            return;
        }
        if (unconfigured) {
            openDialog('settings', { tab: 'scenes' });
            return;
        }
        openDialog('promptOptimize', { prompt: draft, draftKey });
    };

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
