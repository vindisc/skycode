/**
 * datetime — 时间格式化工具
 *
 * 消息 hover 操作条使用的 "X月X日（周X）HH:MM:SS" 格式化，
 * 时分秒与 SwarmMessageLog 的时间展示保持一致（padStart(2, '0')）。
 */

/** 中文星期几映射表，索引对应 Date.getDay()（0 = 周日） */
const WEEKDAY_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

/**
 * 将毫秒级 Unix 时间戳格式化为 "X月X日（周X）HH:MM:SS"（24 小时制，本地时区）。
 *
 * 月和日不补零（9月12日），时分秒补零（00:07:17），星期几用中文。
 *
 * @param ts 毫秒级 Unix 时间戳
 * @returns 形如 "9月12日（周六）00:07:17" 的时间字符串
 */
export function formatMessageTime(ts: number): string {
    const d = new Date(ts);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getMonth() + 1}月${d.getDate()}日（${WEEKDAY_ZH[d.getDay()]}）`
        + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * 操作行里显示的短时间：今天只给时分，昨天标「昨天」，同年给月日，跨年带年份。
 * 完整时间（星期、秒）用 formatMessageTime，放在悬停提示里。
 * @param ts 毫秒级 Unix 时间戳
 * @param now 「现在」，便于测试
 */
export function formatMessageTimeShort(ts: number, now: number = Date.now()): string {
    const d = new Date(ts);
    const current = new Date(now);
    const pad = (n: number) => n.toString().padStart(2, '0');
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    // 按日历日比较（各自取当天零点），不受「现在」的时分秒影响
    const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const dayDiff = Math.round((startOfDay(current) - startOfDay(d)) / 86_400_000);
    if (dayDiff === 0) return time;
    if (dayDiff === 1) return `昨天 ${time}`;
    const day = `${d.getMonth() + 1}月${d.getDate()}日`;
    return d.getFullYear() === current.getFullYear() ? `${day} ${time}` : `${d.getFullYear()}年${day} ${time}`;
}
