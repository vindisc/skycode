import { memo } from 'react';

/**
 * BrandLogo — 品牌鲸鱼标：头朝右的极简鲸鱼，单色填充。
 *
 * 内联 SVG，填色取强调色令牌（--v2-accent），跟随主题与用户选的强调色；
 * 眼睛是 evenodd 镂空，透出所在背景，深浅底都成立。整个组件就是一个 path，
 * 无渐变无共享 id，页面上多处同时出现互不影响。
 */
export function BrandLogo({ className = 'h-8 w-8' }: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="24 24 192 112"
            aria-hidden="true"
            focusable="false"
            className={`shrink-0 ${className}`}
        >
            <path fill="var(--v2-accent)" fillRule="evenodd" d="M 30 38 C 36 28 48 28 53 40 C 56 45 59 47 63 47 C 68 38 75 31 82 33 C 87 35 88 44 89 54 C 108 42 146 36 172 46 C 196 54 208 72 204 92 C 200 112 174 128 138 128 C 104 128 76 116 68 96 C 62 84 50 64 42 52 C 38 46 33 43 30 38 Z M 156 76 a 8 8 0 1 0 16 0 a 8 8 0 1 0 -16 0 Z" />
        </svg>
    );
}

export default memo(BrandLogo);
