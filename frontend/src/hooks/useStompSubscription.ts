/**
 * useStompSubscription — STOMP topic 订阅 React Hook
 *
 * 对齐 ZhikunCode 差异化升级方案 v1.5（B/C 共用前置任务）：
 * - 升级项 B（§3.5 多 Agent 协作可观测）：订阅 /user/queue/coordinator/{workflowId} 等
 * - 升级项 C（§4.5 自动可视化）：visualization 走 /queue/messages 主通路，不依赖本 Hook
 *
 * 设计：
 * - 薄封装 stompClient.getStompClient()
 * - 挂载时连接未就绪则小间隔轮询；stompjs 每次重连都会清空订阅表，
 *   所以通过 stompClient.onStompConnect 在「首次连接 + 每次重连」时重建订阅
 *   （2026-11-27 审计修复：此前断线重连后订阅永久失效，事件流静默冻结）
 * - 卸载时自动取消订阅；topic 变化时自动重订阅
 * - handler 走 ref 转发，避免订阅因 handler 闭包变化而抖动
 *
 * 使用示例：
 *   useStompSubscription('/user/queue/coordinator/abc', (msg) => {
 *       const event = JSON.parse(msg.body);
 *       // ...
 *   });
 */

import { useEffect, useRef } from 'react';
import type { IMessage, StompSubscription } from '@stomp/stompjs';
import { getStompClient, onStompConnect } from '@/api/stompClient';

/** STOMP 订阅 handler 类型 */
export type StompMessageHandler = (message: IMessage) => void;

/** 轮询等待连接就绪：100ms 间隔 */
const CONNECT_WAIT_INTERVAL_MS = 100;

/**
 * 订阅指定 STOMP topic。
 * @param topic   topic 地址（传 null 或 undefined 跳过订阅）
 * @param handler 收到消息时的回调；handler 变化不会触发重新订阅
 */
export function useStompSubscription(
    topic: string | null | undefined,
    handler: StompMessageHandler,
): void {
    // 使用 ref 转发 handler，避免每次 handler 变化都重建订阅
    const handlerRef = useRef<StompMessageHandler>(handler);
    useEffect(() => {
        handlerRef.current = handler;
    }, [handler]);

    useEffect(() => {
        if (!topic) return;

        let cancelled = false;
        let subscription: StompSubscription | null = null;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const subscribe = (client: NonNullable<ReturnType<typeof getStompClient>>): void => {
            try {
                subscription = client.subscribe(topic, (msg) => {
                    // 经 ref 调用，保证 handler 始终为最新闭包
                    handlerRef.current(msg);
                });
            } catch (err) {
                console.warn(
                    `[useStompSubscription] subscribe failed for topic="${topic}":`,
                    err,
                );
            }
        };

        const ensureSubscribed = (): void => {
            if (cancelled || subscription) return;
            const client = getStompClient();
            if (client && client.connected) {
                subscribe(client);
                return;
            }
            timer = setTimeout(ensureSubscribed, CONNECT_WAIT_INTERVAL_MS);
        };

        // 连接每次建立（首次 + 每次重连）都会触发。旧订阅随旧连接一起消亡
        // （broker 侧订阅表已随断线清空），直接丢弃引用重建即可；
        // 不要对旧对象调 unsubscribe——它可能向新连接发多余的 UNSUBSCRIBE 帧。
        const unsubscribeListener = onStompConnect(() => {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            subscription = null;
            ensureSubscribed();
        });

        ensureSubscribed();

        return () => {
            cancelled = true;
            unsubscribeListener();
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            if (subscription) {
                try {
                    subscription.unsubscribe();
                } catch (err) {
                    console.debug(
                        `[useStompSubscription] unsubscribe failed for topic="${topic}":`,
                        err,
                    );
                }
                subscription = null;
            }
        };
    }, [topic]);
}

export default useStompSubscription;
