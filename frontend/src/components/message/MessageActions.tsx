/**
 * MessageActions — 消息操作行
 *
 * 每条 user/assistant 消息底部渲染：
 * - 复制按钮 (Copy 图标，点击后切换 Check 图标 2 秒恢复)
 * - 时分秒时间戳 (X月X日（周X）HH:MM:SS)
 *
 * §7.2 消息操作行：ghost 小钮默认 text-t4，hover 消息块（父级 group）升 text-t2，
 * 行顶 hairline 分隔。复制规则:
 * - 有文本 → 复制 text 块 Markdown 源码 (navigator.clipboard.writeText)
 * - 无文本但有图片 → base64 转 Blob 复制图片 (navigator.clipboard.write + ClipboardItem，
 *   不支持或失败时降级复制图片 URL 文本)
 * - 无可复制内容 / 流式进行中 → 不渲染复制按钮 (时间戳照常显示)
 * - 图文混合消息额外渲染"复制全部"按钮 (CopyPlus 图标 + 文字，"运行中"同款
 *   soft 徽章：bg-accent2-soft + border-accent2-ring + text-accent2-ink)，
 *   复制「全部文本 + 全部图片链接」纯文本；粘贴回输入框时图片以 URL 文字随行，
 *   由 agent 自行下载查看，不触发输入框的图片附件粘贴逻辑
 */

import React, { useCallback, useState } from 'react';
import { Copy, CopyPlus, Check, Undo2 } from 'lucide-react';
import type { Message } from '@/types';
import { formatMessageTime, formatMessageTimeShort } from '@/utils/datetime';
import { cn } from '@/components/ui/cn';
import { useSessionStore } from '@/store/sessionStore';
import { useMessageStore } from '@/store/messageStore';
import { useNotificationStore } from '@/store/notificationStore';
import {
    extractMessageText,
    extractMessageImage,
    extractMessageImages,
    hasCopyableContent,
    copyImageToClipboard,
    copyMessageWithImageRefs,
} from '@/utils/messageContent';

/**
 * 这条消息能否撤回。
 *
 * 含工具调用或工具结果的消息不能撤回：删掉一侧会留下配不上对的另一半——工具卡片会永远
 * 显示运行中，下次请求还会带上没有对应 tool_call 的 tool_result 被模型接口拒绝。
 * 服务端（MessageRecallService）有同样的限制，这里只是不给出注定失败的入口。
 */
export function isRecallableMessage(message: Message): boolean {
    // Message 是封闭联合：除了 user / assistant，其余分支（system、visualization 等）都不是对话消息
    if (message.type !== 'user' && message.type !== 'assistant') return false;
    return !message.content.some(block => block.type === 'tool_use' || block.type === 'tool_result');
}

interface MessageActionsProps {
    message: Message;
    /** 流式进行中的 assistant 消息不显示复制按钮 */
    isStreaming?: boolean;
    className?: string;
}

/** 复制成功图标反馈时长 (ms)，与 CodeBlock 保持一致 */
const COPY_ICON_RESET_MS = 2000;

/**
 * 操作行的显隐：能悬停的设备（桌面）平时整行藏起，鼠标移到所在消息上、或键盘聚焦进来才出现；
 * 触屏没有悬停，一直显示。所在消息的根节点带 `group`。用透明度而不是 display，
 * 行高保持不变，悬停时不会把下面的内容顶开。
 */
export const MESSAGE_ACTIONS_REVEAL =
    '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-within:opacity-100';

const ACTION_BUTTON =
    'message-action-button inline-flex shrink-0 items-center justify-center rounded-sm text-t3 transition-colors duration-fast '
    + 'hover:bg-hover2 hover:!text-t1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent2-ink';

const MessageActions: React.FC<MessageActionsProps> = ({ message, isStreaming = false, className }) => {
    const [copied, setCopied] = useState(false);
    const [copyAllState, setCopyAllState] = useState<'idle' | 'copied' | 'failed'>('idle');
    const [recalling, setRecalling] = useState(false);
    const sessionId = useSessionStore(s => s.sessionId);
    const sessionStatus = useSessionStore(s => s.status);
    const removeMessage = useMessageStore(s => s.removeMessage);
    const addNotification = useNotificationStore(s => s.addNotification);

    const copyable = !isStreaming && hasCopyableContent(message);
    // 「复制全部」仅在图文混合时显示：纯文本消息与普通复制等价，纯图片消息无文本可带
    const copyAllable = !isStreaming
        && extractMessageText(message) !== null
        && extractMessageImages(message).length > 0;

    const handleCopy = useCallback(async () => {
        try {
            const text = extractMessageText(message);
            if (text !== null) {
                await navigator.clipboard.writeText(text);
            } else {
                const image = extractMessageImage(message);
                if (!image) return;
                await copyImageToClipboard(image);
            }
            setCopied(true);
            setTimeout(() => setCopied(false), COPY_ICON_RESET_MS);
        } catch {
            // 剪贴板权限被拒等场景静默失败，不打断 UI
        }
    }, [message]);

    const handleCopyAll = useCallback(async () => {
        try {
            await copyMessageWithImageRefs(message);
            setCopyAllState('copied');
        } catch {
            setCopyAllState('failed');
        }
        setTimeout(() => setCopyAllState('idle'), COPY_ICON_RESET_MS);
    }, [message]);

    // 撤回入口只在会话空闲时出现：会话运行中服务端会拒绝改动历史
    const recallable = !isStreaming && sessionId != null && sessionStatus === 'idle'
        && isRecallableMessage(message);

    const handleRecall = useCallback(async () => {
        if (!sessionId || recalling) return;
        if (!window.confirm('撤回这条消息？撤回后无法恢复。')) return;
        setRecalling(true);
        try {
            const response = await fetch(
                `/api/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(message.uuid)}`,
                { method: 'DELETE' },
            );
            if (!response.ok) {
                const body = await response.json().catch(() => null);
                throw new Error(body?.error?.message || `撤回失败（HTTP ${response.status}）`);
            }
            // 服务端同时会广播 message_recalled；这里直接移除，WebSocket 未连接时界面也保持一致
            removeMessage(message.uuid);
        } catch (err) {
            addNotification({
                key: `recall-${message.uuid}-${Date.now()}`,
                level: 'error',
                message: err instanceof Error ? err.message : '撤回失败，请稍后重试。',
            });
        } finally {
            setRecalling(false);
        }
    }, [sessionId, recalling, message.uuid, removeMessage, addNotification]);

    return (
        <div
            className={cn(
                'message-actions flex h-8 items-center justify-end gap-0.5 transition-opacity duration-fast',
                MESSAGE_ACTIONS_REVEAL,
                className,
            )}
        >
            {copyAllable && (
                <button
                    type="button"
                    onClick={handleCopyAll}
                    className={cn(
                        'message-copy-all inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-sm px-2 text-13 transition-colors duration-fast hover:bg-hover2',
                        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent2-ink',
                        copyAllState === 'copied' ? 'text-ok' : copyAllState === 'failed' ? 'text-err' : 'text-t3 hover:text-t1',
                    )}
                    title={copyAllState === 'copied' ? '已复制全部内容' : copyAllState === 'failed' ? '复制失败' : '复制全部内容（含图片链接）'}
                    aria-label={copyAllState === 'copied' ? '已复制全部内容' : copyAllState === 'failed' ? '复制失败' : '复制全部内容（含图片链接）'}
                    data-testid="message-copy-all-button"
                >
                    {copyAllState === 'copied' ? <Check className="h-4 w-4" /> : <CopyPlus className="h-4 w-4" />}
                    <span className="leading-none">
                        {copyAllState === 'copied' ? '已复制' : copyAllState === 'failed' ? '复制失败' : '复制全部'}
                    </span>
                </button>
            )}
            {copyable && (
                <button
                    type="button"
                    onClick={handleCopy}
                    className={ACTION_BUTTON}
                    title={copied ? '已复制' : '复制'}
                    aria-label={copied ? '已复制' : '复制'}
                    data-testid="message-copy-button"
                >
                    {copied ? <Check className="h-4 w-4 text-ok" /> : <Copy className="h-4 w-4" />}
                </button>
            )}
            {recallable && (
                <button
                    type="button"
                    onClick={() => { void handleRecall(); }}
                    disabled={recalling}
                    className={cn(ACTION_BUTTON, 'hover:!text-err disabled:opacity-40')}
                    title="撤回这条消息"
                    aria-label="撤回这条消息"
                    data-testid="message-recall-button"
                >
                    <Undo2 className="h-4 w-4" />
                </button>
            )}
            {/* 平时只显示时分，完整的日期和星期放在悬停提示里 */}
            <time
                className="message-timestamp px-1.5 text-xs text-t3 tabular-nums select-none"
                data-testid="message-timestamp"
                title={formatMessageTime(message.timestamp)}
                dateTime={new Date(message.timestamp).toISOString()}
            >
                {formatMessageTimeShort(message.timestamp)}
            </time>
        </div>
    );
};

export default React.memo(MessageActions);
