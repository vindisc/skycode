import { afterEach, describe, expect, it, vi } from 'vitest';

class ThemeBroadcastChannel {
    static instances: ThemeBroadcastChannel[] = [];
    onmessage: ((event: MessageEvent) => void) | null = null;
    postMessage = vi.fn();
    close = vi.fn();
    constructor(readonly name: string) { ThemeBroadcastChannel.instances.push(this); }
}

afterEach(() => {
    ThemeBroadcastChannel.instances = [];
    vi.unstubAllGlobals();
    vi.resetModules();
});

/** 已下线主题 → 保留主题（旧版本标签页仍可能广播这些值） */
const RETIRED = [
    ['glass', 'light'], ['ink-havoc', 'light'],
    ['ink-havoc-night', 'dark'], ['spaceship', 'dark'], ['galaxy', 'dark'],
] as const;

async function mountStore() {
    vi.resetModules();
    vi.stubGlobal('BroadcastChannel', ThemeBroadcastChannel);
    const { useConfigStore } = await import('../configStore');
    const channel = ThemeBroadcastChannel.instances.find(item => item.name === 'ai-coder-config-broadcast')!;
    expect(channel).toBeDefined();
    return { useConfigStore, channel };
}

function sendTheme(channel: ThemeBroadcastChannel, theme: Record<string, unknown>) {
    channel.onmessage?.(new MessageEvent('message', { data: {
        type: 'STATE_UPDATE',
        senderId: 'another-browser-tab',
        state: { theme, themePreferenceSet: true },
    } }));
}

describe('配置仓库跨标签同步', () => {
    it('接收其他标签页的主题后仍保留动作，后续可切换主题且不回声广播', async () => {
        const { useConfigStore, channel } = await mountStore();
        const before = useConfigStore.getState();
        channel.postMessage.mockClear();
        sendTheme(channel, { ...before.theme, mode: 'dark', accentColor: '#C9578A' });
        expect(useConfigStore.getState().theme.mode).toBe('dark');
        expect(useConfigStore.getState().setTheme).toBe(before.setTheme);
        expect(useConfigStore.getState().loadConfig).toBe(before.loadConfig);
        expect(useConfigStore.getState().locale).toBe(before.locale);
        expect(channel.postMessage).not.toHaveBeenCalled();
        expect(JSON.parse(localStorage.getItem('ai-coder-config')!).state.theme.mode).toBe('dark');

        useConfigStore.getState().setTheme({ mode: 'light' });
        expect(useConfigStore.getState().theme).toMatchObject({ mode: 'light', accentColor: '#C9578A' });
        expect(channel.postMessage).toHaveBeenCalledOnce();
        const outgoing = channel.postMessage.mock.calls[0][0];
        expect(outgoing.state).not.toHaveProperty('setTheme');
        expect(outgoing.state).not.toHaveProperty('sessionId');
        expect(outgoing.state).not.toHaveProperty('bridgeStatus');
        expect(outgoing.state.theme.mode).toBe('light');
    });

    it.each(RETIRED)('旧版本标签页广播来的已下线主题 %s 在进入 state 前迁到 %s', async (mode, expected) => {
        const { useConfigStore, channel } = await mountStore();
        const before = useConfigStore.getState();
        channel.postMessage.mockClear();
        sendTheme(channel, {
            ...before.theme, mode, accentColor: '#C9578A', fontSize: 'large',
            // 旧版本的特效配置随主题一并丢弃
            jellyFx: { cinematic: true, motion: 'full' },
        });
        expect(useConfigStore.getState().theme).toEqual({
            mode: expected, accentColor: '#C9578A', fontSize: 'large',
            fontFamily: before.theme.fontFamily, borderRadius: before.theme.borderRadius,
        });
        expect(useConfigStore.getState().setTheme).toBe(before.setTheme);
        expect(channel.postMessage).not.toHaveBeenCalled();
        expect(JSON.parse(localStorage.getItem('ai-coder-config')!).state.theme.mode).toBe(expected);
    });
});
