import { useState } from 'react';
import { X, Sun, Moon, Sparkles, Rocket, Flower2, Landmark, Candy, Bug, Orbit, Blocks, CircleHelp, ChevronRight, Brain, Check, Zap, Wand2, Server, Route } from 'lucide-react';
import { SheetShell } from '@/components/apos/MobileBottomSheet';
import { ModelChip, PermissionModeChip, MobileChoice } from './PromptComposerChips';
import { useTurnViewStore, type TurnDensity } from '@/store/turnViewStore';
import { useSessionStore } from '@/store/sessionStore';
import { useDialogStore } from '@/store/dialogStore';
import { useConfigStore } from '@/store/configStore';
import { SpaceshipFxControls } from '@/components/theme/SpaceshipFxControls';
import { InkHavocFxControls } from '@/components/theme/InkHavocFxControls';
import { JellyFxControls } from '@/components/theme/JellyFxControls';
import { ACCENT_PRESETS, normalizeAccentHex } from '@/theme/accents';
import { useOptimizePrompt } from './useOptimizePrompt';

const action = 'min-h-11 rounded-[10px] px-1.5 text-sm text-t2 hover:bg-hover2 active:bg-hover2 transition-interactive duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent2-ink';

const list = 'overflow-hidden rounded-[14px] border border-hairline bg-surface2 divide-y divide-[var(--v2-border-hairline)]';
const actionRow = 'flex min-h-12 w-full items-center gap-3 px-3 py-3 text-left text-sm text-t1 hover:bg-hover2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent2-ink disabled:opacity-50';

/** 「更多操作」面板里的一行入口 */
function ActionRow({ label, icon: Icon, run, disabled = false, hint }: { label: string; icon: typeof Brain; run: () => void; disabled?: boolean; hint?: string }) {
    return <button type="button" className={actionRow} disabled={disabled} onClick={run}>
        <Icon size={20} className="text-t2" aria-hidden="true" />
        <span className="min-w-0 flex-1">
            <span className="block">{label}</span>
            {hint && <span className="block text-[13px] text-t3">{hint}</span>}
        </span>
        <ChevronRight size={16} className="text-t3" aria-hidden="true" />
    </button>;
}

/** 显示方式三档（消息展示密度；描述沿用原 MobileDensitySwitch 文案；选项面板为上下列表） */
const DENSITY_OPTIONS: { value: TurnDensity; label: string; description: string }[] = [
    { value: 'compact', label: '精简', description: '问题、过程与回复默认折叠' },
    { value: 'balanced', label: '标准', description: '按任务查看执行摘要' },
    { value: 'detailed', label: '完整过程', description: '查看完整过程与任务导航' },
];

interface MobileComposerNavigationProps {
    /** 「优化提示词」要用的草稿信息；不传则不显示这一行 */
    optimize?: { draft: string; draftKey: string; disabled: boolean };
}

export function MobileComposerNavigation({ optimize }: MobileComposerNavigationProps = {}) {
    // 工作台切换已从前台隐藏（默认开发工作台），一级入口改为模型切换；
    // 紧凑裸排形态：顺序与桌面 composer-row 统一——状态（权限项前置）、权限、模型、显示方式；更多固定末尾。
    const [panel, setPanel] = useState<'more' | null>(null);
    const density = useTurnViewStore(s => s.density);
    const sessionId = useSessionStore(s => s.sessionId);
    const open = panel !== null;
    const openDialog = useDialogStore(s => s.openDialog);
    const { theme, setTheme } = useConfigStore();
    const dialog = (type: 'mcp' | 'keybindings' | 'memory' | 'skills') => { setPanel(null); openDialog(type); };
    // 顶栏的设置按钮在手机宽度下不显示，设置弹窗里的「模型服务商」「场景分派」只能从这里进
    const openSettings = (tab: 'providers' | 'scenes') => { setPanel(null); openDialog('settings', { tab }); };
    const optimizeAction = useOptimizePrompt(optimize?.draft ?? '', optimize?.draftKey ?? '');
    return <>
        <nav aria-label="手机会话操作" className="mobile-composer-navigation flex shrink-0 items-center justify-between gap-0.5 overflow-x-auto px-2 pb-1">
            <PermissionModeChip mobile />
            <ModelChip mobile />
            <MobileChoice label="显示方式" showCurrent value={density} options={DENSITY_OPTIONS} onChange={value => useTurnViewStore.getState().setDensity(value as TurnDensity, sessionId ?? undefined)} />
            <button type="button" className={action} aria-haspopup="dialog" aria-expanded={open} onClick={() => setPanel('more')}>更多</button>
        </nav>
        <SheetShell isOpen={open} onClose={() => setPanel(null)} ariaLabel="更多操作" header={<div className="flex items-center justify-between px-4"><h2 className="text-xl font-semibold">更多操作</h2><button className={action} aria-label="关闭更多操作" onClick={() => setPanel(null)}><X size={20} /></button></div>}>
            <div className="space-y-4 p-4">
                {panel === 'more' && <>
                    <section>
                        <h3 className="mb-2 text-[13px] font-medium text-t2">外观</h3>
                        <div className="grid grid-cols-2 min-[380px]:grid-cols-4 gap-2">{(['light', 'dark', 'glass', 'spaceship', 'ink-havoc', 'ink-havoc-night', 'jelly', 'spider', 'galaxy'] as const).map((mode, i) => {
                            const Icon = [Sun, Moon, Sparkles, Rocket, Flower2, Landmark, Candy, Bug, Orbit][i];
                            const selected = theme.mode === mode;
                            return <button key={mode} className={`flex min-h-[72px] flex-col items-center justify-center gap-2 rounded-[14px] border text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent2-ink ${selected ? 'border-accent2-ink bg-accent2-soft text-accent2-ink' : 'border-hairline bg-surface2 text-t2 hover:bg-hover2'}`} aria-pressed={selected} onClick={() => setTheme({ mode })}><Icon size={20} aria-hidden="true" /><span>{['浅色', '深色', '液态玻璃', '星舰', '花果晨', '灵霄夜', '果冻', '蜘蛛爬虫', '璀璨银河'][i]}</span></button>;
                        })}</div>
                    </section>
                    {/* 星舰特效：仅 spaceship 主题可见（紧凑形态，与桌面外观设置同一控件） */}
                    {theme.mode === 'spaceship' && <section><SpaceshipFxControls compact /></section>}
                    {/* 天宫特效：仅 ink-havoc 双主题可见（紧凑形态，与桌面外观设置同一控件） */}
                    {(theme.mode === 'ink-havoc' || theme.mode === 'ink-havoc-night') && <section><InkHavocFxControls compact /></section>}
                    {/* 果冻特效：仅 jelly 主题可见（紧凑形态，与桌面外观设置同一控件） */}
                    {theme.mode === 'jelly' && <section><JellyFxControls compact /></section>}
                    <section>
                        <h3 className="mb-2 text-[13px] font-medium text-t2">强调色</h3>
                        {/* 审查-移动端修复：ink 双模式 / jelly accent 写死主题色（同桌面 SettingsPanel 逻辑），
                            可选中却无效果还会覆盖其他主题偏好——禁用并说明 */}
                        {(theme.mode === 'ink-havoc' || theme.mode === 'ink-havoc-night' || theme.mode === 'jelly' || theme.mode === 'spider' || theme.mode === 'galaxy') ? (
                            <div className="text-[13px] text-t3">{theme.mode === 'galaxy' ? '本主题使用专属星蓝、紫罗兰与玫红配色' : theme.mode === 'spider' ? '本主题使用专属青色、洋红与紫色配色' : theme.mode === 'jelly' ? '本主题使用专属法式配色' : '本主题使用专属重彩配色'}</div>
                        ) : (
                        <div className="flex flex-wrap gap-2" role="group" aria-label="强调色">
                            {ACCENT_PRESETS.map(({ hex, label }) => {
                                const selected = normalizeAccentHex(theme.accentColor) === hex;
                                return <button key={hex} type="button" aria-pressed={selected} aria-label={`强调色 ${label}`} title={label} onClick={() => setTheme({ accentColor: hex })}
                                    className={`flex h-11 w-11 items-center justify-center rounded-full border-2 border-transparent transition-interactive duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent2-ink ${selected ? 'scale-110' : 'active:scale-95'}`}
                                    style={{ backgroundColor: hex, boxShadow: selected ? '0 0 0 3px var(--v2-accent-ring)' : undefined }}>
                                    {selected && <Check size={18} className="text-white" aria-hidden="true" />}
                                </button>;
                            })}
                        </div>
                        )}
                    </section>
                    {/* 输入条那一排在手机上已经排满，所以「优化提示词」和设置页的入口都放在这里 */}
                    <div className={list}>
                        {optimize && <ActionRow label="优化提示词" icon={Wand2} disabled={optimize.disabled}
                            hint={optimizeAction.unconfigured ? '还没有配置优化用的模型，点击去设置' : undefined}
                            // 和下面几个弹窗入口一样：先收起面板，否则它会留在弹窗底下，干扰 Esc 关闭和焦点归还
                            run={() => { setPanel(null); optimizeAction.handleClick(); }} />}
                        <ActionRow label="模型服务商" icon={Server} run={() => openSettings('providers')} />
                        <ActionRow label="场景分派" icon={Route} run={() => openSettings('scenes')} />
                    </div>
                    <div className={list}>
                        {[
                            { label: '记忆', icon: Brain, run: () => dialog('memory') },
                            { label: 'MCP 管理', icon: Blocks, run: () => dialog('mcp') },
                            { label: 'Skill 管理', icon: Zap, run: () => dialog('skills') },
                            { label: '帮助与快捷键', icon: CircleHelp, run: () => dialog('keybindings') },
                        ].map(({ label, icon: Icon, run }) => <ActionRow key={label} label={label} icon={Icon} run={run} />)}
                    </div>
                </>}
            </div>
        </SheetShell>
    </>;
}
