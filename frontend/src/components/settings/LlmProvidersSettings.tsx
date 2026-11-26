/**
 * 设置页「模型服务商」：一张清单，列的就是当前可用的服务商，两类来源混在一起显示——
 * - .env 里配了密钥的（application.yml 预置的那批里真正在用的）：可以换密钥、改模型、启停，
 *   改动存库并立即生效，不用改 .env、不用重启；标着「来自 .env」，删不掉
 * - 设置页里自己添加的（服务商池）
 * 预置但没配密钥的那几个后端不下发——用户要的是"我加了什么，出现什么"。
 * 每次保存、删除后，后端都会把它们同步进运行时注册表并把结果带回来；这里同时刷新模型列表，
 * 让新模型不用刷新页面就出现在选择器里。密钥只写不读，界面上永远只有打码后的形式。
 */

import { useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCw, RotateCcw } from 'lucide-react';
import { Button, Card, Chip, EmptyState, Spinner, Toggle } from '@/components/ui';
import {
    configuredProvidersApi,
    settingsApi,
    type ConfiguredProviderView,
    type InferredModel,
    type LlmProviderInput,
    type LlmProviderListResponse,
    type LlmProviderTestResponse,
    type LlmProviderView,
    type ProviderRouting,
} from '@/api/settingsApi';
import { useModelStore } from '@/store/modelStore';
import { useNotificationStore } from '@/store/notificationStore';
import { LlmProviderForm } from './LlmProviderForm';
import { EMPTY_PROVIDER_FORM, formFromProvider, messageOf } from './providerForm';

type Operation = 'save' | 'delete' | 'reset' | 'test' | 'reload';
type Editor =
    | { mode: 'create' }
    | { mode: 'edit'; key: string }
    | { mode: 'configured'; name: string }
    | null;

interface LlmProvidersSettingsProps {
    /** 切到「场景分派」页：服务商池为空时给用户一条出路 */
    onGoToScenes?: () => void;
    /**
     * 表单里有没有还没保存的改动。填了好几项的表单（包括粘贴进来的密钥）被弹窗的「完成」、
     * Esc 或切换标签页顺手关掉就全没了，而且不会有任何提示——父组件据此先确认再关。
     */
    onUnsavedChange?: (unsaved: boolean) => void;
}

export function LlmProvidersSettings({ onGoToScenes, onUnsavedChange }: LlmProvidersSettingsProps = {}) {
    const addNotification = useNotificationStore(s => s.addNotification);
    const [data, setData] = useState<LlmProviderListResponse | null>(null);
    const [configured, setConfigured] = useState<ConfiguredProviderView[] | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    /** 正在进行的操作；key 是它作用的服务商，作用于全局操作时为 null */
    const [busy, setBusy] = useState<{ what: Operation; key: string | null } | null>(null);
    const [editor, setEditor] = useState<Editor>(null);
    const [saveError, setSaveError] = useState<string | null>(null);
    // undefined 表示这一次测试正在进行，先把上一次的结果清掉
    const [testResults, setTestResults] = useState<Record<string, LlmProviderTestResponse | undefined>>({});
    const [formDirty, setFormDirty] = useState(false);

    useEffect(() => {
        onUnsavedChange?.(editor !== null && formDirty);
    }, [editor, formDirty, onUnsavedChange]);

    const load = useCallback(async () => {
        setLoadError(null);
        try {
            const [poolData, configuredData] = await Promise.all([
                settingsApi.listProviders(),
                configuredProvidersApi.list(),
            ]);
            setData(poolData);
            setConfigured(configuredData);
        } catch (err) {
            setLoadError(messageOf(err, '服务商列表加载失败'));
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    /** 改动会影响可用模型：操作结束后重拉服务商列表和模型列表 */
    const run = useCallback(async (what: Operation, key: string | null, operation: () => Promise<unknown>) => {
        setBusy({ what, key });
        try {
            await operation();
            await load();
            void useModelStore.getState().fetchModels();
        } finally {
            setBusy(null);
        }
    }, [load]);

    const isBusy = (what: Operation, key: string | null = null) => busy?.what === what && busy.key === key;
    const anyBusy = busy !== null;

    const notifyRoutingProblem = (provider: LlmProviderView, routing: ProviderRouting[] | undefined) => {
        const mine = routing?.find(r => r.providerKey === provider.key);
        if (!mine?.needsAttention) return;
        addNotification({
            key: `provider-routing-${provider.key}-${Date.now()}`,
            level: 'warning',
            message: mine.registeredAs == null
                ? `「${provider.name}」没有注册进运行时：${mine.skipReason ?? '原因未知'}`
                : `「${provider.name}」已注册，但有模型没能注册，原因见列表`,
        });
    };

    /** 不在内置能力表里的模型是按推算的参数登记的，告诉用户一声，免得以为出了问题 */
    const notifyInferredModels = (provider: LlmProviderView, routing: ProviderRouting[] | undefined) => {
        const mine = routing?.find(r => r.providerKey === provider.key);
        const count = mine?.inferredModels?.length ?? 0;
        if (mine?.registeredAs == null || count === 0) return;
        addNotification({
            key: `provider-inferred-${provider.key}-${Date.now()}`,
            level: 'info',
            message: `「${provider.name}」已注册；其中 ${count} 个模型不在内置能力表里，按推算的参数登记，依据见列表`,
        });
    };

    const editingConfigured = editor?.mode === 'configured'
        ? configured?.find(view => view.name === editor.name) ?? null
        : null;

    const handleSave = async (input: LlmProviderInput) => {
        const editingKey = editor?.mode === 'edit' ? editor.key : null;
        setBusy({ what: 'save', key: editingKey ?? editingConfigured?.name ?? null });
        try {
            if (editor?.mode === 'configured' && editingConfigured) {
                const view = editingConfigured;
                const response = await configuredProvidersApi.save(view.name, {
                    apiKey: input.apiKey ?? null,
                    // 地址只有配置允许覆盖的才提交，免得把只读框里的值当成改动
                    baseUrl: view.baseUrlEditable ? input.baseUrl : null,
                    models: input.models,
                    defaultModel: input.defaultModel,
                    enabled: input.enabled,
                });
                setEditor(null);
                setSaveError(null);
                await load();
                void useModelStore.getState().fetchModels();
                const saved = response.provider;
                addNotification({
                    key: `configured-saved-${view.name}-${Date.now()}`,
                    level: saved.active ? 'success' : 'warning',
                    message: saved.active
                        ? `已保存「${saved.displayName}」`
                        : saved.enabled
                            ? `已保存「${saved.displayName}」；它还没有密钥，填上后才会启用`
                            : `已保存「${saved.displayName}」；它处于停用状态`,
                });
            } else {
                const response = editingKey
                    ? await settingsApi.updateProvider(editingKey, input)
                    : await settingsApi.createProvider(input);
                setEditor(null);
                setSaveError(null);
                await load();
                void useModelStore.getState().fetchModels();
                addNotification({
                    key: `provider-saved-${response.provider.key}-${Date.now()}`,
                    level: 'success',
                    message: editingKey ? `已保存「${response.provider.name}」` : `已添加「${response.provider.name}」`,
                });
                notifyRoutingProblem(response.provider, response.routing);
                notifyInferredModels(response.provider, response.routing);
            }
        } catch (err) {
            // 保存失败留在表单里，把后端给的原因显示在表单内部
            setSaveError(messageOf(err, '保存失败，请稍后重试'));
        } finally {
            setBusy(null);
        }
    };

    const handleDelete = async (provider: LlmProviderView) => {
        if (!window.confirm(`删除服务商「${provider.name}」？池里它提供的模型将不能再使用。`)) return;
        try {
            await run('delete', provider.key, () => settingsApi.deleteProvider(provider.key));
            addNotification({
                key: `provider-deleted-${provider.key}-${Date.now()}`,
                level: 'success',
                message: `已删除「${provider.name}」`,
            });
        } catch (err) {
            addNotification({ key: `provider-delete-failed-${Date.now()}`, level: 'error', message: messageOf(err, '删除失败，请稍后重试') });
        }
    };

    /** 配置里的服务商不能删，只能把页面上的修改撤掉，回到 .env 里的值 */
    const handleResetConfigured = async (view: ConfiguredProviderView) => {
        if (!window.confirm(`把「${view.displayName}」恢复成 .env 里的设置？在页面上填的密钥和改过的模型清单都会丢掉。`)) return;
        try {
            await run('reset', view.name, () => configuredProvidersApi.reset(view.name));
            addNotification({ key: `configured-reset-${view.name}-${Date.now()}`, level: 'success', message: `「${view.displayName}」已恢复为配置文件里的设置` });
        } catch (err) {
            addNotification({ key: `configured-reset-failed-${Date.now()}`, level: 'error', message: messageOf(err, '恢复失败，请稍后重试') });
        }
    };

    const handleToggleEnabled = async (provider: LlmProviderView, enabled: boolean) => {
        try {
            await run('save', provider.key, () => settingsApi.updateProvider(provider.key, {
                name: provider.name,
                baseUrl: provider.baseUrl,
                // 留空：只改启用状态，不碰已保存的密钥
                apiKey: null,
                models: provider.models,
                defaultModel: provider.defaultModel,
                enabled,
            }));
        } catch (err) {
            addNotification({ key: `provider-toggle-failed-${Date.now()}`, level: 'error', message: messageOf(err, '操作失败，请稍后重试') });
        }
    };

    /** 停用配置里的服务商：不用去 .env 里删密钥，在这里关掉就行；它的模型随之从选择器里消失。 */
    const handleToggleConfigured = async (view: ConfiguredProviderView, enabled: boolean) => {
        try {
            await run('save', view.name, () => configuredProvidersApi.save(view.name, { enabled }));
            addNotification({
                key: `configured-toggle-${view.name}-${Date.now()}`,
                level: 'success',
                message: enabled ? `已启用「${view.displayName}」` : `已停用「${view.displayName}」，它的模型不再出现在选择器里`,
            });
        } catch (err) {
            addNotification({ key: `configured-toggle-failed-${Date.now()}`, level: 'error', message: messageOf(err, '操作失败，请稍后重试') });
        }
    };

    const test = async (resultKey: string, operation: () => Promise<LlmProviderTestResponse>) => {
        setTestResults(previous => ({ ...previous, [resultKey]: undefined }));
        setBusy({ what: 'test', key: resultKey });
        try {
            const result = await operation();
            setTestResults(previous => ({ ...previous, [resultKey]: result }));
        } catch (err) {
            // 测试失败是一种结果，不是异常：留在这一行里给用户看
            setTestResults(previous => ({
                ...previous,
                [resultKey]: { ok: false, model: '', latencyMs: 0, error: messageOf(err, '测试失败，请稍后重试') },
            }));
        } finally {
            setBusy(null);
        }
    };

    const handleTest = (provider: LlmProviderView) =>
        test(provider.key, () => settingsApi.testProvider(provider.key));

    const handleTestConfigured = (view: ConfiguredProviderView) =>
        test(`configured:${view.name}`, () => configuredProvidersApi.test(view.name));

    const handleReload = async () => {
        try {
            await run('reload', null, async () => {
                setData(await settingsApi.reloadProviders());
            });
        } catch (err) {
            addNotification({ key: `provider-reload-failed-${Date.now()}`, level: 'error', message: messageOf(err, '重新加载失败') });
        }
    };

    const openEditor = (next: Editor) => {
        setSaveError(null);
        setEditor(next);
    };

    const editingProvider = editor?.mode === 'edit'
        ? data?.providers.find(p => p.key === editor.key) ?? null
        : null;

    // 配置里的服务商借用池表单的入参形状：只用到显示名、打码密钥、模型清单这几项
    const configuredAsExisting = editingConfigured
        ? ({
            key: editingConfigured.name,
            name: editingConfigured.displayName,
            baseUrl: editingConfigured.baseUrl,
            apiKeyMasked: editingConfigured.apiKeyMasked,
            hasApiKey: editingConfigured.hasApiKey,
            models: editingConfigured.models,
            defaultModel: editingConfigured.defaultModel,
            enabled: editingConfigured.enabled,
            updatedAt: '',
          } satisfies LlmProviderView)
        : null;

    return (
        <div className="space-y-5" data-testid="llm-providers-settings">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="text-base font-semibold text-t1">模型服务商</h3>
                    <p className="mt-1 text-[13px] leading-relaxed text-t3">
                        这里列出的就是当前可用的服务商。要加新的点「添加服务商」，保存后立即可用；
                        模型清单可以点「从接口获取」，不用手敲模型名。
                    </p>
                </div>
                <div className="flex shrink-0 gap-2">
                    <Button size="sm" loading={isBusy('reload')} onClick={() => { void handleReload(); }}>
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                        重新加载
                    </Button>
                    <Button size="sm" variant="primary" onClick={() => openEditor({ mode: 'create' })}>
                        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                        添加服务商
                    </Button>
                </div>
            </div>

            {data && !data.apiKeyStorageReady && (
                <p role="status" className="rounded-[10px] border border-warn bg-warnsoft px-3 py-2 text-[13px] text-warnstrong">
                    当前运行环境没有稳定的加密密钥，暂时不能保存 API Key。
                    请通过环境变量 ZHIKU_ENCRYPTION_KEY 提供密钥后重启服务；无密钥的服务商（例如本地模型）不受影响。
                </p>
            )}

            {loadError && (
                <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[10px] border border-err bg-errsoft px-3 py-2 text-[13px] text-errstrong">
                    <span>{loadError}</span>
                    <Button size="sm" onClick={() => { void load(); }}>重试</Button>
                </div>
            )}

            {(!data || !configured) && !loadError && (
                <div className="flex justify-center py-8"><Spinner label="正在加载服务商" /></div>
            )}

            {configured && (
                <section aria-label="服务商" data-testid="providers-list">
                    {configured.length === 0 && data && data.providers.length === 0
                        ? (!editor && (
                            <EmptyState
                                variant="compact"
                                title="还没有服务商"
                                description="添加一个之后，它的模型会出现在输入框下方的模型选择器里；也可以在「场景分派」里指派给某个场景。"
                                actions={onGoToScenes && <Button size="sm" onClick={onGoToScenes}>去场景分派</Button>}
                            />
                        ))
                        : (
                            /* 一张清单：.env 里配了密钥的在前，设置页里添加的在后 */
                            <ul className="space-y-3">
                                {configured.map(view => (
                                    <ConfiguredProviderRow
                                        key={view.name}
                                        view={view}
                                        operation={busy?.key === view.name || busy?.key === `configured:${view.name}` ? busy.what : null}
                                        anyBusy={anyBusy}
                                        testResult={testResults[`configured:${view.name}`]}
                                        onTest={() => { void handleTestConfigured(view); }}
                                        onToggle={enabled => { void handleToggleConfigured(view, enabled); }}
                                        onEdit={() => openEditor({ mode: 'configured', name: view.name })}
                                        onReset={() => { void handleResetConfigured(view); }}
                                    />
                                ))}
                                {data?.providers.map(provider => (
                                    <ProviderRow
                                        key={provider.key}
                                        provider={provider}
                                        routing={data.routing.find(r => r.providerKey === provider.key)}
                                        operation={busy?.key === provider.key ? busy.what : null}
                                        anyBusy={anyBusy}
                                        testResult={testResults[provider.key]}
                                        onToggle={enabled => { void handleToggleEnabled(provider, enabled); }}
                                        onTest={() => { void handleTest(provider); }}
                                        onEdit={() => openEditor({ mode: 'edit', key: provider.key })}
                                        onDelete={() => { void handleDelete(provider); }}
                                    />
                                ))}
                            </ul>
                        )}
                </section>
            )}

            {editor && (editingProvider || editingConfigured || editor.mode === 'create') && (
                <LlmProviderForm
                    key={editingConfigured?.name ?? editingProvider?.key ?? 'create'}
                    initial={configuredAsExisting
                        ? formFromProvider(configuredAsExisting)
                        : editingProvider ? formFromProvider(editingProvider) : EMPTY_PROVIDER_FORM}
                    existing={configuredAsExisting ?? editingProvider ?? undefined}
                    configured={editingConfigured ? {
                        name: editingConfigured.name,
                        displayName: editingConfigured.displayName,
                        baseUrlEditable: editingConfigured.baseUrlEditable,
                        keyFromConfig: editingConfigured.keyFromConfig,
                    } : undefined}
                    apiKeyStorageReady={data?.apiKeyStorageReady ?? false}
                    busy={isBusy('save', editingConfigured?.name ?? editingProvider?.key ?? null)}
                    saveError={saveError}
                    onSubmit={input => { void handleSave(input); }}
                    onCancel={() => { setEditor(null); setSaveError(null); setFormDirty(false); }}
                    onDiscover={async input => editor?.mode === 'configured'
                        // 配置里的服务商：用后端此刻生效的地址和密钥（密钥框留空就是配置文件里的那把）
                        ? configuredProvidersApi.discoverModels(editor.name)
                        : settingsApi.discoverModels({
                            baseUrl: input.baseUrl,
                            apiKey: input.apiKey,
                            providerKey: editor?.mode === 'edit' ? editor.key : null,
                        })}
                    onDirtyChange={setFormDirty}
                />
            )}
        </div>
    );
}

function TestOutcome({ testResult }: { testResult?: LlmProviderTestResponse }) {
    if (!testResult) return null;
    return (
        <p role="status" className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
            <Chip variant={testResult.ok ? 'ok' : 'err'}>{testResult.ok ? '连通' : '连接失败'}</Chip>
            <span className="text-t3">
                {testResult.model}{testResult.ok ? ` · ${testResult.latencyMs} ms` : ''}
            </span>
            {testResult.error && <span className="text-errstrong">{testResult.error}</span>}
        </p>
    );
}

interface ConfiguredProviderRowProps {
    view: ConfiguredProviderView;
    /** 正作用在这一行上的操作；没有时为 null */
    operation: Operation | null;
    anyBusy: boolean;
    testResult?: LlmProviderTestResponse;
    onTest: () => void;
    onToggle: (enabled: boolean) => void;
    onEdit: () => void;
    onReset: () => void;
}

function ConfiguredProviderRow({ view, operation, anyBusy, testResult, onTest, onToggle, onEdit, onReset }: ConfiguredProviderRowProps) {
    return (
        <li data-testid={`configured-provider-row-${view.name}`}>
            <Card className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 basis-64">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-t1">{view.displayName}</span>
                            {/* 这一条是 .env 里配的：能在这里换密钥、改模型、启停，但删不掉（删除要去 .env），所以标一下来源 */}
                            <span
                                className="text-[13px] text-t4"
                                title={`在 .env 里配置的服务商（${view.name}）。可以在这里换密钥、改模型清单；要彻底去掉得从 .env 里删`}
                            >
                                来自 .env
                            </span>
                            <ConfiguredStatus view={view} />
                        </div>
                        <div className="mt-1 truncate text-[13px] text-t3" title={view.baseUrl}>{view.baseUrl}</div>
                        <div className="mt-0.5 text-[13px] text-t3">
                            {view.hasApiKey ? <>密钥 {view.apiKeyMasked}</> : '还没有填写密钥'}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-1.5" aria-label={`${view.displayName} 的模型`}>
                            {view.models.map(model => (
                                <Chip key={model} variant={view.active ? 'accent' : 'neutral'}>{model}</Chip>
                            ))}
                        </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        {/* 没有密钥的条目谈不上启停，给了开关只会让人以为打开就能用 */}
                        {view.hasApiKey && (
                            <label className="flex items-center gap-2 text-[13px] text-t2">
                                <Toggle
                                    checked={view.enabled}
                                    onCheckedChange={onToggle}
                                    disabled={anyBusy}
                                    aria-label={`启用 ${view.displayName}`}
                                />
                                启用
                            </label>
                        )}
                        <Button size="sm" onClick={onTest} loading={operation === 'test'} disabled={anyBusy}>测试</Button>
                        <Button size="sm" variant="ghost" onClick={onEdit} disabled={anyBusy}>编辑</Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={onReset}
                            loading={operation === 'reset'}
                            disabled={anyBusy || !view.overridden}
                            title={view.overridden ? '撤掉设置页里的修改，回到 .env 里的值' : '没有在设置页里改过'}
                        >
                            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                            恢复默认
                        </Button>
                    </div>
                </div>
                <TestOutcome testResult={testResult} />
            </Card>
        </li>
    );
}

/** 已启用 / 已停用 / 未配置密钥 / 未注册，外加一个"页面修改过"的标记。 */
function ConfiguredStatus({ view }: { view: ConfiguredProviderView }) {
    return (
        <>
            {!view.enabled
                ? <Chip variant="neutral">已停用</Chip>
                : !view.hasApiKey
                    ? <Chip variant="neutral">未配置密钥</Chip>
                    : view.active
                        ? <Chip variant="ok">已启用</Chip>
                        : <Chip variant="warn">未注册</Chip>}
            {view.overridden && <Chip variant="accent">页面修改过</Chip>}
        </>
    );
}

interface ProviderRowProps {
    provider: LlmProviderView;
    routing?: ProviderRouting;
    /** 正作用在这一行上的操作；没有时为 null */
    operation: Operation | null;
    /** 任一操作进行中：这一行的所有控件都先禁用，避免并发改动 */
    anyBusy: boolean;
    testResult?: LlmProviderTestResponse;
    onToggle: (enabled: boolean) => void;
    onTest: () => void;
    onEdit: () => void;
    onDelete: () => void;
}

function ProviderRow({ provider, routing, operation, anyBusy, testResult, onToggle, onTest, onEdit, onDelete }: ProviderRowProps) {
    const registered = routing?.registeredAs != null;
    return (
        <li data-testid={`llm-provider-row-${provider.key}`}>
            <Card className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 basis-64">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-t1">{provider.name}</span>
                            <RoutingStatus routing={routing} enabled={provider.enabled} />
                        </div>
                        <div className="mt-1 truncate text-[13px] text-t3" title={provider.baseUrl}>{provider.baseUrl}</div>
                        <div className="mt-0.5 text-[13px] text-t3">
                            密钥 {provider.hasApiKey ? provider.apiKeyMasked : '未设置'}
                        </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        <label className="flex items-center gap-2 text-[13px] text-t2">
                            <Toggle
                                checked={provider.enabled}
                                onCheckedChange={onToggle}
                                disabled={anyBusy}
                                aria-label={`启用 ${provider.name}`}
                            />
                            启用
                        </label>
                        <Button size="sm" onClick={onTest} loading={operation === 'test'} disabled={anyBusy}>测试</Button>
                        <Button size="sm" variant="ghost" onClick={onEdit} disabled={anyBusy}>编辑</Button>
                        <Button size="sm" variant="ghost" onClick={onDelete} loading={operation === 'delete'} disabled={anyBusy}>
                            删除
                        </Button>
                    </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5" aria-label={`${provider.name} 的模型`}>
                    {provider.models.map(model => {
                        const skip = routing?.skippedModels.find(s => s.model === model);
                        const inferred = routing?.inferredModels?.find(item => item.model === model);
                        return (
                            <Chip
                                key={model}
                                variant={!provider.enabled || !registered ? 'neutral' : skip ? 'warn' : 'accent'}
                                title={!provider.enabled
                                    ? '服务商已停用'
                                    : skip?.reason ?? inferred?.basis}
                            >
                                {model}
                            </Chip>
                        );
                    })}
                </div>

                {registered && (
                    <p className="mt-3 text-[13px] text-t3">
                        已注册为 {routing?.registeredAs}，默认模型 {routing?.defaultModel}
                    </p>
                )}
                {registered && (routing?.inferredModels?.length ?? 0) > 0 && (
                    <div className="mt-2 text-[13px] text-t3" data-testid="inferred-models">
                        <p>以下模型不在内置能力表里，按推算的参数登记：</p>
                        <ul className="mt-1 space-y-1">
                            {routing?.inferredModels?.map((inferred: InferredModel) => (
                                <li key={inferred.model}>
                                    <span className="text-t2">{inferred.model}</span> — {inferred.basis}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
                {!registered && routing?.skipReason && (
                    <p role="status" className="mt-3 text-[13px] text-t3">未注册：{routing.skipReason}</p>
                )}
                {routing && routing.skippedModels.length > 0 && (
                    <ul className="mt-2 space-y-1" aria-label="未注册的模型">
                        {routing.skippedModels.map(skip => (
                            <li key={skip.model} className="text-[13px] text-t3">
                                <span className="text-t2">{skip.model}</span> — {skip.reason}
                            </li>
                        ))}
                    </ul>
                )}
                <TestOutcome testResult={testResult} />
            </Card>
        </li>
    );
}

function RoutingStatus({ routing, enabled }: { routing?: ProviderRouting; enabled: boolean }) {
    if (!enabled) return <Chip variant="neutral">已停用</Chip>;
    if (!routing) return null;
    // 后端省略值为 null 的字段：没注册时 registeredAs 是 undefined，不能拿它和 null 严格比较
    if (routing.registeredAs != null) return <Chip variant="ok">已注册</Chip>;
    // 没注册分两种：模型都由别处提供（无害），或有模型没注册成功（要处理）。轻重由后端判定
    return <Chip variant={routing.needsAttention ? 'warn' : 'neutral'}>未注册</Chip>;
}
