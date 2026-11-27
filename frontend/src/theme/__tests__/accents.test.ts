import { beforeEach, describe, expect, it } from 'vitest';
import {
    ACCENT_PRESETS,
    applyAccent,
    DEFAULT_ACCENT_HEX,
    normalizeAccentHex,
} from '../accents';

const TOKENS = ['--v2-accent', '--v2-accent-strong', '--v2-accent-soft', '--v2-accent-ring'] as const;

function readTokens() {
    const style = document.documentElement.style;
    return Object.fromEntries(TOKENS.map(t => [t, style.getPropertyValue(t).trim()]));
}

beforeEach(() => {
    TOKENS.forEach(t => document.documentElement.style.removeProperty(t));
});

describe('ACCENT_PRESETS 色板构成', () => {
    it('8 色按色相序排列，青瓷为默认且居首', () => {
        expect(ACCENT_PRESETS.map(p => p.label)).toEqual(['青瓷', '冰青', '蔚蓝', '靛蓝', '藤紫', '紫罗兰', '品红', '石墨']);
        expect(ACCENT_PRESETS[0].hex).toBe(DEFAULT_ACCENT_HEX);
    });

    it('每色两档齐全（light / dark）', () => {
        for (const p of ACCENT_PRESETS) {
            expect(p.light.accent).toMatch(/^#/);
            expect(p.light.strong).toMatch(/^#/);
            expect(p.dark.accent).toMatch(/^#/);
            expect(p.dark.strong).toMatch(/^#/);
            expect(p.dark.soft).toMatch(/^rgba\(/);
        }
    });

    it('与语义色冲突的旧色（红/绿/橙）及旧靛蓝已移出预设', () => {
        const hexes = ACCENT_PRESETS.map(p => p.hex);
        expect(hexes).not.toContain('#C4453F');
        expect(hexes).not.toContain('#4E9E73');
        expect(hexes).not.toContain('#C98A3A');
        expect(hexes).not.toContain('#4C86C8');
        expect(hexes).not.toContain('#5E63DE');
    });
});

describe('normalizeAccentHex 旧值映射', () => {
    it('被砍色映射到最接近的保留色', () => {
        expect(normalizeAccentHex('#4C86C8')).toBe('#2589D6'); // 灰蓝 → 蔚蓝
        expect(normalizeAccentHex('#C4453F')).toBe('#C9578A'); // 红 → 品红
        expect(normalizeAccentHex('#C98A3A')).toBe('#12967F'); // 橙 → 青瓷（默认）
        expect(normalizeAccentHex('#4E9E73')).toBe('#12967F'); // 绿 → 青瓷（默认）
        expect(normalizeAccentHex('#5E63DE')).toBe('#5B6BE0'); // 灰调靛蓝 → A 稿基准
    });

    it('初版 Tailwind 色直达新色（无链式中转）', () => {
        expect(normalizeAccentHex('#3B82F6')).toBe('#2589D6');
        expect(normalizeAccentHex('#6366F1')).toBe('#5B6BE0');
        expect(normalizeAccentHex('#EF4444')).toBe('#C9578A');
    });

    it('大小写不敏感；未知值原样返回', () => {
        expect(normalizeAccentHex('#2589d6')).toBe('#2589D6');
        expect(normalizeAccentHex('#123456')).toBe('#123456');
    });
});

describe('applyAccent 两主题分档', () => {
    it('light 档：写入 light 全套令牌', () => {
        applyAccent('#12967F', 'light');
        expect(readTokens()).toEqual({
            '--v2-accent': '#12967F',
            '--v2-accent-strong': '#0C7563',
            '--v2-accent-soft': 'rgba(18,150,127,.10)',
            '--v2-accent-ring': 'rgba(18,150,127,.32)',
        });
    });

    it('dark 档：accent 取亮变体，strong 是同色相的深一档（不再复用 light 的墨绿）', () => {
        applyAccent('#12967F', 'dark');
        const t = readTokens();
        expect(t['--v2-accent']).toBe('#7FD4E8');
        expect(t['--v2-accent-strong']).toBe('#1A7C93');
        expect(t['--v2-accent-soft']).toBe('rgba(127,212,232,.14)');
    });

    it('新色蔚蓝：两档各自正确', () => {
        applyAccent('#2589D6', 'light');
        expect(readTokens()['--v2-accent']).toBe('#2589D6');
        expect(readTokens()['--v2-accent-strong']).toBe('#1A6BA8');
        applyAccent('#2589D6', 'dark');
        expect(readTokens()['--v2-accent']).toBe('#74B9EE');
    });

    it('新色石墨：dark 档亮灰蓝', () => {
        applyAccent('#566678', 'dark');
        expect(readTokens()['--v2-accent']).toBe('#9AA8BC');
    });

    it('新色藤紫（C 稿薄藤紫 accent）：两档正确，dark 为亮紫', () => {
        applyAccent('#7B61E8', 'light');
        expect(readTokens()['--v2-accent']).toBe('#7B61E8');
        expect(readTokens()['--v2-accent-strong']).toBe('#6B4EE0');
        applyAccent('#7B61E8', 'dark');
        expect(readTokens()['--v2-accent']).toBe('#A78BFA');
    });

    it('新色冰青（D 稿柔夜墨蓝 accent）：dark 档呈现原色，浅色档为可读深青', () => {
        applyAccent('#7FD4E8', 'light');
        expect(readTokens()['--v2-accent']).toBe('#2492AC');
        expect(readTokens()['--v2-accent-strong']).toBe('#1A6E84');
        applyAccent('#7FD4E8', 'dark');
        expect(readTokens()['--v2-accent']).toBe('#7FD4E8');
        expect(readTokens()['--v2-accent-soft']).toBe('rgba(127,212,232,.14)');
    });

    it('靛蓝采纳 A 稿基准 #5B6BE0，旧值 #5E63DE 经映射落入', () => {
        applyAccent('#5B6BE0', 'light');
        expect(readTokens()['--v2-accent']).toBe('#5B6BE0');
        applyAccent('#5E63DE', 'light');
        expect(readTokens()['--v2-accent']).toBe('#5B6BE0');
    });

    it('持久化的被砍色经映射落到新色（蓝→蔚蓝）', () => {
        applyAccent('#4C86C8', 'light');
        expect(readTokens()['--v2-accent']).toBe('#2589D6');
    });

    it('未知 hex 回退默认青瓷', () => {
        applyAccent('#123456', 'light');
        expect(readTokens()['--v2-accent']).toBe('#12967F');
    });

    it('dark 档 accent-ink 用 accent 本体；light 用 strong 派生', () => {
        applyAccent('#12967F', 'dark');
        expect(document.documentElement.style.getPropertyValue('--v2-accent-ink').trim()).toBe('#7FD4E8');
        applyAccent('#12967F', 'light');
        expect(document.documentElement.style.getPropertyValue('--v2-accent-ink').trim()).toContain('#0C7563');
    });
});

describe('深色档主按钮的可辨识度（防回归）', () => {
    // WCAG 相对亮度与对比度
    const channel = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const luminance = (hex: string) => {
        const [r, g, b] = [1, 3, 5].map(i => channel(parseInt(hex.slice(i, i + 2), 16)));
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a: string, b: string) => {
        const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
        return (hi + 0.05) / (lo + 0.05);
    };
    const DARK_SURFACE = '#1E2430'; // --v2-bg-surface 深色值

    it('每色的深色按钮：白字 ≥4.5:1，对深色面 ≥3:1', () => {
        for (const p of ACCENT_PRESETS) {
            expect(contrast('#FFFFFF', p.dark.strong), p.label).toBeGreaterThanOrEqual(4.5);
            expect(contrast(p.dark.strong, DARK_SURFACE), p.label).toBeGreaterThanOrEqual(3);
        }
    });

    it('深色按钮与深色高亮文字同色相（色相差 ≤ 12°）', () => {
        const hue = (hex: string) => {
            const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
            const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
            if (d === 0) return 0;
            const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
            return h * 60;
        };
        const gap = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
        for (const p of ACCENT_PRESETS) {
            // 石墨饱和度低，色相没有意义，不参与
            if (p.label === '石墨') continue;
            expect(gap(hue(p.dark.accent), hue(p.dark.strong)), p.label).toBeLessThanOrEqual(12);
        }
    });
});
