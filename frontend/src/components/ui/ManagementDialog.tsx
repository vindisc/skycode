import { useId, useRef, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, RefreshCw, Search, ShieldCheck, X } from 'lucide-react';
import { useModalBehavior } from '@/hooks/useModalBehavior';
import { Button } from './Button';
import { Chip } from './Chip';
import { EmptyState } from './EmptyState';
import { Input } from './Input';
import { Spinner } from './Spinner';
import { Toggle } from './Toggle';
import { cn } from './cn';

/**
 * ManagementDialog — 管理类弹窗的统一骨架（MCP 管理 / Skill 管理 / 记忆共用）。
 *
 * 版式与设置弹窗同一种：面板 88vh 高、最宽 1024px，手机上铺满全屏。
 * - 头部：图标块 + 标题 + 一行说明；右边是主操作（可选）、刷新、关闭
 * - 提示条：错误 / 警告贴在头部下面（AlertStrip）
 * - 工具栏：左边统计或视图切换，右边搜索
 * - 内容区：独立滚动，列表用 EntryList + EntryRow（一张卡里的分隔行）
 * - 底栏：用量、更新时间这类只读信息（可选）
 *
 * 弹窗行为也统一在这里：打开时焦点落在面板上，Esc 关闭，Tab 在面板内循环，关闭后焦点回到入口按钮。
 * 点遮罩不关闭——记忆里可能有没保存的修改。
 *
 * 三个页面只管各自的内容；外壳的尺寸、间距和控件样式都从这里来，不再各写一套。
 */
export interface ManagementDialogProps {
    /** 标题图标，与顶栏入口按钮是同一个 */
    icon: ReactNode;
    title: string;
    /** 标题下的一行说明 */
    description: ReactNode;
    onClose: () => void;
    /** 关闭按钮的无障碍名称，例如「关闭 MCP 管理」 */
    closeLabel: string;
    /** 头部右侧、刷新左边的主操作（如「保存」） */
    actions?: ReactNode;
    onRefresh?: () => void;
    refreshLabel?: string;
    refreshing?: boolean;
    /** 转圈之外还要禁用刷新的情况（如保存进行中） */
    refreshDisabled?: boolean;
    /** 头部下面的提示条 */
    alerts?: ReactNode;
    /** 工具栏：左边统计或视图切换，右边搜索 */
    toolbar?: ReactNode;
    footer?: ReactNode;
    children: ReactNode;
}

export function ManagementDialog({
    icon, title, description, onClose, closeLabel, actions,
    onRefresh, refreshLabel, refreshing = false, refreshDisabled = false, alerts, toolbar, footer, children,
}: ManagementDialogProps) {
    const panel = useRef<HTMLDivElement>(null);
    const titleId = useId();
    const descriptionId = useId();
    useModalBehavior(true, panel, onClose);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay2 backdrop-blur-[2px] max-md:p-0 md:p-3">
            <div
                ref={panel}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={descriptionId}
                tabIndex={-1}
                className="flex h-dvh w-full flex-col overflow-hidden bg-surfacev2 shadow-e4 outline-none motion-safe:animate-scale-in max-md:pt-[env(safe-area-inset-top)] max-md:pb-[env(safe-area-inset-bottom)] md:h-[88vh] md:max-w-5xl md:rounded-panel md:border md:border-hairline"
            >
                {/* 头部 / 内容 / 底栏用普通容器：页面级地标（banner、main）留给外面的页面，弹窗里不重复。
                    头部是网格：图标、标题、右侧操作在第一行，说明在第二行通到最右——窄屏下说明不会被操作按钮挤成很多行 */}
                <div className="grid shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-b border-hairline px-5 pb-3 pt-4">
                    <span aria-hidden="true" className="row-span-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-sunken2 text-accent2-ink [&_svg]:h-[18px] [&_svg]:w-[18px]">
                        {icon}
                    </span>
                    <h2 id={titleId} className="min-w-0 break-words text-15 font-semibold text-t1">{title}</h2>
                    <div className="flex shrink-0 items-center gap-1">
                        {actions}
                        {onRefresh && (
                            <Button size="sm" variant="ghost" iconOnly onClick={onRefresh} disabled={refreshing || refreshDisabled} aria-label={refreshLabel}>
                                <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} aria-hidden="true" />
                            </Button>
                        )}
                        <Button size="sm" variant="ghost" iconOnly onClick={onClose} aria-label={closeLabel}>
                            <X className="h-4 w-4" aria-hidden="true" />
                        </Button>
                    </div>
                    <p id={descriptionId} className="col-span-2 min-w-0 text-13 leading-relaxed text-t3">{description}</p>
                </div>

                {alerts}
                {toolbar && (
                    <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-hairline px-5 py-2.5">
                        {toolbar}
                    </div>
                )}

                <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>

                {footer && (
                    <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t border-hairline px-5 py-2.5 text-13 text-t3">
                        {footer}
                    </div>
                )}
            </div>
        </div>
    );
}

/** 标签：与设置页的模型小标签同款（Chip 的紧凑档）。tone 只标开关表达不了的状态，启用与否看开关 */
export function Tag({ tone = 'neutral', className, children }: {
    tone?: 'neutral' | 'ok' | 'warn' | 'accent';
    className?: string;
    children: ReactNode;
}) {
    return <Chip variant={tone} className={cn('h-5 px-2 text-xs', className)}>{children}</Chip>;
}

/** 工具栏左侧：一行计数（children）加一行保存位置说明（note） */
export function ToolbarStats({ note, children }: { note?: ReactNode; children: ReactNode }) {
    return (
        <div className="min-w-0 flex-1 basis-64 text-13 text-t2">
            <div className="flex flex-wrap items-center gap-x-4" aria-live="polite">{children}</div>
            {note && (
                <p className="mt-0.5 flex items-start gap-1 leading-relaxed text-t3">
                    <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>{note}</span>
                </p>
            )}
        </div>
    );
}

/** 工具栏右侧的搜索框 */
export function SearchField({ value, onChange, label, placeholder, className }: {
    value: string;
    onChange: (value: string) => void;
    /** 无障碍名称 */
    label: string;
    placeholder: string;
    className?: string;
}) {
    return (
        <label className={cn('relative block w-full md:w-72 md:shrink-0', className)}>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-t3" aria-hidden="true" />
            <Input
                value={value}
                onChange={event => onChange(event.target.value)}
                aria-label={label}
                placeholder={placeholder}
                className="pl-9"
            />
        </label>
    );
}

/** 贴在头部下面的提示条 */
export function AlertStrip({ tone = 'err', action, children }: {
    tone?: 'err' | 'warn';
    action?: ReactNode;
    children: ReactNode;
}) {
    return (
        <div
            role="alert"
            className={cn(
                'flex shrink-0 items-center justify-between gap-3 border-b px-5 py-2 text-13',
                tone === 'warn'
                    ? 'border-warnsoft bg-warnsoft text-warnstrong dark:text-warn'
                    : 'border-errsoft bg-errsoft text-err',
            )}
        >
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">{children}</span>
            {action}
        </div>
    );
}

/** 读取中的占位 */
export function LoadingBlock({ children }: { children: ReactNode }) {
    return (
        <div role="status" className="flex items-center justify-center gap-2 py-12 text-13 text-t2">
            <Spinner size="sm" role="presentation" aria-hidden="true" />
            {children}
        </div>
    );
}

/** 什么都没有、或搜索无结果时的占位 */
export function NothingHere({ icon, title, description, action }: {
    icon: ReactNode;
    title: string;
    description?: ReactNode;
    action?: ReactNode;
}) {
    return (
        <EmptyState
            variant="compact"
            className="py-12"
            icon={icon}
            title={title}
            description={description}
            actions={action}
        />
    );
}

/** 一张卡，里面是分隔行（EntryRow） */
export function EntryList({ children, className }: { children: ReactNode; className?: string }) {
    return <div className={cn('overflow-hidden rounded-md border border-hairline bg-surface2', className)}>{children}</div>;
}

export interface EntryRowProps {
    /** 名称 */
    title?: ReactNode;
    /** 名称后面的标签、时间 */
    badges?: ReactNode;
    /** 一两句说明，最多两行 */
    description?: ReactNode;
    /** 次要信息：数量、类型、路径 */
    meta?: ReactNode;
    /** 右侧控件：开关、删除 */
    actions?: ReactNode;
    /** 左侧的展开箭头；不传就没有 */
    expand?: { expanded: boolean; onToggle: () => void; label: string; disabled?: boolean; controls: string };
    /** 一直显示的内容（如记忆条目的输入框） */
    body?: ReactNode;
    /** 展开后才显示的详情 */
    children?: ReactNode;
    className?: string;
}

export function EntryRow({ title, badges, description, meta, actions, expand, body, children, className }: EntryRowProps) {
    // 网格而不是弹性换行：窄屏下右侧控件不会被挤到下一行，始终和标题同一行；说明在下面通栏
    const textColumn = expand ? 'col-start-2' : 'col-start-1';
    return (
        <article className={cn('border-t border-hairline px-4 py-3 first:border-t-0', className)}>
            <div className={cn('grid items-start gap-x-3', expand ? 'grid-cols-[auto_minmax(0,1fr)_auto]' : 'grid-cols-[minmax(0,1fr)_auto]')}>
                {expand && (
                    <button
                        type="button"
                        onClick={expand.onToggle}
                        disabled={expand.disabled}
                        aria-expanded={expand.expanded}
                        aria-controls={expand.controls}
                        aria-label={expand.label}
                        className="dialog-control -ml-2 col-start-1 row-start-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-t3 hover:bg-hover2 hover:text-t1 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent2-ring disabled:pointer-events-none disabled:opacity-30"
                    >
                        {expand.expanded
                            ? <ChevronDown className="h-4 w-4" aria-hidden="true" />
                            : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
                    </button>
                )}
                {(title !== undefined || badges !== undefined) && (
                    <div className={cn('row-start-1 flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1 max-md:min-h-11', textColumn)}>
                        {title !== undefined && (
                            <h3 className="min-w-0 break-words text-sm font-semibold text-t1 [overflow-wrap:anywhere]">{title}</h3>
                        )}
                        {badges}
                    </div>
                )}
                {actions !== undefined && (
                    <div className={cn('row-start-1 flex shrink-0 items-center gap-1 self-center', expand ? 'col-start-3' : 'col-start-2')}>
                        {actions}
                    </div>
                )}
                {description !== undefined && (
                    <p className={cn('row-start-2 mt-0.5 line-clamp-2 break-words text-13 leading-relaxed text-t2 [overflow-wrap:anywhere]', textColumn)}>
                        {description}
                    </p>
                )}
                {meta !== undefined && (
                    <p className={cn('mt-1 break-words text-13 text-t3 [overflow-wrap:anywhere]', textColumn, description !== undefined ? 'row-start-3' : 'row-start-2')}>
                        {meta}
                    </p>
                )}
            </div>
            {body !== undefined && <div className="mt-2">{body}</div>}
            {expand?.expanded && children !== undefined && (
                <div id={expand.controls} className="mt-3 border-t border-hairline pt-3 text-13 text-t2">
                    {children}
                </div>
            )}
        </article>
    );
}

/** 行尾的启停开关 */
export function EntryToggle({ checked, onCheckedChange, label, disabled }: {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    /** 无障碍名称，说明点下去会做什么，例如「关闭 commit」 */
    label: string;
    disabled?: boolean;
}) {
    return (
        <Toggle
            checked={checked}
            onCheckedChange={onCheckedChange}
            disabled={disabled}
            aria-label={label}
            // Toggle 默认只在手机宽度保留 44px 高的透明命中区；这里让平板也保留
            className="md:before:block"
        />
    );
}
