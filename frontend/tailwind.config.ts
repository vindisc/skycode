import type { Config } from 'tailwindcss';

export default {
    content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
    darkMode: 'class',
    theme: {
        screens: {
            'sm': '640px',
            'md': '768px',
            'lg': '1024px',
            'xl': '1280px',
            '2xl': '1536px',
        },
        extend: {
            colors: {
                surface: {
                    DEFAULT: 'var(--color-surface)',
                    elevated: 'var(--color-surface-elevated)',
                    sunken: 'var(--color-surface-sunken)',
                },
                danger: { DEFAULT: 'var(--v2-err)', muted: 'var(--v2-err-strong)' },
                warning: { DEFAULT: 'var(--v2-warn)', muted: 'var(--v2-warn-strong)' },
                success: { DEFAULT: 'var(--v2-ok)', muted: 'var(--v2-ok-strong)' },
                muted: 'var(--color-muted)',
                border: 'var(--color-border)',
                /* ===== v2 令牌映射（新增 key，不覆盖默认） ===== */
                app2: 'var(--v2-bg-app)',
                /* P1a 追加：--v2-bg-surface 独立 key（P0 未映射，为保零视觉变化不重映射旧 surface） */
                surfacev2: 'var(--v2-bg-surface)',
                surface2: 'var(--v2-bg-surface-2)',
                sunken2: 'var(--v2-bg-sunken)',
                selected2: 'var(--v2-bg-selected)',
                outline: 'var(--v2-border-outline)',
                hover2: 'var(--v2-bg-hover)',
                active2: 'var(--v2-bg-active)',
                t1: 'var(--v2-text-1)',
                t2: 'var(--v2-text-2)',
                t3: 'var(--v2-text-3)',
                t4: 'var(--v2-text-4)',
                hairline: 'var(--v2-border-hairline)',
                overlay2: 'var(--v2-overlay)',
                accent2: {
                    DEFAULT: 'var(--v2-accent)',
                    ink: 'var(--v2-accent-ink)',
                    strong: 'var(--v2-accent-strong)',
                    hover: 'var(--v2-accent-hover)',
                    active: 'var(--v2-accent-active)',
                    soft: 'var(--v2-accent-soft)',
                    ring: 'var(--v2-accent-ring)',
                },
                codebg: 'var(--v2-code-bg)',
                ok: 'var(--v2-ok)',
                oksoft: 'var(--v2-ok-soft)',
                okstrong: 'var(--v2-ok-strong)',
                err: 'var(--v2-err)',
                errsoft: 'var(--v2-err-soft)',
                errstrong: 'var(--v2-err-strong)',
                warn: 'var(--v2-warn)',
                warnsoft: 'var(--v2-warn-soft)',
                warnstrong: 'var(--v2-warn-strong)',
            },
            /* 圆角阶梯一律取 v2 令牌（就近归并：8/10→sm，12/14/16→md），不要再写 rounded-[Npx]。
               实际在用：rounded(4) / xs(6) / sm(10) / md(14) / panel(22) / full */
            borderRadius: {
                xs: 'var(--v2-r-xs)',
                sm: 'var(--v2-r-sm)',
                md: 'var(--v2-r-md)',
                lg: 'var(--v2-r-lg)',
                panel: 'var(--v2-r-panel)',
            },
            boxShadow: {
                e1: 'var(--v2-shadow-xs)',
                e2: 'var(--v2-shadow-sm)',
                e3: 'var(--v2-shadow-md)',
                e4: 'var(--v2-shadow-lg)',
                well: 'var(--v2-shadow-inset)',
                raised: 'var(--v2-shadow-raised)',
                'raised-hover': 'var(--v2-shadow-raised-hover)',
                pressed: 'var(--v2-shadow-pressed)',
                soft: 'var(--v2-shadow-soft)',
                'soft-sm': 'var(--v2-shadow-soft-sm)',
            },
            transitionProperty: {
                interactive: 'color, background-color, border-color, box-shadow, transform, opacity',
                surface: 'box-shadow, border-color, background-color',
                pop: 'opacity, transform',
            },
            transitionDuration: {
                fast: '120ms',
                base: '180ms',
                slow: '240ms',
                sheet: '240ms',
            },
            transitionTimingFunction: {
                soft: 'cubic-bezier(.2,.8,.2,1)',
                spring: 'cubic-bezier(.34,1.56,.64,1)',
            },
            /* 字号阶梯（只设 font-size，不带动 line-height）：
               xs 12 · 13 稠密界面文字 · sm 14 正文 · 15 阅读正文 · base 16 · lg 18 · xl 20 · 2xl 24 */
            fontSize: {
                '13': '13px',
                '15': '15px',
            },
            fontFamily: {
                sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'sans-serif'],
                mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
            },
            animation: {
                'shimmer': 'shimmer 2s linear infinite',
                'pulse-slow': 'pulse 3s ease-in-out infinite',
                'slide-up': 'slideUp 0.2s ease-out',
                /* v2 动效（slide-up 与上方现有 key 同值合并，不重复定义） */
                'fade-in': 'fadeIn .18s cubic-bezier(.2,.8,.2,1)',
                'scale-in': 'scaleIn .24s cubic-bezier(.2,.8,.2,1)',
                'sheet-up': 'sheetUp .24s cubic-bezier(.2,.8,.2,1)',
                'accent-pulse': 'accentPulse 1.6s ease-in-out infinite',
                'indeterminate': 'indeterminate 1.4s ease-in-out infinite',
            },
        },
    },
    plugins: [
        require('@tailwindcss/typography'),
    ],
} satisfies Config;
