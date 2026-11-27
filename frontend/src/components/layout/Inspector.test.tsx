import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { Inspector } from './Inspector';
import { useCostStore } from '@/store/costStore';
import { useMessageStore } from '@/store/messageStore';
import { usePermissionStore } from '@/store/permissionStore';
import { useSessionStore } from '@/store/sessionStore';
import { useAppUiStore } from '@/store/appUiStore';
import { INSPECTOR_MIN_WIDTH, useInspectorVisible } from '@/hooks/useInspectorVisible';

const regionNames = ['会话设置', '修改的文件', '任务', '用量', '待审批'];

describe('Inspector', () => {
    beforeEach(() => {
        useSessionStore.setState({ sessionId: null, status: 'idle', customTitle: null, model: 'm1' });
        useMessageStore.setState({ messages: [], activeToolCalls: undefined, streamingMessageId: null });
        usePermissionStore.setState({ pendingPermissions: [] });
        useCostStore.setState({ sessionCost: 0, totalCost: 0, usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0 } as never });
    });

    it('没有选中会话时只给一句引导：不放设置，也不显示任何分节', () => {
        render(<Inspector />);
        expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('新会话');
        expect(screen.getByText('还没有开始')).toBeInTheDocument();
        expect(screen.getByText(/发出第一条消息后/)).toBeInTheDocument();
        for (const name of regionNames) {
            expect(screen.queryByRole('region', { name })).not.toBeInTheDocument();
        }
    });

    it('选中会话后标题取自定义名称，有用量时显示用量分节', () => {
        useSessionStore.setState({ sessionId: 's1', customTitle: '  改侧栏  ' });
        useCostStore.setState({ sessionCost: 0.0125, totalCost: 3, usage: { inputTokens: 1234, outputTokens: 567, cacheReadInputTokens: 0 } as never });
        render(<Inspector />);
        expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('改侧栏');
        expect(screen.getByText('当前会话')).toBeInTheDocument();
        const usage = screen.getByRole('region', { name: '用量' });
        expect(usage).toHaveTextContent('1,234');
        expect(usage).toHaveTextContent('567');
        expect(usage).toHaveTextContent('$0.013');
        expect(usage).toHaveTextContent('$3.000');
    });

    it('选中了会话但没有文件、任务、用量时给空态提示', () => {
        useSessionStore.setState({ sessionId: 's1' });
        render(<Inspector />);
        expect(screen.getByText('这个会话还没有修改过的文件或任务')).toBeInTheDocument();
        expect(screen.queryByRole('region', { name: '会话设置' })).not.toBeInTheDocument();
    });

    it('有待审批的请求时列出工具名和原因', () => {
        useSessionStore.setState({ sessionId: 's1' });
        usePermissionStore.setState({
            pendingPermissions: [{ toolUseId: 't1', toolName: 'Bash', input: {}, riskLevel: 'medium', reason: '执行 shell 命令' }],
        });
        render(<Inspector />);
        const pending = screen.getByRole('region', { name: '待审批' });
        expect(pending).toHaveTextContent('待审批 · 1');
        expect(pending).toHaveTextContent('Bash');
        expect(pending).toHaveTextContent('执行 shell 命令');
    });
});

describe('useInspectorVisible', () => {
    beforeEach(() => {
        useAppUiStore.setState({ inspectorOpen: true });
    });

    it('默认展开；收起后不可见，再展开恢复', () => {
        expect(useAppUiStore.getState().inspectorOpen).toBe(true);
        let visible: boolean | null = null;
        const Probe = () => { visible = useInspectorVisible(); return null; };
        render(<Probe />);
        const withViewport = (matches: boolean) => {
            window.matchMedia = (query: string) => ({
                matches, media: query, onchange: null,
                addEventListener: () => {}, removeEventListener: () => {},
                addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
            }) as unknown as MediaQueryList;
        };
        withViewport(false);
        render(<Probe />);
        expect(visible).toBe(false);
        withViewport(true);
        render(<Probe />);
        expect(visible).toBe(true);
        useAppUiStore.getState().setInspectorOpen(false);
        render(<Probe />);
        expect(visible).toBe(false);
        useAppUiStore.getState().setInspectorOpen(true);
        expect(useAppUiStore.getState().inspectorOpen).toBe(true);
        expect(INSPECTOR_MIN_WIDTH).toBe(1280);
    });
});
