/**
 * PipelineNode — Pipeline 单节点组件
 * 展示单个 Worker 的状态、进度和错误信息
 */

import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { Hourglass, RefreshCw, Pause, CircleCheck, CircleX, Circle, CircleHelp, TriangleAlert } from 'lucide-react';
import type { WorkerInfo } from '@/types';

interface PipelineNodeProps {
    worker: WorkerInfo;
    swarmId: string;
}

/** 根据 Worker 状态返回对应图标与着色 class（沿用 emoji 原本的状态色） */
function getStatusIcon(worker: WorkerInfo): { icon: LucideIcon; color: string } {
    switch (worker.status) {
        case 'STARTING':
            return { icon: Hourglass, color: 'text-warn' };
        case 'WORKING':
            return { icon: RefreshCw, color: 'text-accent2-ink' };
        case 'IDLE':
            return { icon: Pause, color: 'text-t3' };
        case 'TERMINATED':
            switch (worker.terminationReason) {
                case 'completed':
                    return { icon: CircleCheck, color: 'text-ok' };
                case 'error':
                    return { icon: CircleX, color: 'text-err' };
                case 'aborted':
                    return { icon: Circle, color: 'text-t3' };
                default:
                    return { icon: Circle, color: 'text-t3' };
            }
        default:
            return { icon: CircleHelp, color: 'text-t3' };
    }
}

/** 根据状态返回边框颜色 */
function getStatusBorderColor(worker: WorkerInfo): string {
    switch (worker.status) {
        case 'STARTING':
            return 'border-warn';
        case 'WORKING':
            return 'border-accent2';
        case 'IDLE':
            return 'border-hairline';
        case 'TERMINATED':
            return worker.terminationReason === 'error' ? 'border-err' : 'border-hairline';
        default:
            return 'border-hairline';
    }
}

export const PipelineNode: React.FC<PipelineNodeProps> = ({ worker, swarmId: _swarmId }) => {
    const { icon: StatusIcon, color: statusIconColor } = getStatusIcon(worker);
    const borderColor = getStatusBorderColor(worker);

    return (
        <div className={`rounded-sm border-2 ${borderColor} bg-surfacev2 p-4 shadow-e1 transition-[width]`}>
            {/* Header: Name + Status */}
            <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-sm text-t1 truncate">
                    {worker.workerId}
                </span>
                <span className={`text-lg ${statusIconColor}`} title={`${worker.status}${worker.terminationReason ? ` (${worker.terminationReason})` : ''}`}>
                    <StatusIcon aria-hidden="true" className="h-5 w-5 align-middle" />
                </span>
            </div>

            {/* Progress bar (WORKING state) */}
            {worker.status === 'WORKING' && worker.progressPercent != null && (
                <div className="mb-2">
                    <div className="w-full bg-sunken2 rounded-full h-2">
                        <div
                            className="bg-accent2 h-2 rounded-full transition-[width] duration-slow"
                            style={{ width: `${Math.min(100, Math.max(0, worker.progressPercent))}%` }}
                        />
                    </div>
                    <div className="flex justify-between mt-1">
                        <span className="text-13 text-t2">
                            {worker.completedSteps ?? 0}/{worker.totalSteps ?? '?'} steps
                        </span>
                        <span className="text-13 text-t2">
                            {worker.progressPercent}%
                        </span>
                    </div>
                </div>
            )}

            {/* Current step description */}
            {worker.currentStepDescription && (
                <p className="text-13 text-t2 dark:text-t2 mb-1 truncate" title={worker.currentStepDescription}>
                    {worker.currentStepDescription}
                </p>
            )}

            {/* Error message */}
            {worker.errorMessage && (
                <p className="text-13 text-err mt-1 truncate" title={worker.errorMessage}>
                    <TriangleAlert aria-hidden="true" className="inline-block h-3.5 w-3.5 align-[-0.125em] text-warn" /> {worker.errorMessage}
                </p>
            )}
        </div>
    );
};

export default PipelineNode;
