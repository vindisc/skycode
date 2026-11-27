/**
 * Inspector — 右侧检查器（对应 Skymap 的 Inspector：只显示与「当前会话」有关的设置和信息）。
 *
 * 模型 / 权限 / 显示方式从输入条带挪到这里，输入区只剩输入和发送；三个控件沿用输入区原有的组件，
 * 不另写一套。下面依次是本会话修改过的文件、最近一轮的任务、待审批、用量，没有内容的分节不显示。
 *
 * 仅在视口 ≥1280px 且未被收起时渲染（见 useInspectorVisible）；收起后这三个控件回到输入条带。
 * 没有选中会话时设置卡仍然显示——首页发第一条消息前也要能选模型。
 */

import React, { useMemo } from 'react';
import { Check, CircleX, Loader2, Minus } from 'lucide-react';
import { ModelChip, PermissionModeChip } from '@/components/input/PromptInput/PromptComposerChips';
import { DensitySwitch } from '@/components/input/PromptInput/DensitySwitch';
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
    const customTitle = useSessionStore(s => s.customTitle);
    const messages = useMessageStore(s => s.messages);
    const streamingMessageId = useMessageStore(s => s.streamingMessageId);
    const activeToolCalls = useMessageStore(s => s.activeToolCalls);
    const { sessionCost, totalCost, usage } = useCostStore();
    const pendingPermissions = usePermissionStore(s => s.pendingPermissions);

    const runActive = status === 'streaming' || status === 'waiting_permission';
    // 标题与左栏改名、顶栏同一口径：自定义名称优先，其次首条用户消息
    const firstUserText = useMemo(() => {
        const block = messages.find(m => m.type === 'user')?.content.find(b => b.type === 'text');
        return block?.type === 'text' ? block.text : '';
    }, [messages]);
    const sessionTitle = customTitle?.trim() || firstUserText.trim();
    const title = sessionTitle || '新会话';
    // 悬停提示不挂整段长文本（首条用户消息可能有几百字）
    const titleHint = sessionTitle && sessionTitle.length > 120 ? `${sessionTitle.slice(0, 120)}…` : sessionTitle || undefined;

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
            <div className="px-3.5 pb-2.5 pt-3.5">
                <h2 className="truncate text-13 font-semibold text-t1" title={titleHint}>{title}</h2>
                <p className="mt-0.5 text-xs text-t3">{sessionId ? '当前会话' : '设置在发出第一条消息时生效'}</p>
            </div>

            <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-2.5 pb-2.5">
                {/* 设置：左标签、右控件（Skymap 的行式布局） */}
                <section className={CARD} aria-label="会话设置">
                    <h3 className={CARD_TITLE}>设置</h3>
                    <div className="pb-1.5 pt-1">
                        <div className={ROW}>
                            <span className={ROW_LABEL}>模型</span>
                            <ModelChip />
                        </div>
                        <div className={ROW}>
                            <span className={ROW_LABEL}>权限</span>
                            <PermissionModeChip />
                        </div>
                        <div className={ROW}>
                            <span className={ROW_LABEL}>显示方式</span>
                            <DensitySwitch />
                        </div>
                    </div>
                </section>

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
