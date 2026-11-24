/**
 * 「优化提示词」结果面板：打开后自动调用优化模型，结果可以先改再写回草稿。
 * 优化走的是独立于主会话的旁路模型，不占用会话，也不进入对话历史。
 */

import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, Spinner, Textarea } from '@/components/ui';
import { ApiError } from '@/api/request';
import { promptOptimizeApi, type PromptOptimizeResult } from '@/api/promptOptimizeApi';
import { useDialogStore } from '@/store/dialogStore';
import { useNotificationStore } from '@/store/notificationStore';
import { PROMPT_DRAFT_FALLBACK_KEY, usePromptDraftStore } from '@/store/promptDraftStore';

type Phase = 'working' | 'done' | 'unconfigured' | 'failed';

export function OptimizePanel({ onClose }: { onClose: () => void }) {
    const openDialog = useDialogStore(s => s.openDialog);
    const addNotification = useNotificationStore(s => s.addNotification);
    // 输入只在挂载时读一次：之后 dialogData 再变（比如点「去设置」打开了别的弹窗）也不该重新发起优化
    const [prompt] = useState(() => String(useDialogStore.getState().dialogData.prompt ?? ''));
    const [draftKey] = useState(() => String(useDialogStore.getState().dialogData.draftKey ?? ''));

    const [phase, setPhase] = useState<Phase>('working');
    const [meta, setMeta] = useState<PromptOptimizeResult | null>(null);
    const [result, setResult] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [attempt, setAttempt] = useState(0);
    // 同一次优化只发一个请求：开发模式下 StrictMode 会把 effect 跑两遍，两遍共用这个在途请求
    const inFlight = useRef<{ token: string; promise: Promise<PromptOptimizeResult> } | null>(null);

    useEffect(() => {
        const token = `${attempt}\u0000${prompt}`;
        if (!inFlight.current || inFlight.current.token !== token) {
            inFlight.current = { token, promise: promptOptimizeApi.optimize(prompt) };
        }
        let cancelled = false;
        setPhase('working');
        inFlight.current.promise.then(
            response => {
                if (cancelled) return;
                setMeta(response);
                setResult(response.optimized);
                setPhase('done');
            },
            failure => {
                if (cancelled) return;
                if (failure instanceof ApiError && failure.code === 'PROMPT_OPTIMIZE_DISABLED') {
                    setPhase('unconfigured');
                } else {
                    setError(failure instanceof Error && failure.message ? failure.message : '优化失败，请稍后重试');
                    setPhase('failed');
                }
            },
        );
        return () => { cancelled = true; };
    }, [prompt, attempt]);

    const targetKey = draftKey || PROMPT_DRAFT_FALLBACK_KEY;

    const apply = (mode: 'replace' | 'append') => {
        const text = result.trim();
        if (!text) return;
        const drafts = usePromptDraftStore.getState();
        if (mode === 'replace') {
            drafts.setInput(targetKey, text);
        } else {
            // 追加在原草稿下面：原文保留，方便对照
            drafts.setInput(targetKey, previous => {
                const head = previous === '' || previous.endsWith('\n') ? previous : `${previous}\n`;
                return `${head}${text}`;
            });
        }
        onClose();
    };

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(result);
            addNotification({ key: 'prompt-optimize-copied', level: 'success', message: '已复制到剪贴板' });
        } catch {
            addNotification({ key: 'prompt-optimize-copy-failed', level: 'error', message: '复制失败，请手动选中后复制' });
        }
    };

    return (
        <Dialog open title="优化提示词" onClose={onClose} className="max-w-2xl border border-hairline max-h-[85vh] flex flex-col">
            <div className="px-5 pt-4 pb-5 overflow-y-auto min-h-0 flex-1 space-y-4">
                <details>
                    <summary className="cursor-pointer text-[13px] text-t3 hover:text-t2">查看原始提示词</summary>
                    <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-[10px] bg-sunken2 p-3 text-[13px] leading-relaxed text-t2">
                        {prompt}
                    </pre>
                </details>

                {phase === 'working' && (
                    <div className="flex flex-col items-center gap-3 py-8">
                        <p className="flex items-center gap-2 text-sm text-t2"><Spinner /> 正在优化…</p>
                        <Button onClick={onClose}>取消</Button>
                    </div>
                )}

                {phase === 'unconfigured' && (
                    <div className="space-y-3">
                        <p className="text-sm leading-relaxed text-t2">
                            还没有配置优化提示词用的模型。在「设置 › 场景分派」里给「提示词优化」选一个响应快的小模型即可。
                        </p>
                        <Button variant="primary" onClick={() => openDialog('settings', { tab: 'scenes' })}>去设置</Button>
                    </div>
                )}

                {phase === 'failed' && (
                    <div role="alert" className="space-y-3">
                        <p className="rounded-[10px] border border-err bg-errsoft px-3 py-2 text-[13px] text-errstrong">{error}</p>
                        <div className="flex gap-2">
                            <Button variant="primary" onClick={() => setAttempt(value => value + 1)}>重试</Button>
                            <Button onClick={onClose}>关闭</Button>
                        </div>
                    </div>
                )}

                {phase === 'done' && (
                    <>
                        <p className="text-[13px] text-t3">
                            由 {meta?.providerName} / {meta?.model} 生成，可以直接修改后再用。
                        </p>
                        <Textarea
                            aria-label="优化后的提示词"
                            rows={10}
                            value={result}
                            onChange={e => setResult(e.target.value)}
                            autoFocus
                        />
                        <div className="flex flex-wrap justify-end gap-2">
                            <Button onClick={() => { void copy(); }}>复制</Button>
                            <Button onClick={() => apply('append')} disabled={!result.trim()}>追加到草稿</Button>
                            <Button variant="primary" onClick={() => apply('replace')} disabled={!result.trim()}>替换草稿</Button>
                        </div>
                    </>
                )}
            </div>
        </Dialog>
    );
}

export default OptimizePanel;
