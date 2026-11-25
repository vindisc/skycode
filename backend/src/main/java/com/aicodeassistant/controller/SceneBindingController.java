package com.aicodeassistant.controller;

import com.aicodeassistant.exception.RequestValidationException;
import com.aicodeassistant.llm.ModelCapabilities;
import com.aicodeassistant.llm.ModelRegistry;
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

import java.util.List;

/**
 * 设置页「场景分派」的接口：列出场景、保存或清除某个场景的绑定。
 * <p>
 * 场景清单完全由接口下发，前端不维护副本。可选服务商的键取的是池里的实际存储键——
 * 它在创建后不再变化，而显示名可以改，从显示名反推会对不上库里的键。
 */
@RestController
@RequestMapping("/api/settings/scenes")
public class SceneBindingController {

    /**
     * @param providerName 绑定指向的服务商当前的显示名；服务商已被删除时为 null
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

    public record ProviderOption(String key, String name, List<ModelOption> models) {}

    public record ScenesResponse(List<SceneView> scenes, List<ProviderOption> providers) {}

    public record BindingRequest(String providerKey, String modelId) {}

    public record BindingResponse(Setting.SceneBinding binding) {}

    private final SceneBindingService sceneBindings;
    private final LlmProviderSettingsService pool;
    private final ModelRegistry modelRegistry;

    public SceneBindingController(SceneBindingService sceneBindings,
                                  LlmProviderSettingsService pool,
                                  ModelRegistry modelRegistry) {
        this.sceneBindings = sceneBindings;
        this.pool = pool;
        this.modelRegistry = modelRegistry;
    }

    @GetMapping
    public ScenesResponse list() {
        var entries = pool.getAllProviderEntries();
        List<SceneView> scenes = sceneBindings.scenes().stream()
                .map(scene -> {
                    var binding = sceneBindings.find(scene.key()).orElse(null);
                    String providerName = binding == null ? null : entries.stream()
                            .filter(e -> e.key().equals(binding.providerKey()))
                            .map(e -> e.config().name())
                            .findFirst().orElse(null);
                    boolean active = sceneBindings.resolve(scene.key()).isPresent();
                    return new SceneView(scene.key(), scene.label(), scene.description(), binding,
                            providerName, active);
                })
                .toList();
        // 只列启用的服务商：停用的条目即使被绑定，运行时也会回落默认配置
        List<ProviderOption> providers = entries.stream()
                .filter(e -> e.config().enabled())
                .map(e -> new ProviderOption(e.key(), e.config().name(), modelOptions(e.config().models())))
                .toList();
        return new ScenesResponse(scenes, providers);
    }

    private List<ModelOption> modelOptions(List<String> models) {
        return models.stream()
                .map(model -> new ModelOption(model, modelRegistry.effectiveCapabilities(model).supportsImages()))
                .toList();
    }

    @PutMapping("/{scene}")
    public BindingResponse save(@PathVariable String scene, @RequestBody BindingRequest request) {
        if (request == null) {
            throw new RequestValidationException("INVALID_SCENE_BINDING", "请求体不能为空");
        }
        return new BindingResponse(sceneBindings.save(scene, request.providerKey(), request.modelId()));
    }

    @DeleteMapping("/{scene}")
    public ResponseEntity<Void> clear(@PathVariable String scene) {
        if (sceneBindings.scene(scene).isEmpty()) {
            throw new RequestValidationException("UNKNOWN_SCENE", "未知的场景：" + scene);
        }
        sceneBindings.clear(scene);
        return ResponseEntity.noContent().build();
    }
}
