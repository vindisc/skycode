package com.aicodeassistant.controller;

import com.aicodeassistant.exception.RequestValidationException;
import com.aicodeassistant.llm.ModelCapabilities;
import com.aicodeassistant.llm.ModelRegistry;
import com.aicodeassistant.settings.ConfiguredProviderService;
import com.aicodeassistant.settings.LlmProviderSettingsService;
import com.aicodeassistant.settings.SceneBindingService;
import com.aicodeassistant.settings.Setting;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.List;

/**
 * 设置页「场景分派」的接口：列出场景、保存或清除某个场景的绑定。
 * <p>
 * 场景清单完全由接口下发，前端不维护副本。可选的服务商分两类：
 * {@value SceneBindingService#SOURCE_CONFIGURED} 是配置文件里定义的（键是注册名），
 * {@value SceneBindingService#SOURCE_POOL} 是设置页里加的（键是实际存储键——创建后不再变化，
 * 而显示名可以改，从显示名反推会对不上库里的键）。
 */
@RestController
@RequestMapping("/api/settings/scenes")
public class SceneBindingController {

    /**
     * @param providerName 绑定指向的服务商当前的显示名；没有绑定或服务商已被删除时字段缺失
     * @param active       绑定此刻是否真的生效（服务商存在且启用，并且绑定的模型还在它的模型清单里）
     */
    public record SceneView(
            String key,
            String label,
            String description,
            Setting.SceneBinding binding,
            String providerName,
            boolean active) {}

    public record ModelOption(String id, boolean supportsImages) {}

    /**
     * @param source {@value SceneBindingService#SOURCE_CONFIGURED} 或 {@value SceneBindingService#SOURCE_POOL}
     */
    public record ProviderOption(String source, String key, String name, List<ModelOption> models) {}

    public record ScenesResponse(List<SceneView> scenes, List<ProviderOption> providers) {}

    /** source 留空按设置页里加的服务商处理（早期只有这一类）。 */
    public record BindingRequest(String source, String providerKey, String modelId) {}

    public record BindingResponse(Setting.SceneBinding binding) {}

    private final SceneBindingService sceneBindings;
    private final LlmProviderSettingsService pool;
    private final ConfiguredProviderService configured;
    private final ModelRegistry modelRegistry;

    public SceneBindingController(SceneBindingService sceneBindings,
                                  LlmProviderSettingsService pool,
                                  ConfiguredProviderService configured,
                                  ModelRegistry modelRegistry) {
        this.sceneBindings = sceneBindings;
        this.pool = pool;
        this.configured = configured;
        this.modelRegistry = modelRegistry;
    }

    @GetMapping
    public ScenesResponse list() {
        List<SceneView> scenes = new ArrayList<>();
        for (SceneBindingService.Scene scene : sceneBindings.scenes()) {
            // 解析一次拿到服务商名和"此刻是否生效"；find 只给原始绑定
            SceneBindingService.Resolved resolved = sceneBindings.resolve(scene.key()).orElse(null);
            Setting.SceneBinding binding = sceneBindings.find(scene.key()).orElse(null);
            String providerName = resolved != null ? resolved.providerName()
                    : binding != null ? providerNameOf(binding) : null;
            scenes.add(new SceneView(scene.key(), scene.label(), scene.description(), binding,
                    providerName, resolved != null));
        }

        // 只列此刻能用的服务商：停用的、还没填密钥的条目即使被绑定，运行时也会回落默认配置
        List<ProviderOption> providers = new ArrayList<>();
        for (ConfiguredProviderService.Effective effective : configured.effectiveProviders()) {
            if (effective.usable()) {
                providers.add(new ProviderOption(SceneBindingService.SOURCE_CONFIGURED, effective.name(),
                        effective.displayName(), modelOptions(effective.models())));
            }
        }
        for (var entry : pool.getAllProviderEntries()) {
            if (entry.config().enabled()) {
                providers.add(new ProviderOption(SceneBindingService.SOURCE_POOL, entry.key(),
                        entry.config().name(), modelOptions(entry.config().models())));
            }
        }
        return new ScenesResponse(List.copyOf(scenes), List.copyOf(providers));
    }

    @PutMapping("/{scene}")
    public BindingResponse save(@PathVariable String scene, @RequestBody BindingRequest request) {
        if (request == null) {
            throw new RequestValidationException("INVALID_SCENE_BINDING", "请求体不能为空");
        }
        String source = request.source() == null || request.source().isBlank()
                ? SceneBindingService.SOURCE_POOL : request.source();
        return new BindingResponse(sceneBindings.save(scene, source, request.providerKey(), request.modelId()));
    }

    @DeleteMapping("/{scene}")
    public ResponseEntity<Void> clear(@PathVariable String scene) {
        if (sceneBindings.scene(scene).isEmpty()) {
            throw new RequestValidationException("UNKNOWN_SCENE", "未知的场景：" + scene);
        }
        sceneBindings.clear(scene);
        return ResponseEntity.noContent().build();
    }

    private List<ModelOption> modelOptions(List<String> models) {
        return models.stream()
                .map(model -> new ModelOption(model, modelRegistry.effectiveCapabilities(model).supportsImages()))
                .toList();
    }

    /** 绑定已失效（resolve 为空）时仍尽量给出服务商名，免得界面上只剩一个看不出是谁的键。 */
    private String providerNameOf(Setting.SceneBinding binding) {
        if (binding.isConfigured()) {
            return ConfiguredProviderService.displayName(binding.providerKey());
        }
        return pool.getAllProviderEntries().stream()
                .filter(e -> e.key().equals(binding.providerKey()))
                .map(e -> e.config().name())
                .findFirst().orElse(null);
    }
}
