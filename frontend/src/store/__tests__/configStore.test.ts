import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { normalizeTheme, normalizeThemeMode, useConfigStore } from '../configStore';
import type { ThemeConfig } from '@/types';

/** 已下线主题 → 保留主题的迁移表（浅色系归 light，深色系归 dark） */
const RETIRED_MODES = [
    ['glass', 'light'], ['jelly', 'light'], ['ink-havoc', 'light'],
    ['ink-havoc-night', 'dark'], ['spaceship', 'dark'], ['spider', 'dark'], ['galaxy', 'dark'],
] as const;

describe('ConfigStore', () => {
    beforeEach(() => {
        // Reset to defaults（§3.4/§9.6：默认强调色 = 青瓷 #12967F）
        useConfigStore.setState({
            themePreferenceSet: false,
            theme: {
                mode: 'light',
                accentColor: '#12967F',
                fontSize: 'medium',
                fontFamily: 'monospace',
                borderRadius: 'md',
            },
            locale: 'zh-CN',
            autoCompact: { enabled: true, threshold: 80 },
            verbose: false,
            expandedView: false,
            outputStyle: { availableStyles: [], activeStyleName: null },
            defaultModel: 'qwen3.6-plus',
        });
    });

    afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

    it.each([1, 2, 3])('rehydrates v%s system preferences using the current OS theme', async version => {
        vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
        localStorage.setItem('ai-coder-config', JSON.stringify({ version, state: {
            theme: version === 1 ? 'system' : { mode: 'system', accentColor: '#ff0000' },
            locale: 'en-US',
        } }));
        await useConfigStore.persist.rehydrate();
        expect(useConfigStore.getState().theme.mode).toBe('dark');
        expect(useConfigStore.getState().locale).toBe('en-US');
        expect(useConfigStore.getState().theme.fontSize).toBe('medium');
        if (version > 1) expect(useConfigStore.getState().theme.accentColor).toBe('#ff0000');
    });

    it.each(['light', 'dark', 'unknown'])('normalizes persisted mode %s without losing other appearance fields', async mode => {
        localStorage.setItem('ai-coder-config', JSON.stringify({ version: 2, state: {
            theme: { mode, accentColor: '#123456', fontSize: 'large' },
        } }));
        await useConfigStore.persist.rehydrate();
        expect(useConfigStore.getState().theme).toMatchObject({
            // 未知值回退产品默认 dark
            mode: mode === 'unknown' ? 'dark' : mode, accentColor: '#123456', fontSize: 'large',
        });
    });

    it.each(RETIRED_MODES)('migrates retired persisted theme %s to %s and drops retired effect settings', async (mode, expected) => {
        localStorage.setItem('ai-coder-config', JSON.stringify({ version: 3, state: {
            theme: {
                mode, accentColor: '#C9578A', fontSize: 'large', fontFamily: 'monospace', borderRadius: 'lg',
                // 旧版本随主题持久化的特效配置：不再进入 state
                spaceshipFx: { cinematic: true, eventFx: true, motion: 'full' },
                inkHavocFx: { cinematic: true, motion: 'full', retreat: true },
                jellyFx: { cinematic: true, motion: 'full' },
            },
            themePreferenceSet: true,
        } }));
        await useConfigStore.persist.rehydrate();
        const theme = { mode: expected, accentColor: '#C9578A', fontSize: 'large', fontFamily: 'monospace', borderRadius: 'lg' };
        expect(useConfigStore.getState().theme).toEqual(theme);
        // 本机已选过外观：迁移后仍优先于服务端主题
        expect(useConfigStore.getState().themePreferenceSet).toBe(true);
        // 迁移结果立即写回（版本号推进到当前值），下次加载不再携带已下线主题
        expect(JSON.parse(localStorage.getItem('ai-coder-config')!)).toMatchObject({ version: 4, state: { theme } });
    });

    it.each([1, 2])('migrates retired persisted theme from persist schema v%s and rewrites storage at the current version', async version => {
        localStorage.setItem('ai-coder-config', JSON.stringify({ version, state: {
            theme: { mode: 'ink-havoc', accentColor: '#2589D6', fontSize: 'large', inkHavocFx: { cinematic: true, motion: 'full', retreat: false } },
        } }));
        await useConfigStore.persist.rehydrate();
        expect(useConfigStore.getState().theme).toEqual({ ...normalizeTheme({ mode: 'light' }), mode: 'light', accentColor: '#2589D6', fontSize: 'large' });
        expect(JSON.parse(localStorage.getItem('ai-coder-config')!)).toMatchObject({ version: 4, state: { theme: { mode: 'light', accentColor: '#2589D6' } } });
    });

    it.each([undefined, null, '', 'constructor', 'toString', '__proto__', {}].map(value => [value]))('normalizeThemeMode falls back to dark for unrecognized value %j', mode => {
        expect(normalizeThemeMode(mode)).toBe('dark');
    });

    it('normalizeThemeMode keeps light / dark and resolves the legacy system preference from the OS', () => {
        expect(normalizeThemeMode('light')).toBe('light');
        expect(normalizeThemeMode('dark')).toBe('dark');
        vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
        expect(normalizeThemeMode('system')).toBe('dark');
        vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
        expect(normalizeThemeMode('system')).toBe('light');
    });

    it('normalizeTheme keeps unknown keys out of the theme state', () => {
        const theme = normalizeTheme({ mode: 'dark', accentColor: '#2589D6', jellyFx: { cinematic: true, motion: 'full' } } as unknown);
        expect(Object.keys(theme).sort()).toEqual(['accentColor', 'borderRadius', 'fontFamily', 'fontSize', 'mode']);
        expect(theme).toMatchObject({ mode: 'dark', accentColor: '#2589D6' });
    });

    it.each([['glass', 'light'], ['ink-havoc', 'light'], ['galaxy', 'dark'], ['nonsense', 'dark']] as const)('setTheme normalizes mode %s to %s and persists the result', (mode, expected) => {
        useConfigStore.getState().setTheme({ mode: mode as ThemeConfig['mode'] });
        expect(useConfigStore.getState().theme.mode).toBe(expected);
        expect(JSON.parse(localStorage.getItem('ai-coder-config')!).state.theme.mode).toBe(expected);
    });

    it.each(['system', { mode: 'system' }])('normalizes server theme %j', async theme => {
        vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ theme }) }));
        await useConfigStore.getState().loadConfig();
        expect(useConfigStore.getState().theme).toMatchObject({ mode: 'light', fontSize: 'medium' });
    });

    it.each(['unknown', { mode: 'unknown' }])('falls back to dark for unrecognized server theme %j', async theme => {
        vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ theme }) }));
        await useConfigStore.getState().loadConfig();
        expect(useConfigStore.getState().theme).toMatchObject({ mode: 'dark', fontSize: 'medium' });
    });

    it.each(RETIRED_MODES)('server theme %s (string or object) is migrated to %s before entering state', async (mode, expected) => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ theme: mode }) }));
        await useConfigStore.getState().loadConfig();
        // 字符串形式：只换模式，其余外观沿用当前值
        expect(useConfigStore.getState().theme).toEqual({ ...normalizeTheme({ mode: expected }), mode: expected });

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ theme: { mode, accentColor: '#C9578A', fontSize: 'large' } }) }));
        await useConfigStore.getState().loadConfig();
        // 完整配置形式：保留服务端给的外观偏好，模式仍迁到保留主题
        expect(useConfigStore.getState().theme).toEqual({ ...normalizeTheme({ mode: expected }), mode: expected, accentColor: '#C9578A', fontSize: 'large' });
    });

    it('migrates a retired theme from the cached server config after all network retries fail', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
        localStorage.setItem('config_cache', JSON.stringify({ theme: { mode: 'galaxy', accentColor: '#2589D6' } }));
        const loading = useConfigStore.getState().loadConfig();
        await vi.runAllTimersAsync();
        await loading;
        expect(useConfigStore.getState().theme).toMatchObject({ mode: 'dark', accentColor: '#2589D6' });
    });

    it('keeps the locally chosen theme when the server still returns a retired theme', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ theme: 'spaceship' }) }));
        useConfigStore.getState().setTheme({ mode: 'light' });
        await useConfigStore.getState().loadConfig();
        expect(useConfigStore.getState().theme.mode).toBe('light');
    });

    it('normalizes cached system theme after all network retries fail', async () => {
        vi.useFakeTimers();
        vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
        localStorage.setItem('config_cache', JSON.stringify({ theme: { mode: 'system' } }));
        const loading = useConfigStore.getState().loadConfig();
        await vi.runAllTimersAsync();
        await loading;
        expect(useConfigStore.getState().theme).toMatchObject({ mode: 'dark', fontSize: 'medium' });
    });

    it('keeps a locally chosen light theme when the server returns a fixed dark theme', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ theme: 'dark' }) }));
        useConfigStore.getState().setTheme({ mode: 'light' });
        await useConfigStore.getState().loadConfig();
        expect(useConfigStore.getState().theme.mode).toBe('light');
        expect(JSON.parse(localStorage.getItem('ai-coder-config')!).state.themePreferenceSet).toBe(true);
    });

    it('uses the server theme until the user chooses an appearance', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ theme: 'dark' }) }));
        await useConfigStore.getState().loadConfig();
        expect(useConfigStore.getState().theme.mode).toBe('dark');
    });

    it('should have default theme', () => {
        const { theme } = useConfigStore.getState();
        expect(theme.mode).toBe('light');
        expect(theme.accentColor).toBe('#12967F');
        expect(theme.fontSize).toBe('medium');
    });

    it('setTheme updates theme partially', () => {
        useConfigStore.getState().setTheme({ mode: 'dark' });
        const { theme } = useConfigStore.getState();
        expect(theme.mode).toBe('dark');
        expect(theme.accentColor).toBe('#12967F'); // unchanged
    });

    it('resetTheme restores defaults', () => {
        useConfigStore.getState().setTheme({ mode: 'dark', accentColor: '#ff0000' });
        useConfigStore.getState().resetTheme();
        const { theme } = useConfigStore.getState();
        expect(theme.mode).toBe('light');
        // §9.6：默认强调色已改靛蓝
        expect(theme.accentColor).toBe('#12967F');
    });

    it('setLocale updates locale', () => {
        useConfigStore.getState().setLocale('en-US');
        expect(useConfigStore.getState().locale).toBe('en-US');
    });

    it('default model is set', () => {
        expect(useConfigStore.getState().defaultModel).toBe('qwen3.6-plus');
    });

    it('setOutputStyles updates available styles', () => {
        const styles = [
            { name: 'concise', description: 'Brief responses', systemPrompt: 'Be concise' },
        ];
        useConfigStore.getState().setOutputStyles(styles as any);
        expect(useConfigStore.getState().outputStyle.availableStyles).toHaveLength(1);
    });

    it('setActiveOutputStyle updates active style', () => {
        useConfigStore.getState().setActiveOutputStyle('concise');
        expect(useConfigStore.getState().outputStyle.activeStyleName).toBe('concise');
    });
});
