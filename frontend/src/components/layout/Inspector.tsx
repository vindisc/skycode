/**
 * Inspector — 右侧检查器：只显示与「当前会话」有关的运行信息。
 *
 * 依次是本会话修改过的文件、最近一轮的任务、待审批、用量，没有内容的分节不显示。
 * 模型 / 权限 / 显示方式的切换在顶栏的状态行里（任何宽度都在同一处），这里不再放设置。
 *
 * 仅在视口 ≥1280px 且未被收起时渲染（见 useInspectorVisible）。
 * 顶部不再放会话标题（左栏已经在列表里高亮了当前会话，再写一遍是重复）；
 * 没有可显示的内容时给一句引导，不留一块空白面板。
 */

import React, { useMemo } from 'react';
import { Check, CircleX, Loader2, Minus, PanelRight } from 'lucide-react';
import { TurnFileChanges } from '@/components/message/turn/TurnFileChanges';
import { resolveSectionStatus, resolveTurnOutcome } from '@/components/message/turn/turnUtils';
import { cn } from '@/components/ui/cn';
import { useCostStore } from '@/store/costStore';
import { useMessageStore } from '@/store/messageStore';
import { usePermissionStore } from '@/store/permissionStore';
import { useSessionStore } from '@/store/sessionStore';
import { buildTurns } from '@/store/selectors/turnProjection';
import { buildTurnTaskSections, splitTurnLayers } from '@/store/selectors/turnSections';
import { projectTurnFileChanges } from '@/store/selectors/turnFileChanges';

type TaskStatus = 'completed' | 'running' | 'error' | 'interrupted';

const CARD = 'rounded-md border border-hairline bg-surface2';
const CARD_TITLE = 'px-3 pt-2.5 text-13 font-semibold text-t1';
const ROW = 'flex min-h-9 items-center gap-3 px-3';
const ROW_LABEL = 'min-w-0 flex-1 text-xs text-t2';
const VALUE = 'shrink-0 font-mono text-xs tabular-nums text-t1';

const TASK_STATUS: Record<TaskStatus, { icon: typeof Check; className: string; label: string }> = {
    completed: { icon: Check, className: 'text-ok', label: '已完成' },
    running: { icon: Loader2, className: 'text-accent2-ink', label: '进行中' },
    error: { icon: CircleX, className: 'text-err', label: '失败' },
    interrupted: { icon: Minus, className: 'text-warn', label: '被中断' },
};

export interface InspectorProps {
    className?: string;
}

export const Inspector: React.FC<InspectorProps> = ({ className }) => {
    const sessionId = useSessionStore(s => s.sessionId);
    const status = useSessionStore(s => s.status);
    const messages = useMessageStore(s => s.messages);
    const streamingMessageId = useMessageStore(s => s.streamingMessageId);
    const activeToolCalls = useMessageStore(s => s.activeToolCalls);
    const { sessionCost, totalCost, usage } = useCostStore();
    const pendingPermissions = usePermissionStore(s => s.pendingPermissions);

    const runActive = status === 'streaming' || status === 'waiting_permission';

    const files = useMemo(() => projectTurnFileChanges(messages, activeToolCalls), [messages, activeToolCalls]);

    // 最近一轮的任务分节及各自状态（与过程区聚合条同一套推导）
    const tasks = useMemo(() => {
        const last = buildTurns(messages).at(-1);
        if (!last) return [];
        const { process } = splitTurnLayers(last, streamingMessageId);
        const { sections, hasTaskData } = buildTurnTaskSections(process);
        if (!hasTaskData) return [];
        const outcome = resolveTurnOutcome(last);
        const isActiveTurn = last.status === 'active';
        return sections.map((section, index) => ({
            section,
            status: resolveSectionStatus(section, activeToolCalls, {
                isActiveTurn,
                isRunActive: runActive,
                isLastSection: index === sections.length - 1,
                turnOutcome: outcome,
            }),
        }));
    }, [messages, streamingMessageId, activeToolCalls, runActive]);

    const hasUsage = usage.inputTokens > 0 || usage.outputTokens > 0 || sessionCost > 0;

    return (
        <aside
            className={cn('flex min-h-0 flex-col overflow-hidden', className)}
            aria-label="检查器"
            data-testid="inspector"
        >
            {/* 直接从分节开始：会话名在左栏列表里已经有了 */}
            <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-2.5 pb-2.5 pt-3">
                {files.length === 0 && tasks.length === 0 && pendingPermissions.length === 0 && !(sessionId && hasUsage) && (
                    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                        <span aria-hidden="true" className="flex h-10 w-10 items-center justify-center rounded-md bg-sunken2 text-t3">
                            <PanelRight className="h-5 w-5" />
                        </span>
                        <p className="text-13 leading-relaxed text-t3">
                            {sessionId
                                ? '这个会话还没有修改过的文件或任务'
                                : '发出第一条消息后，这里会列出这个会话修改的文件、任务和用量'}
                        </p>
                    </div>
                )}

                {files.length > 0 && (
                    <section className={CARD} aria-label="修改的文件">
                        <TurnFileChanges files={files} running={runActive} defaultOpen title="修改的文件" />
                    </section>
                )}

                {tasks.length > 0 && (
                    <section className={CARD} aria-label="任务">
                        <h3 className={cn(CARD_TITLE, 'pb-1.5')}>任务 · {tasks.length}</h3>
                        <ul className="pb-1.5">
                            {tasks.map(({ section, status: taskStatus }) => {
                                const meta = TASK_STATUS[taskStatus];
                                return (
                                    <li key={section.index} className={cn(ROW, 'min-h-8 gap-2')}>
                                        <span role="img" aria-label={meta.label} className={cn('inline-flex h-4 w-4 shrink-0 items-center justify-center', meta.className)}>
                                            <meta.icon size={13} aria-hidden="true" className={taskStatus === 'running' ? 'animate-spin' : undefined} />
                                        </span>
                                        <span className="min-w-0 flex-1 truncate text-13 text-t2" title={section.title}>{section.title}</span>
                                    </li>
                                );
                            })}
                        </ul>
                    </section>
                )}

                {pendingPermissions.length > 0 && (
                    <section className={CARD} aria-label="待审批">
                        <h3 className={cn(CARD_TITLE, 'pb-1.5')}>待审批 · {pendingPermissions.length}</h3>
                        <ul className="pb-1.5">
                            {pendingPermissions.map(request => (
                                <li key={request.interactionId ?? request.toolUseId} className="flex items-start gap-2 px-3 pb-1.5">
                                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warn" aria-hidden="true" />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-13 font-medium text-t1" title={request.toolName}>{request.toolName}</span>
                                        <span className="block truncate text-xs text-t3" title={request.reason}>{request.reason}</span>
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                {sessionId && hasUsage && (
                    <section className={CARD} aria-label="用量">
                        <h3 className={cn(CARD_TITLE, 'pb-1.5')}>用量</h3>
                        <dl className="pb-1.5">
                            <div className={ROW}><dt className={ROW_LABEL}>输入 Tokens</dt><dd className={VALUE}>{usage.inputTokens.toLocaleString()}</dd></div>
                            <div className={ROW}><dt className={ROW_LABEL}>输出 Tokens</dt><dd className={VALUE}>{usage.outputTokens.toLocaleString()}</dd></div>
                            {usage.cacheReadInputTokens > 0 && (
                                <div className={ROW}><dt className={ROW_LABEL}>缓存读取</dt><dd className={VALUE}>{usage.cacheReadInputTokens.toLocaleString()}</dd></div>
                            )}
                            <div className={ROW}><dt className={ROW_LABEL}>会话成本</dt><dd className={VALUE}>${sessionCost.toFixed(3)}</dd></div>
                            {totalCost > 0 && <div className={ROW}><dt className={ROW_LABEL}>全局累计</dt><dd className={VALUE}>${totalCost.toFixed(3)}</dd></div>}
                        </dl>
                    </section>
                )}
            </div>
        </aside>
    );
};

export default React.memo(Inspector);
