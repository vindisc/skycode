/**
 * ConfigStore — 配置状态管理
 * SPEC: §8.3 Store #4
 * 持久化: localStorage (persist middleware)
 * 跨Tab: BroadcastChannel
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist, createJSONStorage } from 'zustand/middleware';
import { subscribeWithSelector } from 'zustand/middleware';
import { broadcastMiddleware } from './broadcastMiddleware';
import { DEFAULT_ACCENT_HEX } from '@/theme/accents';
import type { ThemeConfig, OutputStyleDef, Config } from '@/types';

export interface ConfigStoreState {
    // 状态
    theme: ThemeConfig;
    themePreferenceSet: boolean;
    locale: string;
    autoCompact: { enabled: boolean; threshold: number };
    verbose: boolean;
    expandedView: boolean;
    outputStyle: { availableStyles: OutputStyleDef[]; activeStyleName: string | null };
    defaultModel: string;

    // Actions
    setTheme: (update: Partial<ThemeConfig>) => void;
    resetTheme: () => void;
    setLocale: (locale: string) => void;
    loadConfig: () => Promise<void>;
    saveConfig: (updates: Partial<Config>) => Promise<void>;
    setOutputStyles: (styles: OutputStyleDef[]) => void;
    setActiveOutputStyle: (name: string | null) => void;
}

const DEFAULT_THEME: ThemeConfig = {
    mode: 'light',
    // §3.4：默认强调色为青瓷，单一事实来源在 theme/accents.ts
    accentColor: DEFAULT_ACCENT_HEX,
    fontSize: 'medium',
    fontFamily: 'monospace',
    borderRadius: 'md',
};

/** ThemeConfig 的全部字段；归一时只拾取这些键 */
const THEME_KEYS: readonly (keyof ThemeConfig)[] = ['mode', 'accentColor', 'fontSize', 'fontFamily', 'borderRadius'];

/**
 * 已下线主题的迁移目标：历史 localStorage / 服务端配置 / 旧版本标签页广播里仍可能带着这些值。
 * 浅色系（液态玻璃 / 果冻 / 花果晨）归 light，深色系（灵霄夜 / 星舰 / 蜘蛛爬虫 / 璀璨银河）归 dark。
 */
const RETIRED_THEME_MODES: ReadonlyMap<string, ThemeConfig['mode']> = new Map([
    ['glass', 'light'],
    ['jelly', 'light'],
    ['ink-havoc', 'light'],
    ['ink-havoc-night', 'dark'],
    ['spaceship', 'dark'],
    ['spider', 'dark'],
    ['galaxy', 'dark'],
]);

/**
 * 主题模式归一（所有写入路径的唯一入口：persist 水合 / migrate、setTheme、服务端配置、跨 Tab 广播）。
 * - light / dark 原样返回；
 * - 旧 system 偏好按当前系统外观迁移一次（无法探测时回退浅色）；
 * - 已下线主题按 RETIRED_THEME_MODES 迁到保留主题；
 * - 其余未知值回退 dark（产品默认）。
 */
export function normalizeThemeMode(mode: unknown): ThemeConfig['mode'] {
    if (mode === 'light' || mode === 'dark') return mode;
    if (mode === 'system') {
        const prefersDark = typeof window !== 'undefined'
            && typeof window.matchMedia === 'function'
            && window.matchMedia('(prefers-color-scheme: dark)').matches;
        return prefersDark ? 'dark' : 'light';
    }
    return RETIRED_THEME_MODES.get(mode as string) ?? 'dark';
}

export function normalizeTheme(value: unknown, base: ThemeConfig = DEFAULT_THEME): ThemeConfig {
    const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Partial<ThemeConfig> : {};
    // 字符串形式的 mode 先断言进联合类型，合法性由上方 normalizeThemeMode 白名单兜底
    const update: Partial<ThemeConfig> = typeof value === 'string' ? { mode: value as ThemeConfig['mode'] } : raw;
    // 只拾取仍在使用的外观字段：旧版本持久化里随已下线主题一并删除的特效配置不再进入 state
    const picked = Object.fromEntries(THEME_KEYS.filter((key) => key in update).map((key) => [key, update[key]])) as Partial<ThemeConfig>;
    return {
        ...base,
        ...picked,
        mode: normalizeThemeMode(update.mode ?? base.mode),
    };
}

export const useConfigStore = create<ConfigStoreState>()(
    subscribeWithSelector(
        persist(
            broadcastMiddleware<ConfigStoreState>(
                'ai-coder-config-broadcast',
                (s) => ({
                    theme: s.theme,
                    themePreferenceSet: s.themePreferenceSet,
                    locale: s.locale,
                    autoCompact: s.autoCompact,
                    verbose: s.verbose,
                    expandedView: s.expandedView,
                    outputStyle: s.outputStyle,
                    defaultModel: s.defaultModel,
                }),
                // 其他标签页可能仍跑旧版本：广播来的已下线主题在进入 state 前迁回保留主题
                (s) => (s.theme ? { ...s, theme: normalizeTheme(s.theme) } : s)
            )(
                immer((set) => ({
                theme: { ...DEFAULT_THEME },
                themePreferenceSet: false,
                locale: 'zh-CN',
                autoCompact: { enabled: true, threshold: 80 },
                verbose: false,
                expandedView: false,
                outputStyle: { availableStyles: [] as OutputStyleDef[], activeStyleName: null as string | null },
                defaultModel: 'qwen3.8-max-0902',

                setTheme: (update) => set(d => { d.theme = normalizeTheme(update, d.theme); d.themePreferenceSet = true; }),
                resetTheme: () => set(d => { d.theme = { ...DEFAULT_THEME }; d.themePreferenceSet = true; }),
                setLocale: (locale) => set(d => { d.locale = locale; }),
                loadConfig: async () => {
                    // §8.3 loadConfig 实现: 3 次指数退避 + localStorage 降级
                    const RETRY_COUNT = 3;
                    const BASE_DELAY = 300;
                    for (let i = 0; i <= RETRY_COUNT; i++) {
                        try {
                            const resp = await fetch('/api/config');
                            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                            const config = await resp.json();
                            set(d => {
                                // 用户在本机选择的外观优先，避免刷新时被服务端默认主题覆盖。
                                if (config.theme && !d.themePreferenceSet) {
                                    // 服务端主题可为模式字符串或完整配置。
                                    d.theme = normalizeTheme(config.theme, d.theme);
                                }
                                if (config.locale) d.locale = config.locale;
                                if (config.autoCompact) d.autoCompact = config.autoCompact;
                                if (config.verbose !== undefined) d.verbose = config.verbose;
                                if (config.expandedView !== undefined) d.expandedView = config.expandedView;
                                if (config.outputStyle) d.outputStyle = config.outputStyle;
                                if (config.defaultModel) d.defaultModel = config.defaultModel;
                            });
                            localStorage.setItem('config_cache', JSON.stringify(config));
                            return;
                        } catch {
                            if (i < RETRY_COUNT) {
                                await new Promise(r => setTimeout(r, BASE_DELAY * Math.pow(2, i)));
                            }
                        }
                    }
                    // 降级使用 localStorage 缓存
                    const cached = localStorage.getItem('config_cache');
                    if (cached) {
                        try {
                            const config = JSON.parse(cached);
                            set(d => {
                                // 用户在本机选择的外观优先，避免刷新时被服务端默认主题覆盖。
                                if (config.theme && !d.themePreferenceSet) {
                                    // 服务端主题可为模式字符串或完整配置。
                                    d.theme = normalizeTheme(config.theme, d.theme);
                                }
                                if (config.locale) d.locale = config.locale;
                                if (config.autoCompact) d.autoCompact = config.autoCompact;
                                if (config.verbose !== undefined) d.verbose = config.verbose;
                                if (config.expandedView !== undefined) d.expandedView = config.expandedView;
                                if (config.outputStyle) d.outputStyle = config.outputStyle;
                                if (config.defaultModel) d.defaultModel = config.defaultModel;
                            });
                            return;
                        } catch { /* ignore parse error */ }
                    }
                    console.warn('[ConfigStore] loadConfig failed, using defaults');
                },
                saveConfig: async (updates) => {
                    // P2-11: try-catch + 回滚
                    const prevState = useConfigStore.getState();
                    if (updates.theme !== undefined) updates = { ...updates, theme: normalizeTheme(updates.theme, prevState.theme) };
                    const snapshot = {
                        theme: prevState.theme,
                        locale: prevState.locale,
                        autoCompact: prevState.autoCompact,
                        verbose: prevState.verbose,
                        expandedView: prevState.expandedView,
                        outputStyle: prevState.outputStyle,
                        defaultModel: prevState.defaultModel,
                    };
                    set(d => { Object.assign(d, updates); });
                    try {
                        const resp = await fetch('/api/config', {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(updates),
                        });
                        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                    } catch (e) {
                        // 回滚到之前的状态
                        set(d => { Object.assign(d, snapshot); });
                        console.error('[ConfigStore] saveConfig failed, rolled back:', e);
                    }
                },
                setOutputStyles: (styles) => set(d => { d.outputStyle.availableStyles = styles; }),
                setActiveOutputStyle: (name) => set(d => { d.outputStyle.activeStyleName = name; }),
            }))
            ),
            {
                name: 'ai-coder-config',
                storage: createJSONStorage(() => localStorage),
                partialize: (s) => ({
                    theme: s.theme,
                    themePreferenceSet: s.themePreferenceSet,
                    locale: s.locale,
                    autoCompact: s.autoCompact,
                    verbose: s.verbose,
                    expandedView: s.expandedView,
                    outputStyle: s.outputStyle,
                    defaultModel: s.defaultModel,
                }),
                // v4：主题只剩 light / dark。版本号前移让 v3 及更早的持久化状态都走一次 migrate，
                // 归一结果由 persist 立即写回 localStorage，旧主题值不再残留到下次加载。
                version: 4,
                migrate: (persisted: unknown, version: number) => {
                    const data = (persisted ?? {}) as Record<string, unknown>;
                    if (version <= 1) {
                        return {
                            ...data,
                            // §3.4/§9.6：兜底默认与 DEFAULT_THEME 统一为靛蓝
                            theme: normalizeTheme(data.theme),
                            autoCompact: (data.autoCompact as Record<string, unknown>) ?? { enabled: true, threshold: 80 },
                            expandedView: data.expandedView ?? false,
                            outputStyle: data.outputStyle ?? { availableStyles: [], activeStyleName: null },
                        };
                    }
                    // 已下线主题迁到保留主题；随主题删除的特效配置不再保留
                    return { ...data, theme: normalizeTheme(data.theme) };
                },
                merge: (persisted, current) => {
                    const data = persisted as Partial<ConfigStoreState> | undefined;
                    return { ...current, ...data, theme: normalizeTheme(data?.theme ?? current.theme) };
                },
            }
        )
    )
);
