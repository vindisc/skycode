import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PromptInput from './index';
import { usePromptDraftStore } from '@/store/promptDraftStore';
import { useModelStore } from '@/store/modelStore';
import { useTurnViewStore } from '@/store/turnViewStore';
import { useDialogStore } from '@/store/dialogStore';
import { useNotificationStore } from '@/store/notificationStore';

const mocks = vi.hoisted(() => ({ available: true, start: vi.fn() }));
const promptApi = vi.hoisted(() => ({ status: vi.fn(), optimize: vi.fn() }));
/** 「优化提示词」已配置时的状态；手机端「更多操作」里那一行会用到 */
const OPTIMIZE_ENABLED = { enabled: true, model: 'gpt-6.1-sol', providerName: '火神', source: 'scene_binding' };
const OPTIMIZE_DISABLED = { enabled: false, model: null, providerName: null, source: null };
vi.mock('@/hooks/useResponsive', () => ({ useResponsive: () => ({ isMobile: true }) }));
vi.mock('@/hooks/useAsrAvailability', () => ({ useAsrAvailability: () => mocks.available }));
vi.mock('@/hooks/useVoiceRecorder', () => ({ useVoiceRecorder: () => ({ state: 'idle', elapsedSeconds: 0, error: null, startRecording: mocks.start, stopRecording: vi.fn() }) }));
vi.mock('@/api/promptOptimizeApi', () => ({ promptOptimizeApi: promptApi }));

beforeEach(() => {
    mocks.available = true; mocks.start.mockClear();
    usePromptDraftStore.setState({ drafts: {} });
    useTurnViewStore.setState({ density: 'compact', expandOverrides: {} });
    useModelStore.setState({ models: [{ id: 'kimi-k3', displayName: 'Kimi K3', maxImages: 0, supportsImages: false }], loading: false, error: null });
    useNotificationStore.setState({ notifications: [] });
    // 这个文件里所有用例都会挂载手机输入条，状态接口的 mock 必须有返回值
    promptApi.status.mockReset();
    promptApi.status.mockResolvedValue(OPTIMIZE_ENABLED);
});
function mount(runActive = false) {
    return render(<PromptInput sessionId="mobile-review" onSubmit={vi.fn()} onSlashCommand={vi.fn()} onInterrupt={vi.fn()}
        disabled={false} runActive={runActive} compacting={false} permissionMode="read_write" messages={[]} commands={[]}
        onPasteImages={vi.fn()} onPublishLocalFile={vi.fn()} fileReferenceCapability={{ mode: 'native_path' }} />);
}
it('运行中使用与桌面一致的指令提示', () => {
    mount(true);
    expect(screen.getByRole('textbox')).toHaveAttribute(
        'placeholder',
        '输入补充指令，将在本次操作完成后执行…',
    );
});
it('默认卡片的语音固定于文本区外，显示方式有独立入口', () => {
    mount();
    const capsule = screen.getByTestId('mobile-prompt-text-area');
    const voice = screen.getByRole('button', { name: '语音输入' });
    expect(capsule).not.toContainElement(voice);
    expect(screen.queryByTestId('mobile-density-chip')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '更多' })).toBeInTheDocument();
    fireEvent.click(voice);
    expect(mocks.start).toHaveBeenCalledOnce();
    expect(screen.getByTestId('mobile-persistent-actions')).toContainElement(voice);
});
it('聚焦后仍只有一个附件入口，隐藏文件选择器保持可用', () => {
    mount();
    fireEvent.focus(screen.getByRole('textbox'));
    expect(screen.getByTestId('mobile-persistent-actions')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '引用本地文件路径' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '附件与工具' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '拍照' })).toBeInTheDocument();
    expect(document.querySelector('[data-mobile-camera-input]')).toHaveAttribute('capture', 'environment');
    expect(screen.getAllByRole('button', { name: '图片附件' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '文件引用' })).toHaveLength(1);
    expect(document.querySelectorAll('[data-local-file-reference-input]')).toHaveLength(1);
});
it('语音服务不可用时保留禁用入口及原因', () => {
    mocks.available = false; mount();
    expect(screen.getByRole('button', { name: '语音输入（服务暂不可用）' })).toBeDisabled();
});
it('不聚焦输入框也能打开三档选择并切换（上下列表）', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: /^显示方式：/ }));
    expect(screen.getByRole('dialog', { name: '选择显示方式' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^完整过程/ }));
    expect(useTurnViewStore.getState().density).toBe('detailed');
    expect(screen.getByTestId('mobile-persistent-actions')).toBeInTheDocument();
});

it('导航顺序统一为状态权限、模型、显示方式、更多（与桌面一致）', () => {
    mount();
    const nav = document.querySelector('.mobile-composer-navigation');
    expect(nav).not.toBeNull();
    const names = Array.from(nav!.querySelectorAll('button')).map(b => b.getAttribute('aria-label') ?? b.textContent);
    expect(names).toEqual([
        expect.stringMatching(/^权限：/),
        expect.stringMatching(/^模型：/),
        expect.stringMatching(/^显示方式：/),
        '更多',
    ]);
});

it('导航提供模型切换入口，更多不再重复模型和显示方式', () => {
    mount();
    expect(screen.queryByRole('button', { name: /^工作台：/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^模型：/ }));
    expect(screen.getByRole('dialog', { name: '选择模型' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    fireEvent.click(screen.getByRole('button', { name: '更多' }));
    const moreDialog = screen.getByRole('dialog', { name: '更多操作' });
    expect(within(moreDialog).queryByRole('region', { name: '模型选择' })).not.toBeInTheDocument();
    expect(within(moreDialog).queryByRole('tab', { name: /^完整过程/ })).not.toBeInTheDocument();
});

it('命令位于附件和语音之间，点击打开斜杠命令入口', () => {
    const previousScroll = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = vi.fn();
    mount();
    const actions = screen.getByTestId('mobile-persistent-actions');
    const buttons = Array.from(actions.querySelectorAll('button'));
    expect(buttons.slice(0, 5).map(button => button.getAttribute('aria-label'))).toEqual(['文件引用', '图片附件', '拍照', '命令', '语音输入']);
    fireEvent.click(screen.getByRole('button', { name: '命令' }));
    expect(screen.getByRole('textbox')).toHaveValue('/');
    HTMLElement.prototype.scrollIntoView = previousScroll;
});

it('从手机更多操作打开 Skill 管理并关闭底部面板', async () => {
    useDialogStore.setState({ activeDialog: null });
    mount();
    fireEvent.click(screen.getByRole('button', { name: '更多' }));
    fireEvent.click(screen.getByRole('button', { name: 'Skill 管理' }));
    expect(useDialogStore.getState().activeDialog).toBe('skills');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '更多操作' })).not.toBeInTheDocument());
});

// 输入条那一排在手机上已经排满（390px 宽只剩 28px 空隙），所以优化提示词和设置页的入口都放在「更多操作」里；
// 顶栏的设置按钮在手机宽度下不显示，这里是它们唯一的入口。
describe('手机更多操作里的优化提示词与设置入口', () => {
    const openMore = () => {
        fireEvent.click(screen.getByRole('button', { name: '更多' }));
        return screen.getByRole('dialog', { name: '更多操作' });
    };

    beforeEach(() => {
        useDialogStore.setState({ activeDialog: null, dialogData: {} });
        promptApi.status.mockResolvedValue(OPTIMIZE_ENABLED);
    });

    it('那一排按钮保持原样，三个入口都在更多操作里', () => {
        mount();
        // 不能再往输入条那一排加按钮，否则 390px 宽的手机上「发送」会被挤到第二行
        const rowButtons = Array.from(screen.getByTestId('mobile-persistent-actions').querySelectorAll('button'))
            .map(button => button.getAttribute('aria-label'));
        expect(rowButtons).toEqual(['文件引用', '图片附件', '拍照', '命令', '语音输入', '发送消息']);

        const more = openMore();
        expect(within(more).getByRole('button', { name: /优化提示词/ })).toBeInTheDocument();
        expect(within(more).getByRole('button', { name: '模型服务商' })).toBeInTheDocument();
        expect(within(more).getByRole('button', { name: '场景分派' })).toBeInTheDocument();
    });

    it('点场景分派打开设置弹窗的对应页并收起面板', async () => {
        mount();
        fireEvent.click(within(openMore()).getByRole('button', { name: '场景分派' }));

        expect(useDialogStore.getState()).toMatchObject({ activeDialog: 'settings', dialogData: { tab: 'scenes' } });
        await waitFor(() => expect(screen.queryByRole('dialog', { name: '更多操作' })).not.toBeInTheDocument());
    });

    it('点模型服务商落到服务商池那页', () => {
        mount();
        fireEvent.click(within(openMore()).getByRole('button', { name: '模型服务商' }));

        expect(useDialogStore.getState()).toMatchObject({ activeDialog: 'settings', dialogData: { tab: 'providers' } });
    });

    it('点优化提示词带着当前草稿和它的草稿键打开优化面板', async () => {
        mount();
        fireEvent.change(screen.getByRole('textbox'), { target: { value: '帮我写个函数' } });
        fireEvent.click(within(openMore()).getByRole('button', { name: /优化提示词/ }));

        const state = useDialogStore.getState();
        expect(state.activeDialog).toBe('promptOptimize');
        expect(state.dialogData.prompt).toBe('帮我写个函数');
        const keyOfDraft = Object.entries(usePromptDraftStore.getState().drafts)
            .find(([, draft]) => draft.input === '帮我写个函数')?.[0];
        expect(state.dialogData.draftKey).toBe(keyOfDraft);
        // 面板不能留在弹窗底下（回归：这一行最初漏了收起）
        await waitFor(() => expect(screen.queryByRole('dialog', { name: '更多操作' })).not.toBeInTheDocument());
    });

    it('草稿为空时只提示，不打开面板', () => {
        mount();
        fireEvent.click(within(openMore()).getByRole('button', { name: /优化提示词/ }));

        expect(useDialogStore.getState().activeDialog).toBeNull();
        expect(useNotificationStore.getState().notifications.map(n => n.message)).toContain('先写点内容，再来优化提示词');
    });

    it('还没配置优化模型时说明原因，点了直接去场景分派', async () => {
        promptApi.status.mockResolvedValue(OPTIMIZE_DISABLED);
        mount();
        const more = openMore();
        // 状态是挂载时异步取的，等它回来
        expect(await within(more).findByText('还没有配置优化用的模型，点击去设置')).toBeInTheDocument();

        fireEvent.click(within(more).getByRole('button', { name: /优化提示词/ }));

        expect(useDialogStore.getState()).toMatchObject({ activeDialog: 'settings', dialogData: { tab: 'scenes' } });
    });

    it('任务运行中禁用优化提示词，设置入口不受影响', () => {
        mount(true);
        const more = openMore();

        expect(within(more).getByRole('button', { name: /优化提示词/ })).toBeDisabled();
        expect(within(more).getByRole('button', { name: '场景分派' })).toBeEnabled();
    });
});
