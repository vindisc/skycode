import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * useAnchoredPopover — 把弹出面板贴着触发按钮摆放（优先在下方，下方放不下就翻到上方），
 * 跟随窗口缩放和滚动重新定位，始终留在视口内。面板本身的渲染由调用方负责。
 */
export function useAnchoredPopover(
    open: boolean,
    trigger: RefObject<HTMLElement | null>,
    panel: RefObject<HTMLElement | null>,
    { width = 320, gap = 8, viewportMargin = 8 }: { width?: number; gap?: number; viewportMargin?: number } = {},
) {
    const [position, setPosition] = useState({ left: viewportMargin, top: viewportMargin, maxHeight: 400 });

    useLayoutEffect(() => {
        if (!open) return;
        const place = () => {
            const rect = trigger.current?.getBoundingClientRect();
            if (!rect) return;
            const available = window.innerHeight - viewportMargin * 2;
            const height = Math.min(panel.current?.scrollHeight ?? 400, available);
            const top = rect.top >= height + gap
                ? rect.top - height - gap
                : Math.min(rect.bottom + gap, window.innerHeight - viewportMargin - height);
            const maxLeft = window.innerWidth - width - viewportMargin;
            setPosition({
                left: Math.max(viewportMargin, Math.min(rect.left, maxLeft)),
                top: Math.max(viewportMargin, top),
                maxHeight: available,
            });
        };
        place();
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
        return () => {
            window.removeEventListener('resize', place);
            window.removeEventListener('scroll', place, true);
        };
    }, [open, trigger, panel, width, gap, viewportMargin]);

    return position;
}
