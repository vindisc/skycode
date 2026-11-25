/**
 * 设置页「场景分派」：给每个用途指定用哪个服务商的哪个模型。
 * 场景清单完全由接口下发，这里不维护副本。
 * 可选的服务商分两类，由接口标明：配置文件里预置的（键是注册名）和设置页里添加的（键是实际存储键）。
 */

import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Chip, EmptyState, Spinner, cn, inputVariants } from '@/components/ui';
import {
    settingsApi,
    type SceneBinding,
    type ScenesResponse,
    type SceneView,
} from '@/api/settingsApi';
import { useNotificationStore } from '@/store/notificationStore';
import { messageOf } from './providerForm';

type ProviderSource = NonNullable<SceneBinding['source']>;

/** 图片理解兜底场景只能选收图的模型 */
const VISION_SCENE = 'vision_fallback';

const LABEL = 'block text-sm font-medium text-t2 mb-1.5';

interface Choice {
    source: ProviderSource;
    providerKey: string;
    modelId: string;
}

interface SceneBindingsSettingsProps {
    /** 切到「模型服务商」页：没有可用服务商时给用户一条出路 */
    onGoToProviders?: () => void;
}

export function SceneBindingsSettings({ onGoToProviders }: SceneBindingsSettingsProps = {}) {
    const addNotification = useNotificationStore(s => s.addNotification);
    const [data, setData] = useState<ScenesResponse | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    /** 用户改过但还没保存的选择；没改过的场景直接沿用已保存的绑定 */
    const [drafts, setDrafts] = useState<Record<string, Choice>>({});
    const [savingScene, setSavingScene] = useState<string | null>(null);
    const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});

    const load = useCallback(async () => {
        setLoadError(null);
        try {
            setData(await settingsApi.listScenes());
        } catch (err) {
            setLoadError(messageOf(err, '场景列表加载失败'));
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    const providers = data?.providers ?? [];

    const handleSave = async (scene: SceneView, choice: Choice) => {
        setSavingScene(scene.key);
        try {
            await settingsApi.saveSceneBinding(scene.key, choice.source, choice.providerKey, choice.modelId);
            setDrafts(previous => without(previous, scene.key));
            setSaveErrors(previous => without(previous, scene.key));
            await load();
            addNotification({
                key: `scene-saved-${scene.key}-${Date.now()}`,
                level: 'success',
                message: `「${scene.label}」已改为 ${providerName(choice)} / ${choice.modelId}`,
            });
        } catch (err) {
            setSaveErrors(previous => ({ ...previous, [scene.key]: messageOf(err, '保存失败，请稍后重试') }));
        } finally {
            setSavingScene(null);
        }
    };

    const handleClear = async (scene: SceneView) => {
        setSavingScene(scene.key);
        try {
            await settingsApi.clearSceneBinding(scene.key);
            setDrafts(previous => without(previous, scene.key));
            setSaveErrors(previous => without(previous, scene.key));
            await load();
        } catch (err) {
            addNotification({ key: `scene-clear-failed-${Date.now()}`, level: 'error', message: messageOf(err, '清除失败，请稍后重试') });
        } finally {
            setSavingScene(null);
        }
    };

    const providerName = (choice: Choice) =>
        providers.find(p => p.source === choice.source && p.key === choice.providerKey)?.name ?? choice.providerKey;

    if (loadError) {
        return (
            <div role="alert" className="flex flex-wrap items-center gap-3 rounded-[10px] border border-err bg-errsoft px-3 py-2 text-[13px] text-errstrong">
                <span>{loadError}</span>
                <Button size="sm" onClick={() => { void load(); }}>重试</Button>
            </div>
        );
    }

    if (!data) {
        return <div className="flex justify-center py-8"><Spinner label="正在加载场景" /></div>;
    }

    if (data.scenes.length === 0) {
        return <EmptyState variant="compact" title="没有可分派的场景" description="这个版本还没有接入任何场景。" />;
    }

    return (
        <div className="space-y-4" data-testid="scene-bindings-settings">
            <div>
                <h3 className="text-base font-semibold text-t1">场景分派</h3>
                <p className="mt-1 text-[13px] leading-relaxed text-t3">
                    给每条管线指定用哪个服务商的哪个模型。没有分派、或分派失效时，使用配置文件里的默认值。
                </p>
            </div>

            {providers.length === 0 && (
                <div role="status" className="flex flex-wrap items-center gap-3 rounded-[10px] border border-warn bg-warnsoft px-3 py-2 text-[13px] text-warnstrong">
                    <span>还没有可用的服务商：到「模型服务商」里给配置里的服务商填个密钥，或者添加一个自定义服务商。</span>
                    {onGoToProviders && <Button size="sm" onClick={onGoToProviders}>去添加</Button>}
                </div>
            )}

            <ul className="space-y-3">
                {data.scenes.map(scene => {
                    const choice = choiceFor(scene, providers, drafts[scene.key]);
                    const dirty = choice != null && (scene.binding == null
                        || (scene.binding.source ?? 'pool') !== choice.source
                        || scene.binding.providerKey !== choice.providerKey
                        || scene.binding.modelId !== choice.modelId);
                    const saving = savingScene === scene.key;
                    return (
                        <li key={scene.key} data-testid={`scene-card-${scene.key}`}>
                            <Card className="p-4">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h4 className="text-sm font-semibold text-t1">{scene.label}</h4>
                                    <BindingStatus scene={scene} />
                                </div>
                                <p className="mt-1 text-[13px] leading-relaxed text-t3">{scene.description}</p>
                                {scene.binding && (
                                    <p className="mt-2 text-[13px] text-t2">
                                        当前：{scene.providerName ?? '（服务商已不存在）'} / {scene.binding.modelId}
                                    </p>
                                )}
                                {scene.binding && !scene.active && (
                                    <p role="status" className="mt-1 text-[13px] text-warnstrong">
                                        这条分派已失效：服务商被停用或删除，或者模型不在它的清单里。目前使用默认值。
                                    </p>
                                )}

                                {providers.length > 0 && choice && (
                                    <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                                        <div className="min-w-0">
                                            <label htmlFor={`${scene.key}-provider`} className={LABEL}>服务商</label>
                                            <select
                                                id={`${scene.key}-provider`}
                                                value={`${choice.source}\u0000${choice.providerKey}`}
                                                disabled={saving}
                                                onChange={e => {
                                                    const found = providers.find(p => `${p.source}\u0000${p.key}` === e.target.value);
                                                    setDrafts(previous => ({
                                                        ...previous,
                                                        [scene.key]: {
                                                            source: found?.source ?? 'pool',
                                                            providerKey: found?.key ?? '',
                                                            modelId: found ? (modelsFor(found, scene.key)[0]?.id ?? '') : '',
                                                        },
                                                    }));
                                                }}
                                                className={cn(inputVariants(), 'pr-8')}
                                            >
                                                {grouped(providers).map(group => (
                                                    <optgroup key={group.source} label={group.label}>
                                                        {group.providers.map(provider => (
                                                            <option key={provider.key} value={`${provider.source}\u0000${provider.key}`}>
                                                                {provider.name}
                                                            </option>
                                                        ))}
                                                    </optgroup>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="min-w-0">
                                            <label htmlFor={`${scene.key}-model`} className={LABEL}>模型</label>
                                            <ModelSelect
                                                id={`${scene.key}-model`}
                                                sceneKey={scene.key}
                                                provider={providers.find(p => p.source === choice.source && p.key === choice.providerKey)}
                                                value={choice.modelId}
                                                disabled={saving}
                                                onChange={modelId => setDrafts(previous => ({
                                                    ...previous,
                                                    [scene.key]: { source: choice.source, providerKey: choice.providerKey, modelId },
                                                }))}
                                            />
                                        </div>
                                        <div className="flex gap-2">
                                            <Button
                                                size="sm"
                                                variant="primary"
                                                loading={saving}
                                                disabled={!dirty || !choice.modelId}
                                                onClick={() => { void handleSave(scene, choice); }}
                                            >
                                                保存
                                            </Button>
                                            <Button
                                                size="sm"
                                                disabled={!scene.binding || saving}
                                                onClick={() => { void handleClear(scene); }}
                                            >
                                                清除
                                            </Button>
                                        </div>
                                    </div>
                                )}
                                {/* 没有可选服务商时上面的操作区不渲染，但失效的绑定仍要能清掉 */}
                                {providers.length === 0 && scene.binding && (
                                    <div className="mt-3">
                                        <Button size="sm" disabled={saving} onClick={() => { void handleClear(scene); }}>
                                            清除这条分派
                                        </Button>
                                    </div>
                                )}
                                {saveErrors[scene.key] && (
                                    <p role="alert" className="mt-3 rounded-[10px] border border-err bg-errsoft px-3 py-2 text-[13px] text-errstrong">
                                        {saveErrors[scene.key]}
                                    </p>
                                )}
                            </Card>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

function ModelSelect({ id, sceneKey, provider, value, disabled, onChange }: {
    id: string;
    sceneKey: string;
    provider?: ScenesResponse['providers'][number];
    value: string;
    disabled: boolean;
    onChange: (modelId: string) => void;
}) {
    const models = modelsFor(provider, sceneKey);
    // 绑定指向的模型已不在可选范围里（清单改过）时，下拉框回落到第一个可选模型
    const current = models.some(m => m.id === value) ? value : (models[0]?.id ?? '');
    return (
        <select
            id={id}
            value={current}
            disabled={disabled}
            onChange={e => onChange(e.target.value)}
            className={cn(inputVariants(), 'pr-8')}
        >
            {models.length === 0 && (
                <option value="">
                    {sceneKey === VISION_SCENE ? '该服务商没有支持图片的模型' : '该服务商没有模型'}
                </option>
            )}
            {models.map(model => (
                <option key={model.id} value={model.id}>{model.id}</option>
            ))}
        </select>
    );
}

/** 某个场景下，某个服务商可选的模型。 */
function modelsFor(provider: ScenesResponse['providers'][number] | undefined, sceneKey: string) {
    return (provider?.models ?? []).filter(m => sceneKey !== VISION_SCENE || m.supportsImages);
}

/** 下拉框里按来源分组：配置里的在前，设置页里添加的在后。 */
function grouped(providers: ScenesResponse['providers']) {
    const groups: { source: ProviderSource; label: string; providers: ScenesResponse['providers'] }[] = [
        { source: 'configured', label: '配置里的服务商', providers: [] },
        { source: 'pool', label: '设置页里添加的', providers: [] },
    ];
    for (const provider of providers) groups.find(group => group.source === provider.source)?.providers.push(provider);
    return groups.filter(group => group.providers.length > 0);
}

/** 场景当前应显示的选择：用户改过的草稿 > 已保存的绑定 > 第一个可选项。 */
function choiceFor(scene: SceneView, providers: ScenesResponse['providers'], draft?: Choice): Choice | null {
    if (draft) return draft;
    const binding = scene.binding;
    if (binding) {
        const source = binding.source ?? 'pool';
        const boundProvider = providers.find(p => p.source === source && p.key === binding.providerKey);
        if (boundProvider) {
            const options = modelsFor(boundProvider, scene.key);
            const modelId = options.some(m => m.id === binding.modelId) ? binding.modelId : (options[0]?.id ?? '');
            return { source, providerKey: boundProvider.key, modelId };
        }
    }
    const first = providers[0];
    return first ? { source: first.source, providerKey: first.key, modelId: modelsFor(first, scene.key)[0]?.id ?? '' } : null;
}

function BindingStatus({ scene }: { scene: SceneView }) {
    if (!scene.binding) return <Chip variant="neutral">使用默认配置</Chip>;
    return scene.active ? <Chip variant="ok">已生效</Chip> : <Chip variant="warn">已失效</Chip>;
}

function without<K extends string, V>(record: Record<K, V>, key: K): Record<K, V> {
    const next = { ...record };
    delete next[key];
    return next;
}

export default SceneBindingsSettings;
