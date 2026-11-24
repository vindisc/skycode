import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPanel } from '@/components/dialog/SettingsPanel';
import { KeyboardShortcutsDialog } from '@/components/dialog/KeyboardShortcutsDialog';
import { useConfigStore } from '@/store/configStore';
import { useDialogStore } from '@/store/dialogStore';
import { settingsApi } from '@/api/settingsApi';

vi.mock('@/api/settingsApi', () => ({
    settingsApi: { listProviders: vi.fn(), listScenes: vi.fn() },
}));

describe('Appearance settings and shortcut help', () => {
    beforeEach(() => {
        useConfigStore.setState({
            theme: { ...useConfigStore.getState().theme, mode: 'light' },
        });
        useDialogStore.setState({ activeDialog: null, dialogData: {} });
        vi.mocked(settingsApi.listProviders).mockResolvedValue({ providers: [], apiKeyStorageReady: true, routing: [] });
        vi.mocked(settingsApi.listScenes).mockResolvedValue({
            scenes: [{ key: 'prompt_optimize', label: '提示词优化', description: '输入框里「优化提示词」功能使用的模型。',
                binding: null, providerName: null, active: false }],
            providers: [],
        });
    });

    it('applies theme changes and persists them without session controls', () => {
        render(<SettingsPanel onClose={vi.fn()} />);
        expect(screen.getByRole('dialog', { name: '设置' })).toBeInTheDocument();
        expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: '跟随系统' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: '液态玻璃' }));
        expect(useConfigStore.getState().theme.mode).toBe('glass');
        expect(screen.getByRole('button', { name: '液态玻璃' })).toHaveAttribute('aria-pressed', 'true');
        expect(JSON.parse(localStorage.getItem('ai-coder-config')!).state.theme.mode).toBe('glass');
    });

    it('closes appearance settings with Escape', () => {
        const onClose = vi.fn();
        render(<SettingsPanel onClose={onClose} />);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('only mounts the tab that is selected, starting with appearance', async () => {
        render(<SettingsPanel onClose={vi.fn()} />);

        // 外观页不发请求，也不挂载另外两页
        expect(screen.getByRole('tab', { name: '外观' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.queryByTestId('llm-providers-settings')).not.toBeInTheDocument();
        expect(screen.queryByTestId('scene-bindings-settings')).not.toBeInTheDocument();
        expect(settingsApi.listProviders).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('tab', { name: '模型服务商' }));
        expect(await screen.findByTestId('llm-providers-settings')).toBeInTheDocument();
        expect(screen.queryByRole('group', { name: '主题' })).not.toBeInTheDocument();
        expect(screen.queryByTestId('scene-bindings-settings')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('tab', { name: '场景分派' }));
        expect(await screen.findByTestId('scene-bindings-settings')).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByTestId('llm-providers-settings')).not.toBeInTheDocument());
        expect(settingsApi.listProviders).toHaveBeenCalledTimes(1);
        expect(settingsApi.listScenes).toHaveBeenCalledTimes(1);
    });

    it('can be opened directly on a specific tab', async () => {
        useDialogStore.setState({ activeDialog: 'settings', dialogData: { tab: 'scenes' } });
        render(<SettingsPanel onClose={vi.fn()} />);

        expect(await screen.findByTestId('scene-bindings-settings')).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: '场景分派' })).toHaveAttribute('aria-selected', 'true');
    });

    it('shows shortcut help independently and closes with Done', () => {
        const onClose = vi.fn();
        render(<KeyboardShortcutsDialog onClose={onClose} />);
        expect(screen.getByRole('dialog', { name: '快捷键帮助' })).toBeInTheDocument();
        expect(screen.getByText('输入框内中断生成（未选中文字时）')).toBeInTheDocument();
        expect(screen.queryByRole('group', { name: '主题' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: '完成' }));
        expect(onClose).toHaveBeenCalledOnce();
    });
});
