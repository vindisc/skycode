/**
 * accents.ts — 强调色机制（指南 §3.4 终值表，P1b；2026-09 精简和谐版）
 *
 * ACCENT_PRESETS：6 色 × { light, dark } 两套主题令牌组。
 * 选色原则：与语义色（ok 绿 / warn 橙 / err 红）拉开色相，避免状态误读；
 * 色板内部色相间距 ≥30°，明度统一，白底对比度 ≥3:1（UI 组件级）。
 * - light：accent / strong（白字 ≥4.5:1）/ soft 底（10%）/ ring 环（32%）
 * - dark：accent 取表中 Dark 基准；strong 是与之同色相的深一档（不再复用 light 的墨绿——
 *   否则深色下按钮与高亮文字是两个色相）；soft 14% / ring 40%（取 dark accent 的 RGB 通道）
 *
 * applyAccent(hex, effectiveTheme)：向 documentElement.style 写入
 * --v2-accent / --v2-accent-strong / --v2-accent-soft / --v2-accent-ring。
 * --v2-accent-hover / --v2-accent-active 已由 CSS color-mix(var(--v2-accent-strong))
 * 派生（globals.css），无需写入。未知 hex 一律回退青瓷（默认色）。
 */

export type EffectiveTheme = 'light' | 'dark';

export interface AccentLightValues {
    accent: string;
    strong: string;
    soft: string;
    ring: string;
}

/** dark 档。strong 是与 accent 同色相的按钮填充色：深色档按相对亮度 0.168 取值
 *  （白字 4.82:1、对深色面 3.23:1）；soft / ring 取该档 accent 的 RGB */
export interface AccentVariantValues {
    accent: string;
    strong: string;
    soft: string;
    ring: string;
}

export interface AccentPreset {
    /** 与 ThemePicker 持久化的 theme.accentColor 严格对应（大写 hex） */
    hex: string;
    label: string;
    light: AccentLightValues;
    dark: AccentVariantValues;
}

export const DEFAULT_ACCENT_HEX = '#2F7BFF';

/** 旧版预设 hex → 新版预设 hex（持久化的 theme.accentColor 兼容映射，大写） */
export const LEGACY_ACCENT_ALIASES: Readonly<Record<string, string>> = {
    // 初版 Tailwind 鲜艳色 → 现行基准（直达，避免链式中转断链）
    '#6366F1': '#5B6BE0',
    '#8B5CF6': '#8A63C9',
    '#EC4899': '#C9578A',
    '#3B82F6': '#2589D6',
    '#F59E0B': '#2F7BFF',
    '#10B981': '#2F7BFF',
    '#EF4444': '#C9578A',
    // 灰调版中被精简掉的语义冲突色 → 最接近的保留色
    '#C98A3A': '#2F7BFF', // 橙（与 warn 冲突）→ 系统蓝（默认）
    '#4E9E73': '#2F7BFF', // 绿（与 ok 冲突）→ 系统蓝（默认）
    // 上一版默认青瓷 → 现行默认系统蓝（与 Skymap 一致）
    '#12967F': '#2F7BFF',
    '#C4453F': '#C9578A', // 红（与 err 冲突）→ 品红（暖色系最近）
    '#4C86C8': '#2589D6', // 灰蓝 → 蔚蓝（直系升级）
    // 灰调版靛蓝 → A 稿基准（云白冰川 #5B6BE0）
    '#5E63DE': '#5B6BE0',
};

/** 归一化强调色：大写 + 旧值映射；空值与未知值原样返回（由 applyAccent 回退默认） */
export function normalizeAccentHex(hex: string | undefined | null): string {
    const upper = (hex ?? '').toUpperCase();
    return LEGACY_ACCENT_ALIASES[upper] ?? upper;
}

export const ACCENT_PRESETS: readonly AccentPreset[] = [
    {
        // 默认色与 Skymap 的 Accent Blue 相同；深色档的 strong 略深一档，保证白字 ≥4.5:1
        hex: '#2F7BFF', label: '系统蓝',
        light: { accent: '#1F63D6', strong: '#1A56BE', soft: 'rgba(31,99,214,.10)', ring: 'rgba(31,99,214,.32)' },
        dark: { accent: '#2F7BFF', strong: '#2A6FE8', soft: 'rgba(47,123,255,.16)', ring: 'rgba(47,123,255,.45)' },
    },
    {
        // 柔夜墨蓝稿（D）的 accent #7FD4E8 为深底亮色：light 档必须配深变体（白底 ≥3:1）
        hex: '#7FD4E8', label: '冰青',
        light: { accent: '#2492AC', strong: '#1A6E84', soft: 'rgba(36,146,172,.10)', ring: 'rgba(36,146,172,.32)' },
        dark: { accent: '#7FD4E8', strong: '#1A7C93', soft: 'rgba(127,212,232,.14)', ring: 'rgba(127,212,232,.40)' },
    },
    {
        hex: '#2589D6', label: '蔚蓝',
        light: { accent: '#2589D6', strong: '#1A6BA8', soft: 'rgba(37,137,214,.10)', ring: 'rgba(37,137,214,.32)' },
        dark: { accent: '#74B9EE', strong: '#1776BE', soft: 'rgba(116,185,238,.14)', ring: 'rgba(116,185,238,.40)' },
    },
    {
        // 基准值采纳云白冰川稿（A）的 #5B6BE0（与旧 #5E63DE 肉眼不可辨，旧值经 LEGACY 映射）
        hex: '#5B6BE0', label: '靛蓝',
        light: { accent: '#5B6BE0', strong: '#5054C8', soft: 'rgba(91,107,224,.10)', ring: 'rgba(91,107,224,.32)' },
        dark: { accent: '#8A8FF0', strong: '#5B62EA', soft: 'rgba(138,143,240,.14)', ring: 'rgba(138,143,240,.40)' },
    },
    {
        // 薄藤紫稿（C）的 accent：AI 品牌紫调，与紫罗兰同族但更鲜亮
        hex: '#7B61E8', label: '藤紫',
        light: { accent: '#7B61E8', strong: '#6B4EE0', soft: 'rgba(123,97,232,.10)', ring: 'rgba(123,97,232,.32)' },
        dark: { accent: '#A78BFA', strong: '#7B51F7', soft: 'rgba(167,139,250,.14)', ring: 'rgba(167,139,250,.40)' },
    },
    {
        hex: '#8A63C9', label: '紫罗兰',
        light: { accent: '#8A63C9', strong: '#7451B5', soft: 'rgba(138,99,201,.10)', ring: 'rgba(138,99,201,.32)' },
        dark: { accent: '#B58CD6', strong: '#974FD0', soft: 'rgba(181,140,214,.14)', ring: 'rgba(181,140,214,.40)' },
    },
    {
        hex: '#C9578A', label: '品红',
        light: { accent: '#C9578A', strong: '#B34677', soft: 'rgba(201,87,138,.10)', ring: 'rgba(201,87,138,.32)' },
        dark: { accent: '#E58AB5', strong: '#D02E7B', soft: 'rgba(229,138,181,.14)', ring: 'rgba(229,138,181,.40)' },
    },
    {
        hex: '#566678', label: '石墨',
        light: { accent: '#566678', strong: '#42506A', soft: 'rgba(86,102,120,.10)', ring: 'rgba(86,102,120,.32)' },
        dark: { accent: '#9AA8BC', strong: '#5F7390', soft: 'rgba(154,168,188,.14)', ring: 'rgba(154,168,188,.40)' },
    },
];

/**
 * applyAccent — 根节点一次性写入 4 个 v2 强调色令牌（§3.4）
 * @param hex 持久化的强调色（theme.accentColor），大小写不敏感；未知值回退青瓷
 * @param effectiveTheme 有效主题（light / dark 各有一档 accent）
 */
export function applyAccent(hex: string, effectiveTheme: EffectiveTheme): void {
    const normalized = normalizeAccentHex(hex);
    const preset = ACCENT_PRESETS.find((p) => p.hex === normalized) ?? ACCENT_PRESETS[0];
    const values: AccentLightValues = effectiveTheme === 'dark' ? preset.dark : preset.light;
    const style = document.documentElement.style;
    style.setProperty('--v2-accent', values.accent);
    // 深底主题（dark）accent 本身即亮色调，ink 直接取 accent；浅底取 strong 压暗
    // 深底上的强调文字取 accent 提亮一档：默认的 #2F7BFF 直接作小字在卡片底上只有 4.2:1，提亮后 ≥6:1
    style.setProperty('--v2-accent-ink', effectiveTheme === 'dark' ? `color-mix(in srgb, ${values.accent} 72%, white)` : `color-mix(in srgb, ${values.strong} 80%, black)`);
    style.setProperty('--v2-accent-strong', values.strong);
    style.setProperty('--v2-accent-soft', values.soft);
    style.setProperty('--v2-accent-ring', values.ring);
}
