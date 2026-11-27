import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemePicker } from '@/components/theme/ThemePicker';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { ACCENT_PRESETS, DEFAULT_ACCENT_HEX } from '@/theme/accents';
import { useConfigStore } from '@/store/configStore';
import type { ThemeConfig } from '@/types';

/** 已下线主题 → 保留主题的迁移表（浅色系归 light，深色系归 dark） */
const RETIRED: Record<string, 'light' | 'dark'> = {
    glass: 'light',
    jelly: 'light',
    'ink-havoc': 'light',
    'ink-havoc-night': 'dark',
    spaceship: 'dark',
    spider: 'dark',
    galaxy: 'dark',
};

/** 未经 store 归一、直接进入运行态的旧值：渲染层仍需落到保留主题，其余未知值回退 dark */
const LEGACY_RUNTIME_MODES: [unknown, 'light' | 'dark'][] = [
    ...Object.entries(RETIRED),
    ['unknown', 'dark'],
    ['constructor', 'dark'],
    ['', 'dark'],
    [null, 'dark'],
    [{}, 'dark'],
];

const BASE_THEME: ThemeConfig = {
    mode: 'light', accentColor: DEFAULT_ACCENT_HEX, fontSize: 'medium', fontFamily: 'monospace', borderRadius: 'md',
};

const root = () => document.documentElement;

function setRuntimeMode(mode: unknown) {
    act(() => {
        useConfigStore.setState({ theme: { ...useConfigStore.getState().theme, mode } as unknown as ThemeConfig });
    });
}

function accentOf(mode: 'light' | 'dark') {
    const preset = ACCENT_PRESETS.find(p => p.hex === DEFAULT_ACCENT_HEX)!;
    return preset[mode];
}

beforeEach(() => {
    root().className = '';
    useConfigStore.setState({ theme: { ...BASE_THEME } });
});

afterEach(() => {
    vi.unstubAllGlobals();
    root().className = '';
});

describe('ThemeProvider', () => {
    it.each(['light', 'dark'] as const)('%s：html 只带该主题 class，并写入对应档的强调色令牌', mode => {
        render(<ThemeProvider><span>内容</span></ThemeProvider>);
        setRuntimeMode(mode);
        expect(root().className).toBe(mode);
        const style = root().style;
        expect(style.getPropertyValue('--v2-accent')).toBe(accentOf(mode).accent);
        expect(style.getPropertyValue('--v2-accent-strong')).toBe(accentOf(mode).strong);
        expect(style.getPropertyValue('--v2-accent-soft')).toBe(accentOf(mode).soft);
        expect(style.getPropertyValue('--v2-accent-ring')).toBe(accentOf(mode).ring);
        // 深底主题 ink 取 accent 提亮一档（默认蓝直接作小字对比度不够）；浅底由 strong 压暗
        const ink = style.getPropertyValue('--v2-accent-ink');
        if (mode === 'dark') expect(ink).toBe(`color-mix(in srgb, ${accentOf(mode).accent} 72%, white)`);
        else expect(ink).toContain(accentOf(mode).strong);
    });

    it('切换主题时旧 class 对称移除（含历史 system 偏好），无残留', () => {
        useConfigStore.setState({ theme: { ...BASE_THEME, mode: 'dark' } });
        root().classList.add('system');
        render(<ThemeProvider><span>内容</span></ThemeProvider>);
        expect(root().className).toBe('dark');
        setRuntimeMode('light');
        expect(root().className).toBe('light');
        setRuntimeMode('dark');
        expect(root().className).toBe('dark');
    });

    it.each(LEGACY_RUNTIME_MODES)('运行态出现未归一的旧主题 %j 时按 %s 渲染，不出现无主题页面', (mode, expected) => {
        useConfigStore.setState({ theme: { ...BASE_THEME, mode: expected === 'dark' ? 'light' : 'dark' } });
        render(<ThemeProvider><span>内容</span></ThemeProvider>);
        setRuntimeMode(mode);
        expect(root().className).toBe(expected);
        expect(root().style.getPropertyValue('--v2-accent')).toBe(accentOf(expected).accent);
    });

    it('旧 system 偏好按系统外观落类', () => {
        render(<ThemeProvider><span>内容</span></ThemeProvider>);
        vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
        setRuntimeMode('system');
        expect(root().className).toBe('dark');
        vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
        setRuntimeMode('light');
        setRuntimeMode('system');
        expect(root().className).toBe('light');
    });
});

describe('主题入口只提供两个保留主题', () => {
    it('ThemePicker：主题模式恰为 浅色 / 深色，8 个强调色均可选', () => {
        render(<ThemeProvider><ThemePicker /></ThemeProvider>);
        const modes = within(screen.getByRole('group', { name: '主题' })).getAllByRole('button');
        expect(modes.map(button => button.textContent)).toEqual(['浅色', '深色']);
        const accents = within(screen.getByRole('group', { name: '强调色' })).getAllByRole('button');
        expect(accents).toHaveLength(ACCENT_PRESETS.length);
        accents.forEach(button => expect(button).toBeEnabled());
        fireEvent.click(accents[1]);
        expect(useConfigStore.getState().theme.accentColor).toBe(ACCENT_PRESETS[1].hex);
    });
});
