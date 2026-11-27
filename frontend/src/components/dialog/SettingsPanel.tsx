/**
 * 「设置」弹窗：外观 / 模型服务商 / 场景分派三个标签页。
 * 只挂载当前选中的那一页：后两页都会发请求，没必要在用户看外观时就去拉服务商列表。
 * 外观：主题立即生效，由 ConfigStore 持久化。
 * <p>
 * 服务商表单里有还没保存的改动时（弹窗底部的「完成」、右上角的关闭、Esc、点遮罩、切换标签页都会丢掉它），
 * 先确认再走——填了几项、还粘贴了密钥的表单，不该被顺手一点就没了。
 */
import { useCallback, useRef, useState } from 'react';
import { Moon, Sun, Check } from 'lucide-react';
import { useConfigStore } from '@/store/configStore';
import { useDialogStore } from '@/store/dialogStore';
import { Button, Dialog, Tabs, cn } from '@/components/ui';
import { ACCENT_PRESETS, normalizeAccentHex } from '@/theme/accents';
import { LlmProvidersSettings } from '@/components/settings/LlmProvidersSettings';
import { SceneBindingsSettings } from '@/components/settings/SceneBindingsSettings';
import type { ThemeConfig } from '@/types';

export type SettingsTab = 'providers' | 'scenes' | 'appearance';

// 模型相关的两页放前面、默认落在「模型服务商」——这是用户最常来的地方；外观放最后
const TABS: { value: SettingsTab; label: string }[] = [
    { value: 'providers', label: '模型服务商' },
    { value: 'scenes', label: '场景分派' },
    { value: 'appearance', label: '外观' },
];

function toSettingsTab(value: string): SettingsTab {
    return TABS.some(tab => tab.value === value) ? (value as SettingsTab) : 'providers';
}

const THEMES: { mode: ThemeConfig['mode']; label: string; icon: typeof Sun }[] = [
    { mode: 'light', label: '浅色', icon: Sun },
    { mode: 'dark', label: '深色', icon: Moon },
];

export function SettingsPanel({ onClose }: { onClose: () => void }) {
    // 打开弹窗时可以通过 dialogData.tab 指定落在哪一页（例如从「优化提示词」跳到场景分派）
    const requestedTab = useDialogStore(s => s.dialogData.tab);
    const [tab, setTab] = useState<SettingsTab>(() => toSettingsTab(String(requestedTab ?? 'providers')));
    // 当前页有没有没保存的改动。用 ref：关闭、切换的瞬间要读到最新值，不必等重渲染
    const unsavedRef = useRef(false);
    const onUnsavedChange = useCallback((unsaved: boolean) => { unsavedRef.current = unsaved; }, []);

    const requestClose = useCallback(() => {
        if (unsavedRef.current && !window.confirm('设置里有还没保存的内容，关闭后会丢失。确定关闭吗？')) return;
        unsavedRef.current = false;
        onClose();
    }, [onClose]);

    const changeTab = (next: SettingsTab) => {
        if (next === tab) return;
        if (unsavedRef.current && !window.confirm('设置里有还没保存的内容，切换后会丢失。确定切换吗？')) return;
        unsavedRef.current = false;
        setTab(next);
    };

    return (
        <Dialog open title="设置" onClose={requestClose} className="max-w-3xl border border-hairline max-h-[85vh] flex flex-col">
            <div className="px-5 pt-4 shrink-0">
                <Tabs items={TABS} value={tab} onValueChange={value => changeTab(toSettingsTab(value))} />
            </div>
            {/* 内容区可滚动，完成按钮固定可见 */}
            <div className="px-5 pb-5 pt-4 overflow-y-auto min-h-0 flex-1">
                {tab === 'appearance' && <AppearanceSettings />}
                {tab === 'providers' && (
                    <LlmProvidersSettings
                        onGoToScenes={() => changeTab('scenes')}
                        onUnsavedChange={onUnsavedChange}
                    />
                )}
                {tab === 'scenes' && <SceneBindingsSettings onGoToProviders={() => changeTab('providers')} />}
            </div>
            <div className="px-5 pb-5 pt-3 border-t border-hairline flex justify-end shrink-0">
                <Button variant="primary" onClick={requestClose}>完成</Button>
            </div>
        </Dialog>
    );
}

function AppearanceSettings() {
    const { theme, setTheme } = useConfigStore();

    return (
        <>
        {/* 主题只剩浅色、深色两个：各占一半 */}
        <div className="grid grid-cols-2 gap-3" role="group" aria-label="主题">
                {THEMES.map(({ mode, label, icon: Icon }) => (
                    <button
                        key={mode}
                        type="button"
                        aria-pressed={theme.mode === mode}
                        onClick={() => setTheme({ mode })}
                        className={cn(
                            'flex flex-col items-center gap-2 p-4 rounded-sm border text-sm text-t1 transition-interactive duration-fast',
                            'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent2-ring',
                            theme.mode === mode
                                ? 'border-accent2 bg-accent2-soft'
                                : 'border-hairline hover:bg-hover2',
                        )}
                    >
                        <Icon className="w-5 h-5 text-accent2-ink" aria-hidden="true" />
                        <span>{label}</span>
                    </button>
                ))}
            </div>
            <div className="mt-5">
                <div className="text-sm font-medium text-t2 mb-3">强调色</div>
                <div className="flex gap-2 flex-wrap" role="group" aria-label="强调色">
                    {ACCENT_PRESETS.map(({ hex, label }) => {
                        const selected = normalizeAccentHex(theme.accentColor) === hex;
                        return (
                            <button
                                key={hex}
                                type="button"
                                aria-pressed={selected}
                                aria-label={`强调色 ${label}`}
                                title={label}
                                onClick={() => setTheme({ accentColor: hex })}
                                className={cn(
                                    'w-8 h-8 rounded-full border-2 border-transparent transition-interactive duration-fast',
                                    'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent2-ring',
                                    selected ? 'scale-110' : 'hover:scale-105',
                                )}
                                style={{
                                    backgroundColor: hex,
                                    /* 选中环 = accent2-ring（boxShadow 方式，与 ThemePicker 一致） */
                                    boxShadow: selected ? '0 0 0 3px var(--v2-accent-ring)' : undefined,
                                }}
                            >
                                {selected && <Check className="w-4 h-4 text-white mx-auto" aria-hidden="true" />}
                            </button>
                        );
                    })}
                </div>
            </div>
        </>
    );
}

export default SettingsPanel;
