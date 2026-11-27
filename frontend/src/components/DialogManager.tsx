/**
 * DialogManager — 全局对话框管理器
 * 
 * 统一管理应用中所有对话框的显示：
 * - PermissionDialog (权限请求)
 * - ElicitationDialog (反向提问)
 * - SettingsPanel (外观 / 模型服务商 / 场景分派)
 * - OptimizePanel (优化提示词)
 */

import React from 'react';
import { useDialogStore } from '@/store/dialogStore';
import { usePermissionStore } from '@/store/permissionStore';
import { useActivityStore } from '@/store/activityStore';
import { useAppUiStore } from '@/store/appUiStore';
import { useSessionStore } from '@/store/sessionStore';
import { useNotificationStore } from '@/store/notificationStore';
import PermissionDialog from '@/components/permission/PermissionDialog';
import { ElicitationDialog } from '@/components/dialog/ElicitationDialog';
import { SettingsPanel } from '@/components/dialog/SettingsPanel';
import { OptimizePanel } from '@/components/dialog/OptimizePanel';
import { KeyboardShortcutsDialog } from '@/components/dialog/KeyboardShortcutsDialog';
import { McpManagementPage } from '@/components/mcp/McpManagementPage';
import { MemoryPage } from '@/components/memory/MemoryPage';
import { SkillManagementPage } from '@/components/skills/SkillManagementPage';
import { recoverPendingInteractions } from '@/api/dispatch';

export const DialogManager: React.FC = () => {
    const { activeDialog, closeDialog } = useDialogStore();
    const { pendingPermissions, respondPermission } = usePermissionStore();
    const currentPermission = pendingPermissions[0] ?? null;
    const { elicitationDialog, dismissElicitationDialog } = useAppUiStore();

    const submitDecision = React.useCallback(async (
        interactionId: string,
        expectedVersion: number,
        decision: 'allow' | 'deny' | 'answer' | 'cancel',
        response?: unknown,
        remember = false,
        scope = 'session',
        optionId?: string,
        operationHash?: string,
        deliveryGeneration?: number,
    ) => {
        const sessionId = useSessionStore.getState().sessionId;
        if (!sessionId) throw new Error('SESSION_NOT_BOUND');
        const result = await fetch(`/api/interactions/${encodeURIComponent(interactionId)}/decisions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Session-Id': sessionId },
            body: JSON.stringify({ expectedVersion, decision, response, remember, scope, optionId, operationHash, deliveryGeneration }),
        });
        if (!result.ok) {
            const payload = await result.json().catch(() => ({})) as { code?: string };
            const failure = new Error(payload.code ?? `INTERACTION_DECISION_FAILED_${result.status}`);
            Object.assign(failure, { status: result.status });
            throw failure;
        }
    }, []);

    // 业务裁决通过 REST 提交；WebSocket 只负责通知和“已收到”ACK。
    const handlePermissionDecision = React.useCallback(async (decision: { toolUseId: string; decision: 'allow' | 'deny'; remember?: boolean; scope?: string; optionId: string; operationHash: string; deliveryGeneration: number }) => {
        const request = usePermissionStore.getState().pendingPermissions
            .find(item => item.toolUseId === decision.toolUseId);
        // 协议字段缺失时不能静默吞掉用户的决定——弹窗会看起来「点了没反应」
        if (!request?.interactionId || request.version === undefined) {
            useNotificationStore.getState().addNotification({
                key: `permission-protocol-${decision.toolUseId}`,
                level: 'warning',
                message: '权限请求协议不完整（缺 interactionId/version），请刷新页面后重试。',
                priority: 'high',
                timeout: 0,
            });
            throw new Error('PERMISSION_PROTOCOL_INCOMPLETE');
        }
        try {
            await submitDecision(request.interactionId, request.version, decision.decision,
                undefined, decision.remember, decision.scope, decision.optionId, decision.operationHash,
                decision.deliveryGeneration);
        } catch (error) {
            console.error('[Interaction] Permission decision failed:', error);
            if (error instanceof Error && error.message === 'PERMISSION_PROTOCOL_MISMATCH') {
                usePermissionStore.getState().removeInteraction(request.interactionId);
                useNotificationStore.getState().addNotification({
                    key: `permission-upgrade-${request.interactionId}`,
                    level: 'warning',
                    message: '客户端版本已更新，请刷新页面后重试。',
                    priority: 'high',
                    timeout: 0,
                });
            }
            if (error instanceof Error && (error as Error & { status?: number }).status === 409) {
                const sessionId = useSessionStore.getState().sessionId;
                if (sessionId) {
                    usePermissionStore.getState().removeInteraction(request.interactionId);
                    await recoverPendingInteractions(sessionId);
                }
            }
            throw error;
        }
        respondPermission(decision, request.interactionId);
        if (usePermissionStore.getState().pendingPermissions.length === 0) {
            useSessionStore.getState().setStatus('streaming');
        }
        if (decision.decision === 'allow') {
            useActivityStore.getState().markToolUseApproved(decision.toolUseId);
        } else {
            useActivityStore.getState().markToolUseDenied(decision.toolUseId);
        }
    }, [respondPermission, submitDecision]);

    const handleElicitationSubmit = React.useCallback(async (_requestId: string, response: string | string[]) => {
        const current = useAppUiStore.getState().elicitationDialog;
        if (!current?.interactionId || current.version === undefined) {
            // 抛给 ElicitationDialog 显示，而不是静默返回（用户点了确认没反应）
            throw new Error('请求协议不完整（缺 interactionId/version）');
        }
        try {
            await submitDecision(current.interactionId, current.version, 'answer', response);
        } catch (error) {
            console.error('[Interaction] Elicitation decision failed:', error);
            // 重新抛出：对话框把失败显示在错误区，请求未过期时可重试
            throw error;
        }
        dismissElicitationDialog(current.interactionId);
        useSessionStore.getState().setStatus('streaming');
    }, [dismissElicitationDialog, submitDecision]);

    const handleElicitationCancel = React.useCallback(async () => {
        if (!elicitationDialog?.interactionId || elicitationDialog.version === undefined) {
            throw new Error('请求协议不完整（缺 interactionId/version）');
        }
        try {
            await submitDecision(elicitationDialog.interactionId, elicitationDialog.version, 'cancel');
        } catch (error) {
            console.error('[Interaction] Elicitation cancel failed:', error);
            throw error;
        }
        dismissElicitationDialog(elicitationDialog.interactionId);
        useSessionStore.getState().setStatus('idle');
    }, [elicitationDialog, dismissElicitationDialog, submitDecision]);

    return (
        <>
            {/* Permission Dialog */}
            {currentPermission && (
                <PermissionDialog
                    key={currentPermission.toolUseId}
                    request={currentPermission}
                    onDecision={handlePermissionDecision}
                />
            )}

            {/* Elicitation Dialog */}
            {elicitationDialog && (
                <ElicitationDialog
                    key={elicitationDialog.interactionId}
                    requestId={elicitationDialog.requestId}
                    interactionId={elicitationDialog.interactionId}
                    question={elicitationDialog.question}
                    options={elicitationDialog.options as { value: string; label: string; description?: string }[] | undefined}
                    inputType={elicitationDialog.multiSelect ? 'multiselect' : 'select'}
                    decisionDeadlineAt={elicitationDialog.decisionDeadlineAt}
                    allowFreeText={!elicitationDialog.options || (elicitationDialog.options as unknown[]).length === 0}
                    onSubmit={handleElicitationSubmit}
                    onCancel={handleElicitationCancel}
                />
            )}

            {/* Settings Panel */}
            {activeDialog === 'settings' && (
                <SettingsPanel onClose={closeDialog} />
            )}

            {/* 优化提示词：dialogData 里带着原始草稿和它所属的草稿键 */}
            {activeDialog === 'promptOptimize' && (
                <OptimizePanel onClose={closeDialog} />
            )}

            {activeDialog === 'keybindings' && (
                <KeyboardShortcutsDialog onClose={closeDialog} />
            )}

            {activeDialog === 'mcp' && (
                <McpManagementPage onClose={closeDialog} />
            )}

            {activeDialog === 'memory' && (
                <MemoryPage onClose={closeDialog} />
            )}

            {activeDialog === 'skills' && (
                <SkillManagementPage onClose={closeDialog} />
            )}
        </>
    );
};

export default DialogManager;
