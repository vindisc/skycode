import { describe, expect, it } from 'vitest';
import type { Command } from '@/types';
import { canOpenCommandPaletteFor, looksLikeSlashCommand } from './slashCommandIntent';

const commands: Command[] = [
    { name: 'help', description: '显示帮助', group: 'Commands' },
    { name: 'review', description: '审查改动', group: 'Commands' },
    { name: 'skill demo', description: '演示技能', group: 'Skills', skillId: 'demo' },
];

describe('canOpenCommandPaletteFor', () => {
    it('不以 / 开头的草稿不开面板', () => {
        expect(canOpenCommandPaletteFor('普通正文', commands)).toBe(false);
        expect(canOpenCommandPaletteFor('', commands)).toBe(false);
    });

    it('多行一律视为正文，即使首行是命令', () => {
        expect(canOpenCommandPaletteFor('/help\n第二行', commands)).toBe(false);
        expect(canOpenCommandPaletteFor('/这是粘贴的正文\n第二行', commands)).toBe(false);
    });

    it('裸 / 列出全部命令', () => {
        expect(canOpenCommandPaletteFor('/', commands)).toBe(true);
        expect(canOpenCommandPaletteFor('/ ', commands)).toBe(true);
    });

    it('未带空格时必须是某个命令名的前缀才开面板', () => {
        expect(canOpenCommandPaletteFor('/he', commands)).toBe(true);
        expect(canOpenCommandPaletteFor('/hel', commands)).toBe(true);
        expect(canOpenCommandPaletteFor('/Review', commands)).toBe(true);
        expect(canOpenCommandPaletteFor('/xyz', commands)).toBe(false);
        // token 内含斜杠的是路径，不是命令
        expect(canOpenCommandPaletteFor('/usr/bin/env', commands)).toBe(false);
    });

    it('带参数即收起，唯一例外是 /skill <片段>', () => {
        expect(canOpenCommandPaletteFor('/help ', commands)).toBe(false);
        expect(canOpenCommandPaletteFor('/help me', commands)).toBe(false);
        expect(canOpenCommandPaletteFor('/skill ', commands)).toBe(true);
        expect(canOpenCommandPaletteFor('/skill de', commands)).toBe(true);
        expect(canOpenCommandPaletteFor('/skillx a', commands)).toBe(false);
    });
});

describe('looksLikeSlashCommand', () => {
    it('已知命令允许携带多行参数', () => {
        expect(looksLikeSlashCommand('/review 第一行\n第二行', commands)).toBe(true);
        expect(looksLikeSlashCommand('/Review A\nB', commands)).toBe(true);
    });

    it('单行且形状像命令名的文本仍按命令处理', () => {
        expect(looksLikeSlashCommand('/retry-me', commands)).toBe(true);
        expect(looksLikeSlashCommand('/compact foo', commands)).toBe(true);
        expect(looksLikeSlashCommand('/skill demo', commands)).toBe(true);
    });

    it('以 / 开头的正文按普通消息处理，不会被当成未知命令丢掉', () => {
        expect(looksLikeSlashCommand('/usr/bin/python3 script.py', commands)).toBe(false);
        expect(looksLikeSlashCommand('/Users/wangbo/Projects/demo/src/index.ts 这个文件报错了', commands)).toBe(false);
        expect(looksLikeSlashCommand('/.gitignore 是干什么的', commands)).toBe(false);
        expect(looksLikeSlashCommand('/这个路径有问题\n第二行补充说明', commands)).toBe(false);
    });

    it('命令清单未加载时回落到内置的兜底命令名', () => {
        expect(looksLikeSlashCommand('/compact', [])).toBe(true);
        expect(looksLikeSlashCommand('/review a\nb', [])).toBe(true);
        expect(canOpenCommandPaletteFor('/rev', [])).toBe(true);
    });

    it('空输入与过短输入不是命令', () => {
        expect(looksLikeSlashCommand('', commands)).toBe(false);
        expect(looksLikeSlashCommand('/', commands)).toBe(false);
        expect(looksLikeSlashCommand('/ ', commands)).toBe(false);
    });
});
