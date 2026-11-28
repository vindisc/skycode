import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSessionStatusLabel, Header } from '@/components/layout/Header';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { useConfigStore } from '@/store/configStore';
import { useModelStore } from '@/store/modelStore';
import { useSessionStore } from '@/store/sessionStore';
import { useWorkbenchViewStore } from '@/store/workbenchViewStore';
import { useBridgeStore } from '@/store/bridgeStore';
import { useDialogStore } from '@/store/dialogStore';

describe('Header', () => {
    beforeEach(() => {
        useWorkbenchViewStore.setState({ enabled: false });
        useConfigStore.setState({
            theme: { ...useConfigStore.getState().theme, mode: 'dark' },
        });
        useSessionStore.setState({ sessionId: null, model: null });
        useBridgeStore.setState({ bridgeStatus: 'connected' });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        document.documentElement.classList.remove('light', 'dark', 'system');
    });

    it.each(['system', 'unknown'])('safely renders unexpected runtime theme %s', mode => {
        useModelStore.setState({ loaded: true, loading: false, models: [], defaultModel: null });
        // 模拟未经持久化迁移的旧运行态，验证最后一层渲染防护。
        useConfigStore.setState({ theme: JSON.parse(JSON.stringify({ ...useConfigStore.getState().theme, mode })) });
        document.documentElement.classList.add('system');
        render(<ThemeProvider><Header /></ThemeProvider>);
        expect(screen.getByRole('button', { name: '设置' })).toBeVisible();
        expect(document.documentElement.classList.contains('system')).toBe(false);
        expect(document.documentElement.classList.contains('light') || document.documentElement.classList.contains('dark')).toBe(true);
    });

    it('运行中在移动端头部显示状态胶囊；桌面顶栏不再有状态行（状态在输入框 / 回合卡里）', () => {
        useModelStore.setState({
            loaded: true,
            loading: false,
            error: null,
            defaultModel: 'kimi-k3',
            models: [{ id: 'kimi-k3', displayName: 'Kimi K3', supportsImages: false, maxImages: 0 }],
        });
        useSessionStore.setState({ model: 'kimi-k3', status: 'streaming' });

        const { container } = render(<Header />);

        // 只剩移动端头部那一枚状态胶囊
        const statusEls = screen.getAllByRole('status');
        expect(statusEls).toHaveLength(1);
        expect(statusEls[0]).toHaveTextContent('运行中');
        expect(container.querySelectorAll('.animate-spin').length).toBeGreaterThan(0);
        // 桌面顶栏不再渲染「就绪 / 运行中」之类的只读状态行
        expect(screen.queryByText('就绪')).not.toBeInTheDocument();
    });

    it('opens Skill management from the desktop and tablet header', () => {
        useModelStore.setState({ loaded: true, loading: false, error: null, models: [], defaultModel: null });
        useDialogStore.setState({ activeDialog: null });
        render(<Header />);
        fireEvent.click(screen.getByRole('button', { name: 'Skill 管理' }));
        expect(useDialogStore.getState().activeDialog).toBe('skills');
    });
});

describe('getSessionStatusLabel', () => {
    it('maps known session statuses to Chinese labels', () => {
        expect(getSessionStatusLabel('idle')).toBe('就绪');
        expect(getSessionStatusLabel('streaming')).toBe('运行中');
        expect(getSessionStatusLabel('waiting_permission')).toBe('等待权限');
        expect(getSessionStatusLabel('compacting')).toBe('压缩中...');
    });

    it('falls back to the raw status for unknown values', () => {
        expect(getSessionStatusLabel('some_future_status')).toBe('some_future_status');
    });
});
