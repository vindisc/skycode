import { useId } from 'react';

/**
 * BrandLogo — 品牌鲸鱼标（图形不变）。
 *
 * 以内联 SVG 渲染，配色取强调色令牌：原来 assets/logo.svg 把 GitHub 蓝写死在渐变里，
 * 和界面的强调色是两个色系，同屏会出现第三种颜色。眼睛与嘴用 strong 压暗后的墨色，
 * 浅色、深色两套底都能看清。渐变 id 按实例生成，页面上多处同时出现不会串色。
 */
export function BrandLogo({ className = 'h-8 w-8' }: { className?: string }) {
    // useId 的返回值带冒号，不能直接放进 url(#…)，只留安全字符
    const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
    const body = `${id}-body`;
    const wingUp = `${id}-wing-up`;
    const wingDown = `${id}-wing-down`;
    const tail = `${id}-tail`;
    const ink = 'color-mix(in srgb, var(--v2-accent-strong) 35%, #0d1117)';

    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 512 512"
            aria-hidden="true"
            focusable="false"
            className={`shrink-0 ${className}`}
        >
            <defs>
                <linearGradient id={body} x1="0.2" y1="0" x2="0.8" y2="1">
                    <stop offset="0%" stopColor="var(--v2-accent)" />
                    <stop offset="100%" stopColor="var(--v2-accent-strong)" />
                </linearGradient>
                <linearGradient id={wingUp} x1="0" y1="1" x2="0" y2="0">
                    <stop offset="0%" stopColor="var(--v2-accent)" />
                    <stop offset="100%" stopColor="var(--v2-accent)" stopOpacity="0.15" />
                </linearGradient>
                <linearGradient id={wingDown} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--v2-accent)" />
                    <stop offset="100%" stopColor="var(--v2-accent)" stopOpacity="0.15" />
                </linearGradient>
                <linearGradient id={tail} x1="1" y1="0.5" x2="0" y2="0.5">
                    <stop offset="0%" stopColor="var(--v2-accent)" />
                    <stop offset="100%" stopColor="var(--v2-accent)" stopOpacity="0.2" />
                </linearGradient>
            </defs>
            {/* Body: round cute whale facing right, head-heavy */}
            <path d="M100 260C100 158,190 85,290 95C350 90,422 148,440 218Q454 262,440 308C422 378,350 435,290 428C190 438,100 365,100 260Z" fill={`url(#${body})`} />
            {/* Belly highlight */}
            <ellipse cx="328" cy="340" rx="85" ry="55" fill="var(--v2-accent)" opacity="0.3" />
            {/* Tail upper lobe */}
            <path d="M100 250C72 232,38 178,22 158C16 148,28 154,48 180C66 202,86 232,100 250Z" fill={`url(#${tail})`} />
            {/* Tail lower lobe */}
            <path d="M100 270C72 288,38 342,22 362C16 372,28 366,48 340C66 318,86 288,100 270Z" fill={`url(#${tail})`} />
            {/* Upper wing (far side) */}
            <path d="M218 130C198 78,152 28,122 16C110 12,116 36,132 66C156 100,194 126,218 130Z" fill={`url(#${wingUp})`} />
            {/* Lower wing (near side, mirror) */}
            <path d="M218 390C198 442,152 492,122 504C110 508,116 484,132 454C156 420,194 394,218 390Z" fill={`url(#${wingDown})`} />
            {/* Dorsal fin */}
            <path d="M260 98C256 72,270 56,286 66C292 72,280 94,270 100Z" fill={`url(#${body})`} />
            {/* Eye white */}
            <circle cx="362" cy="228" r="30" fill="#fff" />
            {/* Pupil */}
            <circle cx="368" cy="232" r="17" fill={ink} />
            {/* Eye highlight */}
            <circle cx="354" cy="220" r="8" fill="#fff" />
            {/* Mouth */}
            <path d="M332 298Q356 314,380 302" fill="none" stroke={ink} strokeWidth="4" strokeLinecap="round" />
        </svg>
    );
}
