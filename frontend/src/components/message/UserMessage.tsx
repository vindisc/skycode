/**
 * UserMessage — 用户消息渲染组件
 *
 * SPEC: §8.2.1 UserMessage, §8.2.4J MessageType='user'
 * 渲染用户输入文本 + 附件预览。
 *
 * 右侧气泡（聊天记录的样子）：靠右、最多占 85% 宽、悬停一档的浅底色（比回复卡片亮），
 * 文字在气泡内正常左对齐——长段落的可读性优先于形式上的右对齐。时间与操作收在气泡右下，
 * 桌面端悬停才出现（见 MessageActions）。
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
            {/* 右侧气泡：像聊天记录那样靠右，最多占 85% 宽；文字在气泡内正常左对齐。
                底色用悬停一档（比回复的凸起卡片亮），时间与操作在气泡内右下、悬停才出现。 */}
            <div className="user-message-bubble min-w-0 max-w-[85%] rounded-md bg-hover2 px-4 py-2.5 text-15 leading-[1.7] text-t1">
                {disclosure && (
                    <div className="mb-0.5 flex justify-end">
                        <button type="button" aria-expanded={expanded} aria-label={`这条消息，点击${expanded ? '收起' : '展开'}`}
                            onClick={disclosure.onToggle}
                            className="dialog-control -mr-2 flex min-h-6 items-center gap-1 rounded-sm px-2 text-13 text-t3 hover:bg-hover2 hover:text-t1 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent2-ring">
                            {expanded ? '收起' : '展开'}
                            <ChevronRight size={13} aria-hidden="true" className={`shrink-0 ${expanded ? 'rotate-90' : ''}`} />
                        </button>
                    </div>
                )}
                {!expanded && <p className="truncate text-t2">{summary}</p>}
                {expanded && (
                    <>
                        <div className="min-w-0 [overflow-wrap:anywhere]">
                            {message.content.map((block, i) => (
                                <ContentBlockRenderer key={i} block={block} messageId={message.uuid} />
                            ))}
                        </div>
                        {/* 时间与操作收在气泡右下，不另占一行的高度；桌面端悬停才出现 */}
                        <MessageActions message={message} className="mt-0.5" />
                    </>
                )}
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
                    thumbnail
                    onRemove={enabled ? stripImages : undefined}
                    removing={removing}
                />
            );
        default:
            return null;
    }
};

export default React.memo(UserMessage);
