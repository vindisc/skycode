/**
 * 「优化提示词」的接口封装（PromptOptimizeController）。
 * 优化调用走的是独立于主会话的旁路模型，端点由设置页的场景分派或环境变量决定。
 */

import { request } from './request';

export interface PromptOptimizeStatus {
    /** 为 false 表示还没有配置优化用的模型 */
    enabled: boolean;
    model: string | null;
    providerName: string | null;
    /** scene_binding = 设置页的场景绑定；env = 环境变量 */
    source: 'scene_binding' | 'env' | null;
}

export interface PromptOptimizeResult {
    optimized: string;
    model: string;
    providerName: string;
    source: string;
}

export const promptOptimizeApi = {
    status: () => request<PromptOptimizeStatus>('/api/prompt/optimize/status'),
    optimize: (prompt: string) =>
        request<PromptOptimizeResult>('/api/prompt/optimize', {
            method: 'POST',
            body: JSON.stringify({ prompt }),
        }),
};
