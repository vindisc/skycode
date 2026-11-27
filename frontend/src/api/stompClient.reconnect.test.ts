/**
 * STOMP 重连恢复回归测试（2026-11-27 审计修复）。
 *
 * 背景：stompjs 每次重连都新建空订阅表，此前 useStompSubscription 的订阅
 * 在断线重连后永久失效（Coordinator 事件流静默冻结）；useWebSocket 在
 * createStompClient() 一返回就报「已连接」，真实断开从不回调 onDisconnect。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let clientConfig: Record<string, unknown> | undefined;
let connected = false;

const mockClient = {
    activate: vi.fn(),
    deactivate: vi.fn(),
    publish: vi.fn(),
    // 显式带参数签名：无参 mock 的 calls 元组是 []，取 [0][1] 在 CI 的
    // vitest 类型（lock 版本）下报 TS2493
    subscribe: vi.fn((_destination: string, _handler: (m: { body: string }) => void) => ({
        unsubscribe: vi.fn(),
    })),
    active: true,
    get connected() {
        return connected;
    },
};

vi.mock('@stomp/stompjs', () => ({
    Client: vi.fn().mockImplementation((config: Record<string, unknown>) => {
        clientConfig = config;
        return mockClient;
    }),
}));

vi.mock('sockjs-client', () => ({ default: vi.fn() }));

// zustand store 消息派发不参与本文件断言，mock 掉重依赖
vi.mock('@/store/bridgeStore', () => ({
    useBridgeStore: { getState: () => ({ updateBridgeStatus: vi.fn() }) },
}));
vi.mock('@/store/notificationStore', () => ({
    useNotificationStore: { getState: () => ({ addNotification: vi.fn(), removeNotification: vi.fn() }) },
}));
vi.mock('@/store/sessionStore', () => ({
    useSessionStore: { getState: () => ({ sessionId: null }) },
}));

import { useStompSubscription } from '@/hooks/useStompSubscription';
import { renderHook } from '@testing-library/react';
import {
    createStompClient,
    disconnectStomp,
    onStompConnect,
    onStompDisconnect,
} from './stompClient';

function fireOnConnect(): void {
    (clientConfig?.onConnect as () => void)();
}
function fireOnClose(): void {
    (clientConfig?.onWebSocketClose as () => void)();
}

describe('STOMP reconnect listeners', () => {
    beforeEach(() => {
        connected = false;
        clientConfig = undefined;
        mockClient.subscribe.mockClear();
        vi.clearAllMocks();
    });

    afterEach(() => {
        disconnectStomp();
    });

    it('onStompConnect fires on initial connect and again on reconnect', () => {
        createStompClient('', '');
        const listener = vi.fn();
        const off = onStompConnect(listener);

        fireOnConnect();
        expect(listener).toHaveBeenCalledTimes(1);

        // 断开 → 重连 → 再触发
        fireOnClose();
        fireOnConnect();
        expect(listener).toHaveBeenCalledTimes(2);

        off();
        fireOnConnect();
        expect(listener).toHaveBeenCalledTimes(2); // 取消后不再触发
    });

    it('onStompDisconnect fires on real websocket close', () => {
        createStompClient('', '');
        const listener = vi.fn();
        const off = onStompDisconnect(listener);

        fireOnConnect();
        expect(listener).not.toHaveBeenCalled();

        fireOnClose();
        expect(listener).toHaveBeenCalledTimes(1);

        off();
    });
});

describe('useStompSubscription resubscribes after reconnect', () => {
    // stompClient 的 onConnect 自己也会订阅 /user/queue/messages，
    // 断言只统计本 hook 的 topic 订阅
    const topicSubscribes = () =>
        mockClient.subscribe.mock.calls.filter(([dest]) => dest === '/topic/demo');

    beforeEach(() => {
        connected = false;
        clientConfig = undefined;
        mockClient.subscribe.mockClear();
        vi.clearAllMocks();
    });

    afterEach(() => {
        disconnectStomp();
    });

    it('re-creates the subscription when the connection is re-established', () => {
        createStompClient('', '');

        const handler = vi.fn();
        const { unmount } = renderHook(() => useStompSubscription('/topic/demo', handler));

        // 首次连接（onConnect 在握手完成后才触发，对应 connected=true）
        connected = true;
        fireOnConnect();
        expect(topicSubscribes()).toHaveLength(1);

        // 断线（旧订阅随连接消亡）→ 重连 → 订阅必须重建
        fireOnClose();
        fireOnConnect();
        expect(topicSubscribes()).toHaveLength(2);

        unmount();
    });

    it('subscribes via polling when already connected at mount, without duplicates on later reconnects', () => {
        createStompClient('', '');
        connected = true; // 挂载时连接已就绪：走 ensureSubscribed 的直连路径

        const handler = vi.fn();
        const { unmount } = renderHook(() => useStompSubscription('/topic/demo', handler));
        expect(topicSubscribes()).toHaveLength(1);

        // 连接建立回调再触发一次（新连接周期）也不得产生重复订阅对象
        fireOnClose();
        fireOnConnect();
        expect(topicSubscribes()).toHaveLength(2);

        unmount();
    });

    it('invokes the latest handler via ref when a message arrives', () => {
        createStompClient('', '');
        connected = true;

        const first = vi.fn();
        const second = vi.fn();
        const { rerender } = renderHook(
            ({ h }) => useStompSubscription('/topic/demo', h),
            { initialProps: { h: first } },
        );

        const subscribed = topicSubscribes()[0];
        if (!subscribed) throw new Error('topic subscription was not created');
        const onMessage = subscribed[1];
        onMessage({ body: 'x' });
        expect(first).toHaveBeenCalledTimes(1);

        rerender({ h: second });
        onMessage({ body: 'y' });
        expect(second).toHaveBeenCalledTimes(1);
        expect(first).toHaveBeenCalledTimes(1); // 旧 handler 不再被调
    });
});
