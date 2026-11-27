/**
 * zkSyntax 主题语法表测试（light / dark 原表映射）
 */
import { describe, expect, it } from 'vitest';
import { resolveZkSyntaxStyle, ZK_SYNTAX_STYLES } from '../zkSyntax';

describe('resolveZkSyntaxStyle', () => {
    it('light / dark 直达各自原表（回归保护）', () => {
        expect(resolveZkSyntaxStyle('light')).toBe(ZK_SYNTAX_STYLES.light);
        expect(resolveZkSyntaxStyle('dark')).toBe(ZK_SYNTAX_STYLES.dark);
    });
});
