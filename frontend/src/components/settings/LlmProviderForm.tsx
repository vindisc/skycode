/**
 * 服务商的新增 / 编辑表单。只负责收集输入并在本地做一遍基础校验；
 * 保存结果、注册情况和被跳过的模型由父组件 LlmProvidersSettings 展示。
 * 密钥只写不读：编辑时输入框是空的，留空提交表示保持原值。
 */

import React, { useId, useMemo, useState } from 'react';
import { Button, Input, Textarea, Toggle, cn, inputVariants } from '@/components/ui';
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
}: LlmProviderFormProps) {
    const [form, setForm] = useState<ProviderFormState>(initial);
    const [localError, setLocalError] = useState<string | null>(null);
    const fieldId = useId();
    const models = useMemo(() => splitModelList(form.modelsText), [form.modelsText]);
    const update = (patch: Partial<ProviderFormState>) => setForm(previous => ({ ...previous, ...patch }));

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

    const id = (name: string) => `${fieldId}-${name}`;
    const error = localError ?? saveError;

    return (
        <form onSubmit={handleSubmit} noValidate className="rounded-[14px] border border-hairline bg-surfacev2 p-4 space-y-4" data-testid="llm-provider-form">
            <h3 className="text-base font-semibold text-t1">
                {existing ? `编辑「${existing.name}」` : '添加服务商'}
            </h3>

            <div className="grid gap-4 sm:grid-cols-2">
                <div>
                    <label htmlFor={id('name')} className={LABEL}>服务商名称</label>
                    <Input
                        id={id('name')}
                        value={form.name}
                        onChange={e => update({ name: e.target.value })}
                        placeholder="例如：智谱、本地 Ollama"
                        autoComplete="off"
                        autoFocus
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
                        : '当前运行环境没有稳定的加密密钥，暂时不能保存 API Key。请通过环境变量 ZHIKU_ENCRYPTION_KEY 提供密钥后重启服务。'}
                </p>
            </div>

            <div>
                <label htmlFor={id('models')} className={LABEL}>模型清单</label>
                <Textarea
                    id={id('models')}
                    rows={5}
                    value={form.modelsText}
                    onChange={e => update({ modelsText: e.target.value })}
                    placeholder={'每行一个，或用逗号分隔\n例如：glm-5.4'}
                    spellCheck={false}
                />
                <p className={HINT}>没有在能力表里登记过的模型不会被注册，保存后会在列表里标出原因。</p>
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

            <div className="flex justify-end gap-2">
                <Button onClick={onCancel} disabled={busy}>取消</Button>
                <Button type="submit" variant="primary" loading={busy}>保存</Button>
            </div>
        </form>
    );
}

export default LlmProviderForm;
