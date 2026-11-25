/**
 * 设置页「运行状态」：一屏只读信息，回答"我的配置到底生效了没有"。
 * - Python 服务起没起来、哪些能力可用（代码洞察、增强 Git、浏览器自动化等依赖它）
 * - 每条管线此刻实际在用哪个模型、是设置页里分派的还是配置文件里的
 * - 哪些服务商注册进了运行时
 */

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button, Chip, Spinner } from '@/components/ui';
import { runtimeApi, type RuntimeModelStatus, type RuntimeStatus } from '@/api/settingsApi';
import { messageOf } from './providerForm';

/** 能力域代码 → 界面上的说法。顺序由后端固定；没见过的代码原样显示 Python 给的名字。 */
const CAPABILITY_LABELS: Record<string, string> = {
    CODE_INTEL: '代码洞察',
    FILE_PROCESSING: '文件处理',
    GIT_ENHANCED: '增强 Git',
    BROWSER_AUTOMATION: '浏览器自动化',
    CODE_QUALITY: '代码质量',
    ANALYSIS: '变更影响分析',
    HTTP_API: 'HTTP 接口校验',
};

const ROW = 'grid gap-1 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-baseline sm:gap-3 py-1.5';

export function RuntimeStatusPanel() {
    const [status, setStatus] = useState<RuntimeStatus | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoadError(null);
        try {
            setStatus(await runtimeApi.status());
        } catch (err) {
            setLoadError(messageOf(err, '运行状态加载失败'));
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    if (loadError && !status) {
        return (
            <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[10px] border border-err bg-errsoft px-3 py-2 text-[13px] text-errstrong">
                <span>{loadError}</span>
                <Button size="sm" onClick={() => { void load(); }}>重试</Button>
            </div>
        );
    }
    if (!status) {
        return <div className="flex justify-center py-8"><Spinner label="正在读取运行状态" /></div>;
    }

    const python = status.python;
    return (
        <div className="space-y-5" data-testid="runtime-status-panel">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="text-base font-semibold text-t1">运行状态</h3>
                    <p className="mt-1 text-[13px] leading-relaxed text-t3">
                        这里是后端此刻的真实状态，改了配置不用猜有没有生效，回来看这一页就行。
                    </p>
                </div>
                <Button size="sm" onClick={() => { void load(); }} className="shrink-0">
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    刷新
                </Button>
            </div>

            <section aria-label="Python 服务" data-testid="python-status">
                <h4 className="text-sm font-medium text-t2">Python 服务</h4>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
                    <Chip variant={python.healthy ? 'ok' : 'warn'}>
                        {python.healthy ? '运行中' : python.running ? '进程在跑，接口不通' : '没有运行'}
                    </Chip>
                    <span className="text-t3">
                        {python.serviceUrl}
                        {python.running && <span> · 自动拉起次数 {python.restartCount}</span>}
                    </span>
                </div>
                {!python.healthy && python.hint && (
                    <p role="status" className="mt-2 rounded-[10px] border border-warn bg-warnsoft px-3 py-2 text-[13px] text-warnstrong">
                        {python.hint}
                    </p>
                )}
                {python.capabilities.length > 0 && (
                    <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Python 能力">
                        {python.capabilities.map(capability => (
                            <li key={capability.key ?? capability.name}>
                                <Chip variant={capability.available ? 'ok' : 'neutral'}
                                    title={capability.reason ?? undefined}>
                                    {CAPABILITY_LABELS[capability.key ?? ''] ?? CAPABILITY_LABELS[capability.name] ?? capability.name}
                                    {!capability.available && capability.reason ? `（${capability.reason}）` : ''}
                                </Chip>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section aria-label="各条管线使用的模型" data-testid="pipeline-status">
                <h4 className="text-sm font-medium text-t2">各条管线使用的模型</h4>
                <div className="mt-1 divide-y divide-hairline">
                    <PipelineRow label="主对话默认模型" status={status.defaultModel} />
                    <PipelineRow label="压缩摘要" status={status.summary}
                        note={!status.summary.enabled ? '压缩摘要已在配置里关掉' : status.summary.unavailable ? `不可用：${status.summary.unavailable}` : undefined} />
                    <PipelineRow label="后台小任务" status={status.fastModel} />
                    <PipelineRow label="子 Agent" status={status.subAgentModel} />
                    <PipelineRow label="图片理解兜底" status={status.visionFallbackModel} />
                    <PipelineRow label="提示词优化" status={status.promptOptimizeModel}
                        note={status.promptOptimizeModel.model == null ? '还没有配置；到「场景分派」里给「提示词优化」选一个模型' : undefined} />
                </div>
            </section>

            <section aria-label="已注册的服务商" data-testid="registered-providers">
                <h4 className="text-sm font-medium text-t2">已注册的服务商</h4>
                <div className="mt-2 flex flex-wrap gap-1.5">
                    {status.configuredProviders.map(name => <Chip key={name} variant="accent">{name}</Chip>)}
                    {status.poolProviders.map(name => <Chip key={name} variant="ok">{name}</Chip>)}
                    {status.configuredProviders.length + status.poolProviders.length === 0 && (
                        <span className="text-[13px] text-t3">没有任何服务商注册进运行时</span>
                    )}
                </div>
            </section>
        </div>
    );
}

function PipelineRow({ label, status, note }: { label: string; status: RuntimeModelStatus | null; note?: string }) {
    return (
        <div className={ROW}>
            <span className="text-[13px] text-t2">{label}</span>
            <span className="min-w-0 text-[13px]">
                {status?.model
                    ? (
                        <>
                            <span className="text-t1">{status.model}</span>
                            {status.source && <SourceTag source={status.source} />}
                        </>
                    )
                    : <span className="text-t4">没有生效的模型</span>}
                {note && <span className="block text-t3">{note}</span>}
            </span>
        </div>
    );
}

/** 来源标签：设置页里分派的 / 配置文件里的 / 环境变量 / 跟随主对话 */
function SourceTag({ source }: { source: string }) {
    const [kind, provider] = source.split(':');
    const text = kind === 'scene_binding'
        ? `来自设置页的分派（${provider}）`
        : kind === 'config' ? '配置文件'
            : kind === 'env' ? '环境变量'
                : kind === 'inherit' ? '跟随主对话'
                    : source;
    return <span className="ml-2 text-t3">· {text}</span>;
}

export default RuntimeStatusPanel;
