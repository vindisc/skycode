import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Shield } from 'lucide-react';
import { PERMISSION_MODES, type PermissionMode } from '@/types';
import { getPermissionModeDescription, getPermissionModeLabel } from '@/components/layout/StatusBar';
import { useModalBehavior } from '@/hooks/useModalBehavior';
import { useAnchoredPopover } from '@/hooks/useAnchoredPopover';
import { QUIET_CHEVRON_CLASS, QUIET_SWITCH_CLASS } from './switchAppearance';

/** 权限 chip 的胶囊外观（手机「更多」面板等处沿用）；顶栏状态行用 quiet */
const PILL_CLASS = 'inline-flex min-h-7 items-center gap-1.5 rounded-full border border-hairline bg-surface2 px-2.5 text-13 text-t2 hover:bg-hover2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent2-ink';

/**
 * SwitchPopover — 切换控件（权限 / 显示方式）共用的弹出面板：贴着触发按钮摆放，
 * Esc 和点外面关闭，方向键在选项之间移动。选项由调用方传入。
 */
export function SwitchPopover({ open, onClose, trigger, label, width = 320, children }: {
    open: boolean;
    onClose: () => void;
    trigger: RefObject<HTMLElement | null>;
    /** 面板的无障碍名称 */
    label: string;
    width?: number;
    children: ReactNode;
}) {
    const panel = useRef<HTMLDivElement>(null);
    const position = useAnchoredPopover(open, trigger, panel, { width });
    useModalBehavior(open, panel, onClose);

    if (!open) return null;
    return createPortal(
        <div className="fixed inset-0 z-[200]" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
            <div
                ref={panel}
                role="dialog"
                aria-modal="true"
                aria-label={label}
                tabIndex={-1}
                style={{ ...position, width: `min(${width}px, calc(100vw - 16px))` }}
                className="fixed overflow-y-auto rounded-md border border-hairline bg-surface2 p-2 shadow-e4 focus:outline-none"
                onKeyDown={event => {
                    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
                    event.preventDefault();
                    const options = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
                    const index = options.indexOf(document.activeElement as HTMLButtonElement);
                    const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
                    options[next]?.focus();
                }}
            >
                {children}
            </div>
        </div>,
        document.body,
    );
}

export function PermissionMenu({ value, onChange, disabled = false, quiet = false }: {
    disabled?: boolean;
    value: PermissionMode;
    onChange: (mode: PermissionMode) => void;
    /** 顶栏状态行里的安静样式：不带盾牌图标，等宽小字 */
    quiet?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const trigger = useRef<HTMLButtonElement>(null);
    useLayoutEffect(() => { if (disabled) setOpen(false); }, [disabled]);

    return <>
        <button
            disabled={disabled}
            ref={trigger}
            type="button"
            aria-label="权限模式"
            aria-haspopup="dialog"
            aria-expanded={open && !disabled}
            onClick={() => setOpen(true)}
            className={quiet ? QUIET_SWITCH_CLASS : PILL_CLASS}
        >
            {quiet ? null : <Shield size={14} aria-hidden="true" />}
            {getPermissionModeLabel(value)}
            <ChevronDown size={quiet ? 12 : 14} className={quiet ? QUIET_CHEVRON_CLASS : undefined} aria-hidden="true" />
        </button>
        <SwitchPopover open={open && !disabled} onClose={() => setOpen(false)} trigger={trigger} label="选择权限">
            <h3 className="px-3 py-2 text-base font-semibold text-t1">选择权限</h3>
            {PERMISSION_MODES.map(mode => (
                <button
                    key={mode}
                    type="button"
                    aria-pressed={mode === value}
                    onClick={() => { onChange(mode); setOpen(false); }}
                    className={`flex min-h-11 w-full items-center gap-3 rounded-sm px-3 py-2 text-left hover:bg-hover2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent2-ink ${mode === value ? 'bg-accent2-soft' : ''}`}
                >
                    <span className="flex-1">
                        <span className="block text-sm font-medium text-t1">{getPermissionModeLabel(mode)}</span>
                        <span className="mt-1 block text-13 text-t2">{getPermissionModeDescription(mode)}</span>
                    </span>
                    {mode === value && <Check size={18} className="shrink-0 text-accent2-ink" aria-hidden="true" />}
                </button>
            ))}
        </SwitchPopover>
    </>;
}
