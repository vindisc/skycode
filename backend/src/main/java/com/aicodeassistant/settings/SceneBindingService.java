package com.aicodeassistant.settings;

import com.aicodeassistant.exception.RequestValidationException;
import com.aicodeassistant.llm.ModelCapabilities;
import com.aicodeassistant.llm.ModelRegistry;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * 场景分派：把"某个用途该用哪个模型"保存成一条引用（服务商 + 模型），由各消费方在运行时读取。
 * <p>
 * 清单里只列真正接了消费方的场景。界面上可选、但运行时没人读取的条目会让用户以为已经生效，
 * 所以接入新场景时必须同时补上消费方，不能只加界面。
 * <p>
 * 当前接线的场景：
 * <ul>
 *   <li>{@code prompt_optimize} — 输入框的「优化提示词」，由 ExternalLlmClient 读取</li>
 *   <li>{@code vision_fallback} — 当前模型不支持图片时的兜底，由 VisionModelRouter 读取</li>
 * </ul>
 */
@Service
public class SceneBindingService {

    private static final Logger log = LoggerFactory.getLogger(SceneBindingService.class);

    public static final String PROMPT_OPTIMIZE = "prompt_optimize";
    public static final String VISION_FALLBACK = "vision_fallback";

    private static final Map<String, Scene> SCENES = createScenes();

    private final SettingsRepository repository;
    private final LlmProviderSettingsService providers;
    private final ModelRegistry modelRegistry;
    private final ObjectMapper objectMapper;

    public SceneBindingService(SettingsRepository repository,
                              LlmProviderSettingsService providers,
                              ModelRegistry modelRegistry,
                              ObjectMapper objectMapper) {
        this.repository = repository;
        this.providers = providers;
        this.modelRegistry = modelRegistry;
        this.objectMapper = objectMapper;
    }

    public record Scene(String key, String label, String description) {}

    /**
     * 解析后的可用绑定：带上了服务商的真实连接信息，apiKey 为明文，仅供进程内部使用。
     */
    public record Resolved(
            String scene,
            String providerKey,
            String providerName,
            String baseUrl,
            String apiKey,
            String modelId) {}

    private static Map<String, Scene> createScenes() {
        Map<String, Scene> scenes = new LinkedHashMap<>();
        scenes.put(PROMPT_OPTIMIZE, new Scene(PROMPT_OPTIMIZE, "提示词优化",
                "输入框里「优化提示词」功能使用的模型。适合选响应快的小模型。"));
        scenes.put(VISION_FALLBACK, new Scene(VISION_FALLBACK, "图片理解兜底",
                "当前模型不支持图片时，自动改用这个模型来理解图片。必须选一个支持图片输入的模型。"));
        return Collections.unmodifiableMap(scenes);
    }

    /** 全部场景，顺序固定。 */
    public List<Scene> scenes() {
        return List.copyOf(SCENES.values());
    }

    public Optional<Scene> scene(String key) {
        return Optional.ofNullable(SCENES.get(key));
    }

    /** 已保存的绑定（未校验服务商是否还在）。 */
    public Optional<Setting.SceneBinding> find(String scene) {
        return repository.find(SettingsRepository.CATEGORY_SCENE_BINDING, scene)
                .map(stored -> deserialize(scene, stored.value()))
                .filter(binding -> binding != null);
    }

    /**
     * 读取某个场景当前真正可用的绑定；未配置、服务商已被删除、已停用，或绑定的模型已不在该服务商的
     * 模型清单里时返回空，由调用方回落默认配置。
     */
    public Optional<Resolved> resolve(String scene) {
        Optional<Setting.SceneBinding> binding = find(scene);
        if (binding.isEmpty()) return Optional.empty();
        String providerKey = binding.get().providerKey();
        var entry = providers.getAllProviderEntries().stream()
                .filter(e -> e.key().equals(providerKey))
                .findFirst().orElse(null);
        if (entry == null || !entry.config().enabled()) {
            log.debug("Scene binding '{}' points to a missing or disabled provider '{}'; falling back to defaults",
                    scene, providerKey);
            return Optional.empty();
        }
        var config = entry.config();
        // 模型清单是可编辑的：被删掉的模型不能再拿来调用，否则会拿着一个上游不认识的模型 ID 发请求
        if (!config.models().contains(binding.get().modelId())) {
            log.warn("Scene binding '{}' points to model '{}' which is no longer listed by provider '{}'; "
                    + "falling back to defaults", scene, binding.get().modelId(), providerKey);
            return Optional.empty();
        }
        return Optional.of(new Resolved(scene, entry.key(), config.name(), config.baseUrl(),
                config.apiKey(), binding.get().modelId()));
    }

    public Setting.SceneBinding save(String scene, String providerKey, String modelId) {
        if (!SCENES.containsKey(scene)) {
            throw new RequestValidationException("UNKNOWN_SCENE", "未知的场景：" + scene);
        }
        if (providerKey == null || providerKey.isBlank()) {
            throw new RequestValidationException("INVALID_SCENE_BINDING", "请选择一个服务商");
        }
        var entry = providers.getAllProviderEntries().stream()
                .filter(e -> e.key().equals(providerKey))
                .findFirst()
                .orElseThrow(() -> new RequestValidationException(
                        "PROVIDER_NOT_FOUND", "服务商不存在：" + providerKey));
        if (modelId == null || modelId.isBlank()) {
            throw new RequestValidationException("INVALID_SCENE_BINDING", "请选择一个模型");
        }
        String model = modelId.trim();
        // 模型 ID 大小写敏感：不做归一，直接校验是否在该服务商名下
        if (!entry.config().models().contains(model)) {
            throw new RequestValidationException("INVALID_SCENE_BINDING",
                    "模型 " + model + " 不属于服务商 " + entry.config().name());
        }
        if (VISION_FALLBACK.equals(scene)) {
            // 路由器运行时按能力表判断是否收图，这里提前用同一张表拦住，免得存一个永远不生效的绑定
            boolean acceptsImages = modelRegistry.findStaticCapabilities(model)
                    .map(ModelCapabilities::supportsImages)
                    .orElse(false);
            if (!acceptsImages) {
                throw new RequestValidationException("INVALID_SCENE_BINDING",
                        "模型 " + model + " 不支持图片输入，不能用作图片理解兜底");
            }
        }
        Setting.SceneBinding binding = new Setting.SceneBinding(entry.key(), model);
        repository.upsert(SettingsRepository.CATEGORY_SCENE_BINDING, scene, serialize(binding), null);
        log.info("Scene binding saved: scene={} provider={} model={}", scene, entry.key(), model);
        return binding;
    }

    public void clear(String scene) {
        repository.delete(SettingsRepository.CATEGORY_SCENE_BINDING, scene);
    }

    private String serialize(Setting.SceneBinding binding) {
        try {
            return objectMapper.writeValueAsString(binding);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Failed to serialize scene binding", e);
        }
    }

    private Setting.SceneBinding deserialize(String scene, String json) {
        try {
            return objectMapper.readValue(json, Setting.SceneBinding.class);
        } catch (JsonProcessingException e) {
            log.warn("Ignoring unreadable scene binding '{}': {}", scene, e.getMessage());
            return null;
        }
    }
}
