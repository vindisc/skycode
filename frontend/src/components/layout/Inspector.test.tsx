import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { Inspector } from './Inspector';
import { useCostStore } from '@/store/costStore';
import { useMessageStore } from '@/store/messageStore';
import { usePermissionStore } from '@/store/permissionStore';
import { useSessionStore } from '@/store/sessionStore';
import { useAppUiStore } from '@/store/appUiStore';
import { INSPECTOR_MIN_WIDTH, useInspectorVisible } from '@/hooks/useInspectorVisible';

const settings = () => screen.getByRole('region', { name: '会话设置' });

describe('Inspector', () => {
    beforeEach(() => {
        useSessionStore.setState({ sessionId: null, status: 'idle', customTitle: null, model: 'm1' });
        useMessageStore.setState({ messages: [], activeToolCalls: undefined, streamingMessageId: null });
        usePermissionStore.setState({ pendingPermissions: [] });
        useCostStore.setState({ sessionCost: 0, totalCost: 0, usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0 } as never });
    });

    it('没有选中会话时也显示设置卡：模型、权限、显示方式都在，其余分节不显示', () => {
        render(<Inspector />);
        expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('新会话');
        expect(screen.getByText('设置在发出第一条消息时生效')).toBeInTheDocument();
        expect(within(settings()).getByLabelText('模型选择')).toBeInTheDocument();
        expect(within(settings()).getByRole('tablist', { name: '显示方式' })).toBeInTheDocument();
        expect(screen.queryByRole('region', { name: '修改的文件' })).not.toBeInTheDocument();
        expect(screen.queryByRole('region', { name: '用量' })).not.toBeInTheDocument();
        expect(screen.queryByRole('region', { name: '待审批' })).not.toBeInTheDocument();
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

    it('显示方式在检查器里切换会写回当前会话的视图偏好', () => {
        useSessionStore.setState({ sessionId: 's1' });
        render(<Inspector />);
        fireEvent.click(within(settings()).getByRole('tab', { name: '标准' }));
        expect(within(settings()).getByRole('tab', { name: '标准' })).toHaveAttribute('aria-selected', 'true');
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
