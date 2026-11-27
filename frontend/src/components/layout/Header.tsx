import { useMessageStore } from '@/store/messageStore';
import { BrandLogo } from '@/components/ui/BrandLogo';
/**
 * Header — 顶部导航栏组件
 * SPEC: §8.6.1
 *
 * 包含: Logo, SessionStatus, Metrics(Tokens/Cost), ThemeSwitch, NewSession, Settings
 * （会话状态与用量指标自底部状态栏右簇上移；会话标题由左侧列表承载，桌面端不再重复，
 *   仅移动端抽屉不常驻时在本栏显示标题）
 */

import { useEffect } from 'react';
import { Menu, Settings, Loader2, Cable, Brain, Puzzle, Zap, PanelRightClose, PanelRightOpen } from 'lucide-react';
import { useSessionStore } from '@/store/sessionStore';
import { useCostStore } from '@/store/costStore';
import { useDialogStore } from '@/store/dialogStore';
import { usePermissionStore } from '@/store/permissionStore';
import { useAppUiStore } from '@/store/appUiStore';
import { useInspectorAvailable, useInspectorVisible } from '@/hooks/useInspectorVisible';
import { getSessionStatusLabel } from '@/components/status/sessionStatusMeta';
import { getPermissionModeLabel } from './StatusBar';
import { useModelStore } from '@/store/modelStore';
import { useBridgeStore } from '@/store/bridgeStore';
import { clearSessionSelection } from '@/services/sessionActivation';

/** §7.4 头部按钮共性：hover/active/焦点环（ring-accent2-ring） */
const HEADER_BUTTON_CLASS =
    'px-2 h-7 items-center justify-center max-md:min-h-11 max-md:min-w-11 rounded-sm hover:bg-hover2 hover:text-t1 active:scale-95 active:shadow-pressed transition-interactive duration-fast text-t2 ' +
    'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent2-ring';

/** 会话状态展示规则（颜色/脉冲/旋转/文案/胶囊语气）已抽取至
 *  status/sessionStatusMeta——Header 状态胶囊、输入区 SessionStatusCapsule、
 *  SessionStatusIcon 共用同款视觉约定；此处保留再导出兼容既有引用
 *  （Header.test、SessionStatusIcon 等）。 */
export { getSessionStatusMeta, getSessionStatusLabel } from '@/components/status/sessionStatusMeta';

/** 顶栏按钮组里的图标按钮：28×28，悬停铺底，键盘焦点有强调色环 */
const TOOL_BUTTON_CLASS =
    'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-t2 hover:bg-hover2 hover:text-t1 active:scale-95 ' +
    'transition-interactive duration-fast focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent2-ring';

interface HeaderProps {
    onMenuClick?: () => void;
    showMenuButton?: boolean;
}

export function Header({ onMenuClick, showMenuButton = false }: HeaderProps) {
    const { model, setModel } = useSessionStore();
    const { sessionCost, totalCost, usage } = useCostStore();
    // 用量指标只在有数可示时出现：空会话/首页上一排「↑0 ↓0 $0.000 ∑$0.000」只是噪音
    const hasUsage = usage.inputTokens > 0 || usage.outputTokens > 0 || usage.cacheReadInputTokens > 0
        || sessionCost > 0 || totalCost > 0;
    const { bridgeStatus } = useBridgeStore();
    const { openDialog } = useDialogStore();

    // 动态加载可用模型列表（统一从 modelStore 缓存读取；移动端头部展示当前模型名）
    const {
        models: availableModels,
        defaultModel,
        loaded,
        fetchModels,
    } = useModelStore();

    useEffect(() => {
        if (loaded) return;
        void fetchModels();
    }, [loaded, fetchModels]);

    useEffect(() => {
        // 模型列表加载完成且当前未选模型时，使用后端默认模型
        if (loaded && !model && defaultModel) {
            setModel(defaultModel);
        }
    }, [loaded, defaultModel, model, setModel]);

    const status = useSessionStore(s => s.status);
    const permissionMode = usePermissionStore(s => s.permissionMode);
    // 右侧检查器：够宽时顶栏给一个收起 / 展开的入口；它可见时用量只在检查器里显示
    const inspectorOpen = useAppUiStore(s => s.inspectorOpen);
    const setInspectorOpen = useAppUiStore(s => s.setInspectorOpen);
    const inspectorVisible = useInspectorVisible();
    const canToggleInspector = useInspectorAvailable();
    const permissionLabel = getPermissionModeLabel(permissionMode);
    const customTitle = useSessionStore(s => s.customTitle);
    const firstUserText = useMessageStore(s => {
        const block = s.messages.find(m => m.type === 'user')?.content.find(b => b.type === 'text');
        return block?.type === 'text' ? block.text : '任务';
    });
    // 侧栏改名后的自定义标题优先；未设置时沿用首条用户消息
    const sessionTitle = customTitle?.trim() || firstUserText;
    const currentModelName = availableModels.find(item => item.id === model)?.displayName ?? model ?? '';
    // Compact presentation only; option labels, ids and model requests remain unchanged.
    const compactModelName = currentModelName.replace(/\s*[（(][^）)]*[）)]\s*$/, '');
    const streaming = bridgeStatus === 'connected' && status === 'streaming';

    const mobileStatus = bridgeStatus !== 'connected'
        ? ({ disconnected: '连接已断开', reconnecting: '连接中', error: '连接异常' }[bridgeStatus])
        : ({ idle: '', streaming: '运行中', waiting_permission: '待审批', compacting: '压缩中' }[status]);
    const mobileStatusTone = bridgeStatus === 'error' || bridgeStatus === 'disconnected'
        ? 'border-errsoft bg-errsoft text-err'
        : status === 'waiting_permission'
            ? 'border-warnsoft bg-warnsoft text-warn'
            : 'border-accent2-ring bg-accent2-soft text-accent2-ink';

    return (
        <header className="app-header relative h-[52px] border-b border-outline flex items-center px-2 md:px-2.5 shrink-0">
            <div className="flex md:hidden min-w-0 w-full items-center gap-3 px-1" aria-label="当前会话信息">
                <button type="button" onClick={onMenuClick} aria-label="打开会话列表" title="打开会话列表" className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-sm text-t2 hover:bg-hover2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent2-ink"><Menu size={20} /></button>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-t1" title={sessionTitle}>{sessionTitle}</div>
                    <div className="mt-0.5 flex min-w-0 items-center gap-2">
                        <span className="truncate text-13 text-t2" title={currentModelName}>{compactModelName || '模型加载中'}</span>
                        {mobileStatus && (
                            <span role="status" className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-13 font-medium leading-5 ${mobileStatusTone}`}>
                                {streaming
                                    ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                                    : <span className="h-1.5 w-1.5 rounded-full bg-current motion-safe:animate-pulse" aria-hidden="true" />}
                                {mobileStatus}
                            </span>
                        )}
                    </div>
                </div>
                <button type="button" onClick={clearSessionSelection} aria-label="返回首页" title="返回首页"
                    className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-sm hover:bg-hover2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent2-ink">
                    <BrandLogo className="h-8 w-8" />
                </button>
            </div>
            {/* 桌面三段式：左段（平板放菜单键和回首页，桌面与侧栏等宽留空）、中段一行等宽字体的状态、
                右段成组的工具按钮——对应 Skymap 顶栏的「左空 | 中间等宽标题 | 右侧按钮组」 */}
            <div className="hidden md:grid flex-1 min-w-0 grid-cols-[auto_1fr_auto] lg:grid-cols-[var(--sidebar-track,310px)_1fr_auto] items-center gap-3">
                <div className="flex min-w-0 items-center gap-1">
                    {showMenuButton && (
                        <button
                            onClick={onMenuClick}
                            className={`panel-control ${HEADER_BUTTON_CLASS} min-h-11 min-w-11 lg:hidden`}
                            aria-label="打开会话列表"
                        >
                            <Menu className="w-5 h-5" />
                        </button>
                    )}
                    {/* 桌面上品牌与回首页在左栏顶部的品牌行；这里只给没有常驻侧栏的平板留一个入口 */}
                    <button type="button" onClick={clearSessionSelection} aria-label="返回首页" title="返回首页"
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm hover:bg-hover2 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent2-ring lg:hidden">
                        <BrandLogo className="h-5 w-5" />
                    </button>
                </div>

                {/* 状态行：模型 | 权限 | 会话状态，有用量时追加。只读信息，不放控件 */}
                <div className="flex min-w-0 items-center justify-center gap-2 font-mono text-xs tabular-nums text-t3">
                    <span className="truncate" title={currentModelName}>{compactModelName || '模型加载中'}</span>
                    <span aria-hidden="true">|</span>
                    <span>{permissionLabel}</span>
                    <span aria-hidden="true">|</span>
                    {streaming && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-accent2-ink" aria-hidden="true" />}
                    <span role="status" className={`shrink-0 ${streaming ? 'text-accent2-ink' : bridgeStatus !== 'connected' ? 'text-warn' : ''}`}>
                        {mobileStatus || getSessionStatusLabel(status)}
                    </span>
                    {hasUsage && !inspectorVisible && <>
                        <span aria-hidden="true">|</span>
                        <span title="输入 Tokens">↑{usage.inputTokens.toLocaleString()}</span>
                        <span title="输出 Tokens">↓{usage.outputTokens.toLocaleString()}</span>
                        {usage.cacheReadInputTokens > 0 && (
                            <span title="缓存读取" className="inline-flex items-center gap-0.5 text-accent2-ink">
                                <Zap className="w-3 h-3" aria-hidden="true" />{usage.cacheReadInputTokens.toLocaleString()}
                            </span>
                        )}
                        <span aria-hidden="true">|</span>
                        <span title="当前会话成本">${sessionCost.toFixed(3)}</span>
                    </>}
                </div>

                {/* MCP / 记忆 / Skill / 设置：装在同一个带描边的按钮组里，组内用细分隔线隔开（悬停有名称提示） */}
                <div className="app-tool-group">
                <button
                    onClick={() => openDialog('mcp')}
                    className={TOOL_BUTTON_CLASS}
                    title="MCP 管理"
                    aria-label="MCP 管理"
                    aria-haspopup="dialog"
                >
                    <Cable className="w-4 h-4" aria-hidden="true" />
                </button>

                <button
                    onClick={() => openDialog('memory')}
                    className={TOOL_BUTTON_CLASS}
                    title="记忆"
                    aria-label="记忆"
                    aria-haspopup="dialog"
                >
                    <Brain className="w-4 h-4" aria-hidden="true" />
                </button>

                <button
                    onClick={() => openDialog('skills')}
                    className={TOOL_BUTTON_CLASS}
                    title="Skill 管理"
                    aria-label="Skill 管理"
                    aria-haspopup="dialog"
                >
                    <Puzzle className="w-4 h-4" aria-hidden="true" />
                </button>

                <span className="app-tool-divider" aria-hidden="true" />

                {/* Settings */}
                <button
                    onClick={() => openDialog('settings')}
                    className={TOOL_BUTTON_CLASS}
                    title="设置"
                    aria-label="设置"
                    aria-haspopup="dialog"
                >
                    <Settings className="w-4 h-4" aria-hidden="true" />
                </button>

                {canToggleInspector && <>
                    <span className="app-tool-divider" aria-hidden="true" />
                    <button
                        type="button"
                        onClick={() => setInspectorOpen(!inspectorOpen)}
                        className={TOOL_BUTTON_CLASS}
                        aria-label="检查器"
                        aria-pressed={inspectorOpen}
                        title={inspectorOpen ? '收起检查器' : '展开检查器'}
                    >
                        {inspectorOpen ? <PanelRightClose className="w-4 h-4" aria-hidden="true" /> : <PanelRightOpen className="w-4 h-4" aria-hidden="true" />}
                    </button>
                </>}
                </div>
            </div>
        </header>
    );
}
