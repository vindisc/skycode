import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPanel } from '@/components/dialog/SettingsPanel';
import { KeyboardShortcutsDialog } from '@/components/dialog/KeyboardShortcutsDialog';
import { useConfigStore } from '@/store/configStore';
import { useDialogStore } from '@/store/dialogStore';
import { settingsApi } from '@/api/settingsApi';

const runtime = vi.hoisted(() => ({ status: vi.fn() }));
vi.mock('@/api/settingsApi', () => ({
    settingsApi: { listProviders: vi.fn(), listScenes: vi.fn() },
    configuredProvidersApi: { list: vi.fn().mockResolvedValue([]) },
    runtimeApi: runtime,
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

    it('asks before closing or switching tabs while a provider form has unsaved changes', async () => {
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
        const onClose = vi.fn();
        render(<SettingsPanel onClose={onClose} />);
        fireEvent.click(screen.getByRole('tab', { name: '模型服务商' }));
        await screen.findByTestId('llm-providers-settings');
        fireEvent.click(screen.getByRole('button', { name: '添加服务商' }));
        fireEvent.change(screen.getByLabelText('服务商名称'), { target: { value: '没保存的服务商' } });

        // 弹窗底部那个更大的绿色按钮：点下去不该悄悄把填好的表单丢掉
        fireEvent.click(screen.getByRole('button', { name: '完成' }));
        expect(confirm).toHaveBeenCalledWith('设置里有还没保存的内容，关闭后会丢失。确定关闭吗？');
        expect(onClose).not.toHaveBeenCalled();
        expect(screen.getByRole('dialog', { name: '设置' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('tab', { name: '场景分派' }));
        expect(confirm).toHaveBeenLastCalledWith('设置里有还没保存的内容，切换后会丢失。确定切换吗？');
        expect(screen.getByTestId('llm-provider-form')).toBeInTheDocument();

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).not.toHaveBeenCalled();

        confirm.mockReturnValue(true);
        fireEvent.click(screen.getByRole('button', { name: '完成' }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('closes without asking when nothing is unsaved', () => {
        const confirm = vi.spyOn(window, 'confirm');
        const onClose = vi.fn();
        render(<SettingsPanel onClose={onClose} />);

        fireEvent.click(screen.getByRole('button', { name: '完成' }));

        expect(onClose).toHaveBeenCalledOnce();
        expect(confirm).not.toHaveBeenCalled();
    });

    it('shows what is actually running: the Python service and the model behind each pipeline', async () => {
        runtime.status.mockResolvedValue({
            python: {
                autoStart: true, running: false, healthy: false, state: 'FAILED', restartCount: 3,
                lastHealthCheck: 'null', serviceUrl: 'http://127.0.0.1:8000', capabilities: [], hint: '进程没有在运行。看容器日志里的输出。',
            },
            defaultModel: { model: 'glm-5.4', source: 'scene_binding:智谱' },
            fastModel: { model: 'gpt-6-sol', source: 'config' },
            subAgentModel: { model: 'glm-5.4', source: 'inherit' },
            visionFallbackModel: { model: 'gpt-6.1-sol', source: 'config' },
            promptOptimizeModel: { model: null, source: null },
            summary: { enabled: true, configuredProvider: 'deepseek', configuredModel: 'deepseek-flash',
                model: 'deepseek-flash', source: 'config', unavailable: null },
            configuredProviders: ['deepseek', 'zhipu'],
            poolProviders: [],
        });
        render(<SettingsPanel onClose={vi.fn()} />);

        fireEvent.click(screen.getByRole('tab', { name: '运行状态' }));

        const panel = await screen.findByTestId('runtime-status-panel');
        expect(await within(panel).findByText('没有运行')).toBeInTheDocument();
        expect(panel).toHaveTextContent('进程没有在运行');
        expect(within(panel).getByTestId('pipeline-status')).toHaveTextContent('glm-5.4');
        expect(panel).toHaveTextContent('来自设置页的分派（智谱）');
        expect(panel).toHaveTextContent('跟随主对话');
        expect(panel).toHaveTextContent('还没有配置；到「场景分派」里给「提示词优化」选一个模型');
        expect(panel).toHaveTextContent('压缩摘要');
        expect(within(panel).getByTestId('registered-providers')).toHaveTextContent('zhipu');
    });

    it('reports a healthy Python service with its capabilities', async () => {
        runtime.status.mockResolvedValue({
            python: {
                autoStart: true, running: true, healthy: true, state: 'RUNNING', restartCount: 0,
                lastHealthCheck: '2026-11-25T01:00:00Z', serviceUrl: 'http://127.0.0.1:8000', hint: null,
                capabilities: [{ name: 'CODE_INTEL', available: true, reason: null },
                    { name: 'BROWSER_AUTOMATION', available: false, reason: 'chromium failed' }],
            },
            defaultModel: { model: 'gpt-6.2-sol', source: 'config' },
            fastModel: { model: 'gpt-6-sol', source: 'config' },
            subAgentModel: { model: 'gpt-6.2-sol', source: 'inherit' },
            visionFallbackModel: { model: 'gpt-6.1-sol', source: 'config' },
            promptOptimizeModel: { model: 'gpt-6.1-sol', source: 'env' },
            summary: { enabled: false, configuredProvider: null, configuredModel: null, model: null, source: null,
                unavailable: 'summary_disabled' },
            configuredProviders: ['huoshenai'],
            poolProviders: ['db:pool'],
        });
        render(<SettingsPanel onClose={vi.fn()} />);

        fireEvent.click(screen.getByRole('tab', { name: '运行状态' }));

        const panel = await screen.findByTestId('runtime-status-panel');
        expect(await within(panel).findByText('运行中')).toBeInTheDocument();
        expect(panel).toHaveTextContent('代码洞察');
        expect(panel).toHaveTextContent('浏览器自动化（chromium failed）');
        expect(panel).toHaveTextContent('压缩摘要已在配置里关掉');
        expect(panel).toHaveTextContent('环境变量');
    });
});
