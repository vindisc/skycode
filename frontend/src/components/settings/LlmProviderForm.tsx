/**
 * 服务商的新增 / 编辑表单。只负责收集输入并在本地做一遍基础校验；
 * 保存结果、注册情况和不在能力表里的模型由父组件 LlmProvidersSettings 展示。
 * 密钥只写不读：编辑时输入框是空的，留空提交表示保持原值。
 * <p>
 * 有两种服务商：设置页里添加的（名字、地址都自己填），和配置文件里预置的
 * （OpenAI、百炼、DeepSeek……，传入 {@link LlmProviderFormProps#configured}）——
 * 后者的名字是注册名，不能改；接口地址只有配置里允许覆盖的（目前是 DeepSeek）才能改。
 */

import { useEffect, useId, useMemo, useState } from 'react';
import { Button, Input, Textarea, Toggle, cn, inputVariants } from '@/components/ui';
import { ApiError } from '@/api/request';
import type { LlmProviderInput, LlmProviderView } from '@/api/settingsApi';
import {
    providerInputFromForm,
    splitModelList,
    validateProviderForm,
    type ProviderFormState,
} from './providerForm';

interface LlmProviderFormProps {
    initial: ProviderFormState;
    /** 编辑时传入，用来提示当前密钥 */
    existing?: LlmProviderView;
    /** 为 false 时密钥输入框禁用：后端没有稳定的加密密钥，保存会被拒绝 */
    apiKeyStorageReady: boolean;
    busy: boolean;
    /** 保存被拒绝时后端给出的原因 */
    saveError: string | null;
    onSubmit: (input: LlmProviderInput) => void;
    onCancel: () => void;
    /**
     * 向服务商的 /models 接口要模型清单；表单负责把结果并进模型清单。不传就不显示这个入口。
     * 编辑配置里的服务商时由父组件自己决定用哪把密钥，所以只通知一声
     */
    onDiscover?: (input: { baseUrl: string; apiKey: string | null }) => Promise<string[]>;
    /** 表单里有没有相对初始值改动过的内容。父组件用它决定关闭弹窗、切换标签页前要不要确认 */
    onDirtyChange?: (dirty: boolean) => void;
    /** 编辑的是配置文件里预置的服务商时传入 */
    configured?: {
        /** 注册名，例如 huoshenai。名称不能改（压缩摘要等链路按这个名字找它） */
        name: string;
        displayName: string;
    };
}

const LABEL = 'block text-sm font-medium text-t2 mb-1.5';
const HINT = 'mt-1.5 text-[13px] leading-relaxed text-t3';

export function LlmProviderForm({
    initial,
    existing,
    apiKeyStorageReady,
    busy,
    saveError,
    onSubmit,
    onCancel,
    onDiscover,
    onDirtyChange,
    configured,
}: LlmProviderFormProps) {
    const [form, setForm] = useState<ProviderFormState>(initial);
    const [localError, setLocalError] = useState<string | null>(null);
    const [discovering, setDiscovering] = useState(false);
    const [discoveredCount, setDiscoveredCount] = useState<number | null>(null);
    const fieldId = useId();
    const models = useMemo(() => splitModelList(form.modelsText), [form.modelsText]);
    const update = (patch: Partial<ProviderFormState>) => setForm(previous => ({ ...previous, ...patch }));

    const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial]);
    useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

    const defaultInList = form.defaultModel !== '' && models.includes(form.defaultModel);

    const handleSubmit = (event: React.FormEvent) => {
        event.preventDefault();
        const problem = validateProviderForm(form);
        if (problem) {
            setLocalError(problem);
            return;
        }
        setLocalError(null);
        onSubmit(providerInputFromForm(form));
    };

    const handleDiscover = async () => {
        if (!onDiscover) return;
        const baseUrl = form.baseUrl.trim();
        if (!/^https?:\/\//i.test(baseUrl)) {
            setLocalError('请先填写完整的接口地址（以 http:// 或 https:// 开头），再从接口获取模型');
            return;
        }
        setLocalError(null);
        setDiscovering(true);
        try {
            // 配置里的服务商：地址和密钥最终以生效配置为准，由父组件和后端处理
            const discovered = await onDiscover({ baseUrl, apiKey: form.apiKey.trim() || null });
            // 并进已有的清单：保留用户已经填的，去掉重复的
            const merged = [...new Set([...splitModelList(form.modelsText), ...discovered])];
            update({ modelsText: merged.join('\n') });
            setDiscoveredCount(discovered.length);
        } catch (err) {
            // 后端给的原因（密钥不对、地址不通）原样显示；其余错误不给用户看压缩后的代码报错
            setLocalError(err instanceof ApiError && err.message
                ? err.message
                : '获取模型列表失败，请稍后重试');
        } finally {
            setDiscovering(false);
        }
    };

    const id = (name: string) => `${fieldId}-${name}`;
    const error = localError ?? saveError;

    return (
        <form onSubmit={handleSubmit} noValidate className="rounded-[14px] border border-hairline bg-surfacev2 p-4 space-y-4" data-testid="llm-provider-form">
            <h3 className="text-base font-semibold text-t1">
                {configured ? `编辑「${configured.displayName}」` : existing ? `编辑「${existing.name}」` : '添加服务商'}
            </h3>

            <div className="grid gap-4 sm:grid-cols-2">
                <div>
                    <label htmlFor={id('name')} className={LABEL}>服务商名称</label>
                    <Input
                        id={id('name')}
                        value={configured ? `${configured.displayName}（${configured.name}）` : form.name}
                        onChange={e => update({ name: e.target.value })}
                        placeholder="例如：智谱、本地 Ollama"
                        autoComplete="off"
                        autoFocus
                        disabled={!!configured}
                        readOnly={!!configured}
                        title={configured ? '注册名不能改' : undefined}
                    />
                </div>
                <div>
                    <label htmlFor={id('base-url')} className={LABEL}>接口地址</label>
                    <Input
                        id={id('base-url')}
                        value={form.baseUrl}
                        onChange={e => update({ baseUrl: e.target.value })}
                        placeholder="https://api.example.com/v1"
                        autoComplete="off"
                        spellCheck={false}

                    />
                </div>
            </div>

            <div>
                <label htmlFor={id('api-key')} className={LABEL}>API Key</label>
                <Input
                    id={id('api-key')}
                    type="password"
                    value={apiKeyStorageReady ? form.apiKey : ''}
                    onChange={e => update({ apiKey: e.target.value })}
                    // 浏览器和密码管理器不要往这个框里自动填东西
                    autoComplete="new-password"
                    spellCheck={false}
                    disabled={!apiKeyStorageReady}
                    placeholder={existing?.hasApiKey
                        ? `留空则保持不变（当前 ${existing.apiKeyMasked}）`
                        : '本地模型可以留空'}
                />
                <p className={HINT}>
                    {apiKeyStorageReady
                        ? '保存前会加密，保存后只显示末 4 位。'
                        : '当前运行环境没有稳定的加密密钥，暂时不能保存 API Key。请通过环境变量 SKYCODE_ENCRYPTION_KEY 提供密钥后重启服务。'}
                </p>
            </div>

            <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                    <label htmlFor={id('models')} className="text-sm font-medium text-t2">模型清单</label>
                    {onDiscover && (
                        <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-[13px]"
                            loading={discovering}
                            disabled={busy}
                            onClick={() => { void handleDiscover(); }}
                        >
                            从接口获取
                        </Button>
                    )}
                </div>
                <Textarea
                    id={id('models')}
                    rows={5}
                    value={form.modelsText}
                    onChange={e => update({ modelsText: e.target.value })}
                    placeholder={'每行一个，或用逗号分隔\n也可以点右上角的「从接口获取」'}
                    spellCheck={false}
                />
                <p className={HINT} data-testid="models-hint">
                    不在内置能力表里的模型也能用：按相近型号的参数登记，找不到相近的就按通用参数。保存后在列表里能看到依据。
                </p>
                {discoveredCount !== null && (
                    <p role="status" className={HINT}>
                        从接口获取到 {discoveredCount} 个模型，已并入清单；不需要的删掉即可。
                    </p>
                )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
                <div>
                    <label htmlFor={id('default-model')} className={LABEL}>默认模型</label>
                    <select
                        id={id('default-model')}
                        value={defaultInList ? form.defaultModel : ''}
                        onChange={e => update({ defaultModel: e.target.value })}
                        className={cn(inputVariants(), 'pr-8')}
                    >
                        <option value="">{models.length > 0 ? '清单里的第一个' : '（先填写模型清单）'}</option>
                        {models.map(model => (
                            <option key={model} value={model}>{model}</option>
                        ))}
                    </select>
                </div>
                <div className="flex items-end pb-2">
                    <label className="flex items-center gap-2 text-sm text-t2">
                        <Toggle
                            checked={form.enabled}
                            onCheckedChange={enabled => update({ enabled })}
                            aria-label="启用这个服务商"
                        />
                        启用
                    </label>
                </div>
            </div>

            {error && (
                <p role="alert" className="rounded-[10px] border border-err bg-errsoft px-3 py-2 text-[13px] text-errstrong">
                    {error}
                </p>
            )}

            {/* 真正保存的是这里；弹窗底部的「完成」只是关闭 */}
            <div className="flex justify-end gap-2">
                <Button onClick={onCancel} disabled={busy}>取消</Button>
                <Button type="submit" variant="primary" loading={busy}>保存</Button>
            </div>
        </form>
    );
}

export default LlmProviderForm;
