/**
 * datetime 工具测试
 *
 * 覆盖 formatMessageTime 的 "X月X日（周X）HH:MM:SS" 格式：
 * - 月和日不补零（9月12日，不是 09月12日）
 * - 时分秒补零（00:07:17）
 * - 中文星期几（周日 ~ 周六）
 */

import { describe, expect, it } from 'vitest';
import { formatMessageTime, formatMessageTimeShort } from './datetime';

/** 本地时区时间戳构造辅助 */
function ts(y: number, m: number, d: number, h = 0, min = 0, s = 0): number {
    return new Date(y, m - 1, d, h, min, s).getTime();
}

describe('formatMessageTime', () => {
    it('格式化为 "X月X日（周X）HH:MM:SS"（2026-09-12 周六）', () => {
        expect(formatMessageTime(ts(2026, 9, 12, 0, 7, 17))).toBe('9月12日（周六）00:07:17');
    });

    it('月和日不补零（1月1日，不是 01月01日）', () => {
        // 2026-01-01 是周四
        expect(formatMessageTime(ts(2026, 1, 1, 9, 5, 3))).toBe('1月1日（周四）09:05:03');
    });

    it('时分秒补零（00:00:00）', () => {
        expect(formatMessageTime(ts(2026, 9, 12, 0, 0, 0))).toBe('9月12日（周六）00:00:00');
    });

    it('时分秒补零（23:59:59）', () => {
        expect(formatMessageTime(ts(2026, 9, 12, 23, 59, 59))).toBe('9月12日（周六）23:59:59');
    });

    it.each([
        ['周日', 2026, 9, 13],
        ['周一', 2026, 9, 14],
        ['周二', 2026, 9, 15],
        ['周三', 2026, 9, 16],
        ['周四', 2026, 9, 17],
        ['周五', 2026, 9, 18],
        ['周六', 2026, 9, 19],
    ] as const)('星期几映射正确：%s', (weekday, y, m, d) => {
        expect(formatMessageTime(ts(y, m, d, 12, 0, 0))).toBe(`${m}月${d}日（${weekday}）12:00:00`);
    });
});

describe('formatMessageTimeShort', () => {
    // 「现在」固定为 2026-09-12 15:30
    const now = ts(2026, 9, 12, 15, 30);

    it('今天的消息只给时分', () => {
        expect(formatMessageTimeShort(ts(2026, 9, 12, 0, 7), now)).toBe('00:07');
        // 同一天里「现在」的时分秒不影响判断：23:59:59 的消息在 00:00:01 看仍是今天
        expect(formatMessageTimeShort(ts(2026, 9, 12, 23, 59, 59), ts(2026, 9, 12, 23, 59, 59))).toBe('23:59');
    });

    it('昨天的消息标「昨天」', () => {
        expect(formatMessageTimeShort(ts(2026, 9, 11, 9, 5, 3), now)).toBe('昨天 09:05');
    });

    it('同年更早的消息给月日，不补零', () => {
        expect(formatMessageTimeShort(ts(2026, 1, 1, 9, 5), now)).toBe('1月1日 09:05');
    });

    it('跨年的消息带年份', () => {
        expect(formatMessageTimeShort(ts(2025, 12, 31, 23, 0), now)).toBe('2025年12月31日 23:00');
    });
});
