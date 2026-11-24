/**
 * slashCommandIntent — 斜杠命令的"面板开合"与"提交路由"判定
 *
 * 两个判定必须分开：
 * - canOpenCommandPaletteFor 只回答"用户是不是正在敲命令名"，决定补全面板开不开。
 * - looksLikeSlashCommand 只回答"这段草稿该不该当命令发出去"，是防止正文被当成
 *   未知命令静默丢弃的闸门：后端对未知命令只回 COMMAND_NOT_FOUND 且不带任何能关联
 *   到本次提交的标识，前端无法"等确认再清草稿"，只能在提交前拦住。
 *
 * 此前两处都只看草稿是否以 "/" 开头：多行正文的面板过滤词带着换行必然零匹配，
 * 提交后整段消息丢失。
 */

import type { Command } from '@/types';

/**
 * 后端命令清单（GET /api/commands）尚未加载或加载失败时的兜底名称。
 * 前四条是前端硬编码的内置命令；review / diff 在 App.handleSlashCommand 里有专门处理；
 * skill 由前端自行拼出（后端把 /skill 登记为 hidden，不在清单接口里返回）。
 */
export const FALLBACK_SLASH_COMMAND_NAMES: readonly string[] = [
    'help', 'clear', 'compact', 'model', 'review', 'diff', 'skill',
];

const NO_COMMANDS: readonly Command[] = [];

const MULTI_LINE = /[\r\n]/;
/** "/" 之后到首个空白之前的片段 */
const FIRST_TOKEN = /^\/(\S*)/;
/** 命令名形状：字母开头，只含字母、数字、下划线、冒号、短横线 */
const COMMAND_NAME_SHAPED = /^[A-Za-z][\w:-]*$/;

function firstToken(text: string): string {
    const match = FIRST_TOKEN.exec(text);
    return match ? match[1].toLowerCase() : '';
}

/** 首个 token 之后是否带了参数（任意空白，含尾随空格） */
function hasArgument(text: string): boolean {
    return /^\/\S*\s/.test(text);
}

function commandNames(commands: readonly Command[]): string[] {
    const names = new Set<string>(FALLBACK_SLASH_COMMAND_NAMES);
    for (const command of commands) {
        const name = typeof command?.name === 'string' ? command.name.trim() : '';
        if (name) names.add(name.toLowerCase());
    }
    return [...names];
}

/** 是否应当打开命令补全面板 */
export function canOpenCommandPaletteFor(
    text: string,
    commands: readonly Command[] = NO_COMMANDS,
): boolean {
    if (!text.startsWith('/')) return false;
    // 多行一律视为正文：补全词带换行不可能匹配任何命令名
    if (MULTI_LINE.test(text)) return false;
    // 裸 "/"（或 "/" 后只有空白）列出全部命令
    const token = firstToken(text);
    if (!token) return true;
    if (hasArgument(text)) {
        // 带参数即收起；唯一例外是 /skill <片段>，技能候选需要按片段继续筛选
        return token === 'skill';
    }
    // 未带空格：必须是某个命令名的前缀才开面板，避免把路径等正文当成命令
    return commandNames(commands).some(name => name.startsWith(token));
}

/** 这段草稿是否应当作为斜杠命令提交（否则按普通消息发给模型） */
export function looksLikeSlashCommand(
    text: string,
    commands: readonly Command[] = NO_COMMANDS,
): boolean {
    if (!text.startsWith('/') || text.length < 2) return false;
    // "/.gitignore"、"/=" 之类首个字符不是字母的，不是命令
    if (!/[A-Za-z]/.test(text[1])) return false;
    const token = firstToken(text);
    if (!token) return false;
    // "/usr/bin/env …" 这类 token 内含斜杠的是路径
    if (token.includes('/')) return false;
    // 已知命令：允许携带多行参数（如 /review <多行说明>）
    if (commandNames(commands).includes(token)) return true;
    // 其余只认单行、且形状像命令名的文本；多行正文即使以 "/" 开头也按普通消息发送
    return !MULTI_LINE.test(text) && COMMAND_NAME_SHAPED.test(token);
}
