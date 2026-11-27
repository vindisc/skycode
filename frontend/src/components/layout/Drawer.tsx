/**
 * Drawer — 移动端抽屉覆盖层组件
 * SPEC: §8.8.2 / §7.5 / §8.5
 *
 * 移动端 Sidebar 替代方案：从左侧滑入的 overlay 抽屉。
 * 支持背景点击关闭、Escape 关闭、过渡动画。
 * §7.5 容器规范：宽 280px / max 82%，rounded-r-panel + shadow-e4，
 * overlay2 遮罩，滑入时长走 §5.1 时长表 Drawer 行（duration-sheet 320ms）。
 */

import { useEffect, useCallback, useRef, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { isTopModal, lockModalScroll, unlockModalScroll } from '@/hooks/useModalBehavior';

interface DrawerProps {
    open: boolean;
    onClose: () => void;
    children: ReactNode;
    /** 抽屉宽度, 默认 280px */
    width?: number;
    /** 从哪一侧滑入, 默认 left */
    side?: 'left' | 'right';
}

export function Drawer({
    open,
    onClose,
    children,
    width = 280,
    side = 'left',
}: DrawerProps) {
    const panelRef = useRef<HTMLDivElement>(null);
    // Escape 只在抽屉是置顶层时生效——权限弹窗压在抽屉上时，Esc 不应把底下的抽屉一起关掉
    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        if (e.key === 'Escape' && isTopModal(panelRef.current)) {
            onClose();
        }
    }, [onClose]);

    useEffect(() => {
        if (open) {
            document.addEventListener('keydown', handleKeyDown);
            // 用计数锁而不是直接改 body.overflow：并发打开的权限/澄清弹窗
            // 也持锁，抽屉关闭时不能把别人的锁清掉
            lockModalScroll();
            return () => {
                document.removeEventListener('keydown', handleKeyDown);
                unlockModalScroll();
            };
        }
    }, [open, handleKeyDown]);

    return createPortal(
        <>
            {/* Overlay 背景 — overlay2 令牌 */}
            <div
                className={`fixed inset-0 z-40 bg-overlay2 transition-opacity duration-sheet ease-soft
                    ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                onClick={onClose}
                aria-hidden="true"
            />

            {/* 抽屉面板 — 宽 280px / max 82%，rounded-r-panel + shadow-e4 */}
            <div
                ref={panelRef}
                role="dialog"
                aria-modal={open ? true : undefined}
                aria-hidden={!open}
                {...(!open ? { inert: '' } : {})}
                aria-label="侧边栏"
                className={`fixed top-0 ${side === 'left' ? 'left-0' : 'right-0'} z-50
                    h-full bg-surfacev2 shadow-e4 overflow-hidden
                    ${side === 'left' ? 'rounded-r-panel' : 'rounded-l-panel'}
                    transition-transform duration-sheet ease-soft
                    ${open
                        ? 'translate-x-0'
                        : side === 'left'
                            ? '-translate-x-full'
                            : 'translate-x-full'
                    }`}
                style={{ width: `${width}px`, maxWidth: '82%' }}
            >
                <div className="h-full flex flex-col overscroll-contain">
                    {children}
                </div>
            </div>
        </>,
        document.body,
    );
}
