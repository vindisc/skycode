/**
 * UserMessage — 用户消息渲染组件
 *
 * SPEC: §8.2.1 UserMessage, §8.2.4J MessageType='user'
 * 渲染用户输入文本 + 附件预览。
 *
 * 用户气泡：surface-2 染色填充（不描边、不加阴影，靠底色与页面区分）+
 * rounded-md rounded-br-xs（主圆角 + 小尾角）+ max-w-[92%] sm:max-w-[76%] +
 * padding 11×17，右对齐；禁用高饱和实底。
 */

import React, { useCallback, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { Message, ContentBlock, StripImagesResponse } from '@/types';
import { useSessionStore } from '@/store/sessionStore';
import { useMessageStore } from '@/store/messageStore';
import { useNotificationStore } from '@/store/notificationStore';
import TextBlock from './TextBlock';
import ImageBlock from './ImageBlock';
import MessageActions from './MessageActions';

interface UserMessageProps {
    message: Extract<Message, { type: 'user' }>;
    /** 仅简洁档启用；其他调用保持完整气泡。 */
    disclosure?: { expanded: boolean; onToggle: () => void };
}

const UserMessage: React.FC<UserMessageProps> = ({ message, disclosure }) => {
    // 防御兜底：无可渲染块（如纯 tool_result 载体未被投影路径剔除）时不渲染，避免空气泡
    const hasRenderableBlock = message.content.some(
        block => block.type === 'text' || block.type === 'image',
    );
    if (!hasRenderableBlock) return null;
    const expanded = disclosure?.expanded ?? true;
    const preview = message.content.find(block => block.type === 'text' && block.text.trim());
    const summary = preview?.type === 'text' ? preview.text.trim().slice(0, 120) : '图片附件';

    return (
        <div className="user-message group flex flex-col items-end px-1 pb-2 pt-1">
            {/* Bubble（视觉换肤 §6.3.2：凸起白卡 + hairline 边 + 尾角 6px，右对齐） */}
            <div className="user-message-bubble min-w-0 max-w-[92%] sm:max-w-[76%] [overflow-wrap:anywhere] rounded-md bg-hover2 px-4 py-3 text-15 leading-[1.7] text-t1">
                {disclosure && (
                    <button type="button" aria-expanded={expanded} aria-label={`这条消息，点击${expanded ? '收起' : '展开'}`}
                        onClick={disclosure.onToggle}
                        className="user-message-disclosure panel-control -mx-2 flex min-h-6 w-[calc(100%+1rem)] min-w-0 items-center gap-2 rounded-sm px-2 text-left focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent2-ring max-md:min-h-11">
                        {!expanded && <span className="min-w-0 flex-1 truncate text-15 text-t2">{summary}</span>}
                        <span className="ml-auto shrink-0 text-13 text-t3">{expanded ? '收起' : '展开'}</span>
                        <ChevronRight size={13} aria-hidden="true" className={`shrink-0 text-t3 ${expanded ? 'rotate-90' : ''}`} />
                    </button>
                )}
                {expanded && <>
                    {message.content.map((block, i) => (
                        <ContentBlockRenderer key={i} block={block} messageId={message.uuid} />
                    ))}
                    {/* 时间与操作属于这条问题，收入气泡内，不用横线切成两块。 */}
                    <MessageActions message={message} className="mt-1.5 flex-wrap gap-x-1.5 gap-y-0 border-t-0 pt-0" />
                </>}
            </div>
        </div>
    );
};

/** 剥离消息中的图片并触发重新压缩 — 图片撑爆上下文后的自救入口 */
const useStripImages = (messageId: string, hasImages: boolean) => {
    const sessionId = useSessionStore(s => s.sessionId);
    const status = useSessionStore(s => s.status);
    const applyMessagesUpdate = useMessageStore(s => s.applyMessagesUpdate);
    const addNotification = useNotificationStore(s => s.addNotification);
    const [removing, setRemoving] = useState(false);

    const stripImages = useCallback(async () => {
        if (!sessionId || !hasImages || removing) return;
        setRemoving(true);
        try {
            const res = await fetch(
                `/api/sessions/${sessionId}/messages/${encodeURIComponent(messageId)}/strip-images`,
                { method: 'POST' },
            );
            const data = (await res.json()) as StripImagesResponse & { message?: string };
            if (!res.ok || !data.success) {
                throw new Error(data.message || `移除失败（HTTP ${res.status}）`);
            }
            applyMessagesUpdate(data.messages);
            const compactNote = data.compacted
                ? `已重新压缩：${data.beforeTokens} → ${data.afterTokens} tokens`
                : data.skipReason
                    ? `压缩跳过（${data.skipReason}），图片已移除`
                    : '图片已移除';
            addNotification({
                key: `strip-images-${messageId}-${Date.now()}`,
                level: 'success',
                message: `已移除 ${data.strippedImages} 张图片；${compactNote}`,
            });
        } catch (err) {
            addNotification({
                key: `strip-images-${messageId}-${Date.now()}`,
                level: 'error',
                message: err instanceof Error ? err.message : '移除图片失败',
            });
        } finally {
            setRemoving(false);
        }
    }, [sessionId, messageId, hasImages, removing, applyMessagesUpdate, addNotification]);

    // 会话运行中不允许改动历史（后端也会以 409 拒绝）
    return { stripImages, removing, enabled: hasImages && status === 'idle' };
};

const ContentBlockRenderer: React.FC<{ block: ContentBlock; messageId: string }> = ({ block, messageId }) => {
    const { stripImages, removing, enabled } = useStripImages(
        messageId,
        // hook 必须无条件调用：仅在含图消息上启用移除交互
        block.type === 'image',
    );
    switch (block.type) {
        case 'text':
            return <TextBlock text={block.text} />;
        case 'image':
            return (
                <ImageBlock
                    base64Data={block.base64Data}
                    src={block.url}
                    mediaType={block.mediaType}
                    onRemove={enabled ? stripImages : undefined}
                    removing={removing}
                />
            );
        default:
            return null;
    }
};

export default React.memo(UserMessage);
