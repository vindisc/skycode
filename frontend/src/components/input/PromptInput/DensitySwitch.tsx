/**
 * 显示方式切换（消息展示密度）：桌面是顶栏状态行里的下拉（DensityMenu），移动端是常驻卡片中的单按钮 + 底部 Sheet。
 * 档位命名三端统一：精简 / 标准 / 完整过程；切档沿用现有 setDensity，
 * 清除当前会话的手动展开偏好。
 */

import React, { useCallback, useRef, useState } from 'react';
import { Rows3, Check, ChevronDown, X } from 'lucide-react';
import { SheetShell } from '@/components/apos/MobileBottomSheet';
import { useSessionStore } from '@/store/sessionStore';
import { useTurnViewStore, type TurnDensity } from '@/store/turnViewStore';
import { cn } from '@/components/ui/cn';
import { SwitchPopover } from './PermissionMenu';
import { QUIET_CHEVRON_CLASS, QUIET_SWITCH_CLASS } from './switchAppearance';

const DENSITY_OPTIONS: Array<{ value: TurnDensity; label: string }> = [
    { value: 'compact', label: '精简' },
    { value: 'balanced', label: '标准' },
    { value: 'detailed', label: '完整过程' },
];

function useDensitySelect(): (value: TurnDensity) => void {
    const sessionId = useSessionStore(s => s.sessionId);
    return useCallback((value: TurnDensity) => {
        useTurnViewStore.getState().setDensity(value, sessionId ?? undefined);
    }, [sessionId]);
}

// ==================== 桌面端：顶栏状态行里的下拉 ====================

const DENSITY_HINTS: Record<TurnDensity, string> = {
    compact: '只看问答，过程收成一行',
    balanced: '按任务查看执行摘要',
    detailed: '查看完整过程与任务导航',
};

/** 顶栏状态行里的「显示方式」切换：安静的文字按钮，点开是三选一的面板 */
export const DensityMenu: React.FC = () => {
    const density = useTurnViewStore(s => s.density);
    const handleSelect = useDensitySelect();
    const [open, setOpen] = useState(false);
    const trigger = useRef<HTMLButtonElement>(null);
    const current = DENSITY_OPTIONS.find(option => option.value === density)?.label ?? DENSITY_OPTIONS[1].label;

    return <>
        <button
            ref={trigger}
            type="button"
            aria-label={`显示方式：${current}`}
            aria-haspopup="dialog"
            aria-expanded={open}
            title={`显示方式：${current}`}
            data-testid="density-switch"
            onClick={() => setOpen(true)}
            className={QUIET_SWITCH_CLASS}
        >
            <span className="truncate">{current}</span>
            <ChevronDown size={12} className={QUIET_CHEVRON_CLASS} aria-hidden="true" />
        </button>
        <SwitchPopover open={open} onClose={() => setOpen(false)} trigger={trigger} label="显示方式" width={260}>
            <h3 className="px-3 py-2 text-base font-semibold text-t1">显示方式</h3>
            {DENSITY_OPTIONS.map(option => (
                <button
                    key={option.value}
                    type="button"
                    aria-pressed={option.value === density}
                    onClick={() => { handleSelect(option.value); setOpen(false); }}
                    className={cn(
                        'flex min-h-11 w-full items-center gap-3 rounded-sm px-3 py-2 text-left hover:bg-hover2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent2-ink',
                        option.value === density && 'bg-accent2-soft',
                    )}
                >
                    <span className="flex-1">
                        <span className="block text-sm font-medium text-t1">{option.label}</span>
                        <span className="mt-1 block text-13 text-t2">{DENSITY_HINTS[option.value]}</span>
                    </span>
                    {option.value === density && <Check size={18} className="shrink-0 text-accent2-ink" aria-hidden="true" />}
                </button>
            ))}
        </SwitchPopover>
    </>;
};

// ==================== 移动端：单按钮 + 三选一菜单 ====================

/** 快捷条 chip 配方（与 MobilePromptBar CHIP_CLASS 一致） */
const MOBILE_CHIP_CLASS = `flex h-11 shrink-0 items-center gap-1.5 rounded-full border border-hairline
    bg-surfacev2 px-2 text-13 text-t2 shadow-e1 transition-interactive duration-fast
    active:scale-95`;

/** 菜单项（触控命中 ≥44px，与 MobilePromptBar MENU_ITEM_CLASS 一致） */
const MOBILE_MENU_ITEM_CLASS = `flex h-11 w-full items-center gap-2 px-3.5 text-left text-13 text-t2
    transition-interactive duration-fast hover:bg-hover2 active:scale-[.98]`;

export const MobileDensitySwitch: React.FC = () => {
    const density = useTurnViewStore(s => s.density);
    const handleSelect = useDensitySelect();
    const [open, setOpen] = useState(false);
    const close = useCallback(() => setOpen(false), []);
    const current = DENSITY_OPTIONS.find(option => option.value === density)
        ?? DENSITY_OPTIONS[1];

    const handlePick = useCallback((value: TurnDensity) => {
        handleSelect(value);
        setOpen(false);
    }, [handleSelect]);

    return (
        <>
            <button
                type="button"
                aria-label={`显示方式：${current.label}`}
                aria-expanded={open}
                aria-haspopup="dialog"
                data-testid="mobile-density-chip"
                onClick={() => setOpen(v => !v)}
                className={MOBILE_CHIP_CLASS}
            >
                <Rows3 size={14} aria-hidden="true" />
                {current.label}
            </button>
            <SheetShell isOpen={open} onClose={close} ariaLabel="显示方式" header={
                <div className="flex items-center justify-between px-4 pb-2"><h3 className="text-t1 text-base font-semibold">显示方式</h3>
                    <button type="button" aria-label="关闭显示方式" onClick={close} className="panel-control flex h-11 w-11 items-center justify-center rounded-full hover:bg-hover2"><X size={18} /></button>
                </div>
            }>
                <div data-testid="mobile-density-menu" className="px-2 pb-4">
                    {DENSITY_OPTIONS.map(option => (
                        <button key={option.value} type="button" aria-pressed={option.value === density}
                            onClick={() => handlePick(option.value)}
                            className={cn(MOBILE_MENU_ITEM_CLASS, 'min-h-14 rounded-md', option.value === density && 'bg-accent2-soft text-accent2-ink')}>
                            <span className="flex flex-1 flex-col items-start gap-0.5"><span className="font-medium">{option.label}</span>
                                <span className="text-13 text-t3">{option.value === 'compact' ? '只看问答，过程收成一行' : option.value === 'balanced' ? '按任务查看执行摘要' : '查看完整过程与任务导航'}</span>
                            </span>
                            {option.value === density && <Check size={18} aria-hidden="true" />}
                        </button>
                    ))}
                </div>
            </SheetShell>
        </>
    );
};
