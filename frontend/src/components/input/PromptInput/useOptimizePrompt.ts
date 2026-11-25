/**
 * 「优化提示词」入口共用的行为。
 * 桌面是输入框工具栏上的图标按钮（OptimizeButton）；
 * 手机上那一排已经排满，入口放在「更多操作」面板里（MobileComposerNavigation）。
 */

import { useCallback, useEffect, useState } from 'react';
import { promptOptimizeApi, type PromptOptimizeStatus } from '@/api/promptOptimizeApi';
import { useDialogStore } from '@/store/dialogStore';
import { useNotificationStore } from '@/store/notificationStore';

export function useOptimizePrompt(draft: string, draftKey: string) {
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

    const handleClick = useCallback(() => {
        // 没配置时无论草稿是否为空，去设置才是有用的动作——入口上的提示也是这么写的
        if (unconfigured) {
            openDialog('settings', { tab: 'scenes' });
            return;
        }
        if (!draft.trim()) {
            addNotification({ key: 'prompt-optimize-empty', level: 'info', message: '先写点内容，再来优化提示词' });
            return;
        }
        openDialog('promptOptimize', { prompt: draft, draftKey });
    }, [draft, draftKey, unconfigured, openDialog, addNotification]);

    return { unconfigured, handleClick };
}
