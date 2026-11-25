package com.aicodeassistant.settings;

import com.aicodeassistant.exception.RequestValidationException;
import com.aicodeassistant.llm.LlmProviderRegistry;
import com.aicodeassistant.llm.ModelRegistry;
import com.aicodeassistant.llm.ModelScenes;
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
 * 所以接入新场景时必须同时补上消费方，不能只加界面。场景键和各自的消费方见 {@link ModelScenes}。
 * <p>
 * 绑定可以指向两类服务商：设置页里加的（{@link #SOURCE_POOL}）和配置文件里定义的
 * （{@link #SOURCE_CONFIGURED}）。没绑定、或绑定的服务商此刻用不了（被停用、删除、模型不在清单里、
 * 没注册进运行时）时，{@link #resolve} 返回空，由调用方回落到配置文件里的默认值。
 */
@Service
public class SceneBindingService {

    private static final Logger log = LoggerFactory.getLogger(SceneBindingService.class);

    public static final String PROMPT_OPTIMIZE = ModelScenes.PROMPT_OPTIMIZE;
    public static final String VISION_FALLBACK = ModelScenes.VISION_FALLBACK;

    public static final String SOURCE_POOL = "pool";
    public static final String SOURCE_CONFIGURED = "configured";

    private static final Map<String, Scene> SCENES = createScenes();

    private final SettingsRepository repository;
    private final LlmProviderSettingsService pool;
    private final ConfiguredProviderService configured;
    private final ModelRegistry modelRegistry;
    private final LlmProviderRegistry providerRegistry;
    private final ObjectMapper objectMapper;
    /** 保护缓存与库的一致性；缓存为 null 表示尚未从库加载。 */
    private final Object lock = new Object();
    private volatile Map<String, Setting.SceneBinding> cache;

    public SceneBindingService(SettingsRepository repository,
                              LlmProviderSettingsService pool,
                              ConfiguredProviderService configured,
                              ModelRegistry modelRegistry,
                              LlmProviderRegistry providerRegistry,
                              ObjectMapper objectMapper) {
        this.repository = repository;
        this.pool = pool;
        this.configured = configured;
        this.modelRegistry = modelRegistry;
        this.providerRegistry = providerRegistry;
        this.objectMapper = objectMapper;
    }

    public record Scene(String key, String label, String description) {}

    /**
     * 解析后的可用绑定：带上了服务商的真实连接信息，apiKey 为明文，仅供进程内部使用。
     *
     * @param registryName 这个服务商在 {@link LlmProviderRegistry} 里注册的名字
     */
    public record Resolved(
            String scene,
            String source,
            String providerKey,
            String providerName,
            String registryName,
            String baseUrl,
            String apiKey,
            String modelId) {}

    private static Map<String, Scene> createScenes() {
        Map<String, Scene> scenes = new LinkedHashMap<>();
        scenes.put(ModelScenes.MAIN_DEFAULT, new Scene(ModelScenes.MAIN_DEFAULT, "主对话默认模型",
                "新会话默认使用的模型。已经打开的会话保持各自选的模型，不受这里影响。"));
        scenes.put(ModelScenes.COMPACT_SUMMARY, new Scene(ModelScenes.COMPACT_SUMMARY, "压缩摘要",
                "上下文太长时，用来把较早的记录压成摘要的模型。不选则使用配置文件里的设置。"));
        scenes.put(ModelScenes.FAST, new Scene(ModelScenes.FAST, "后台小任务",
                "可视化意图识别、记忆重排这类后台小任务使用的模型。适合选响应快、便宜的。"));
        scenes.put(ModelScenes.SUB_AGENT, new Scene(ModelScenes.SUB_AGENT, "子 Agent",
                "子 Agent 默认使用的模型。不选则跟随主对话的模型；调用时显式指定了模型的仍然以指定的为准。"));
        scenes.put(VISION_FALLBACK, new Scene(VISION_FALLBACK, "图片理解兜底",
                "当前模型不支持图片时，自动改用这个模型来理解图片。必须选一个支持图片输入的模型。"));
        scenes.put(PROMPT_OPTIMIZE, new Scene(PROMPT_OPTIMIZE, "提示词优化",
                "输入框里「优化提示词」功能使用的模型。适合选响应快的小模型。"));
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
        Setting.SceneBinding binding = bindings().get(scene);
        return Optional.ofNullable(binding);
    }

    /**
     * 读取某个场景当前真正可用的绑定；未配置、服务商已被删除、已停用，或绑定的模型已不在该服务商的
     * 模型清单里时返回空，由调用方回落默认配置。
     */
    public Optional<Resolved> resolve(String scene) {
        Setting.SceneBinding binding = bindings().get(scene);
        if (binding == null) return Optional.empty();
        String providerKey = binding.providerKey();
        String model = binding.modelId();
        if (binding.isConfigured()) {
            Optional<ConfiguredProviderService.Effective> entry = configured.effective(providerKey)
                    .filter(ConfiguredProviderService.Effective::usable);
            if (entry.isEmpty()) return inactive(scene, providerKey, "missing, disabled or has no key");
            var config = entry.get();
            if (!config.models().contains(model)) return inactive(scene, providerKey, "model no longer listed");
            return Optional.of(new Resolved(scene, SOURCE_CONFIGURED, providerKey, config.displayName(), providerKey,
                    config.baseUrl(), config.apiKey(), model));
        }
        var entry = pool.getAllProviderEntries().stream()
                .filter(e -> e.key().equals(providerKey) && e.config().enabled())
                .findFirst().orElse(null);
        if (entry == null) return inactive(scene, providerKey, "missing or disabled");
        var config = entry.config();
        // 模型清单是可编辑的：被删掉的模型不能再拿来调用，否则会拿着一个上游不认识的模型 ID 发请求
        if (!config.models().contains(model)) return inactive(scene, providerKey, "model no longer listed");
        return Optional.of(new Resolved(scene, SOURCE_POOL, providerKey, config.name(),
                LlmProviderRegistry.POOL_PROVIDER_PREFIX + providerKey, config.baseUrl(), config.apiKey(), model));
    }

    /**
     * 场景绑定的模型此刻能不能真的调用（有已注册的 Provider 提供它）。给只需要模型 ID 的消费方用，
     * 例如主对话默认模型、快速模型、子 Agent。
     */
    public Optional<String> supportedBoundModel(String scene) {
        Optional<Resolved> resolved = resolve(scene);
        if (resolved.isEmpty()) return Optional.empty();
        String model = resolved.get().modelId();
        if (!providerRegistry.supportsModel(model)) {
            log.warn("Scene binding '{}' points to model '{}' which no provider is serving right now; using defaults",
                    scene, model);
            return Optional.empty();
        }
        return Optional.of(model);
    }

    private Optional<Resolved> inactive(String scene, String providerKey, String why) {
        log.debug("Scene binding '{}' points to provider '{}' which is {}; falling back to defaults",
                scene, providerKey, why);
        return Optional.empty();
    }

    public Setting.SceneBinding save(String scene, String source, String providerKey, String modelId) {
        if (!SCENES.containsKey(scene)) {
            throw new RequestValidationException("UNKNOWN_SCENE", "未知的场景：" + scene);
        }
        boolean fromConfigured = SOURCE_CONFIGURED.equals(source);
        if (!fromConfigured && !SOURCE_POOL.equals(source)) {
            throw new RequestValidationException("INVALID_SCENE_BINDING", "未知的服务商来源：" + source);
        }
        if (providerKey == null || providerKey.isBlank()) {
            throw new RequestValidationException("INVALID_SCENE_BINDING", "请选择一个服务商");
        }
        if (modelId == null || modelId.isBlank()) {
            throw new RequestValidationException("INVALID_SCENE_BINDING", "请选择一个模型");
        }
        String model = modelId.trim();
        String providerName;
        List<String> listedModels;
        if (fromConfigured) {
            var entry = configured.effective(providerKey)
                    .orElseThrow(() -> new RequestValidationException(
                            "PROVIDER_NOT_FOUND", "配置里没有这个服务商：" + providerKey));
            providerName = entry.displayName();
            listedModels = entry.models();
        } else {
            var entry = pool.getAllProviderEntries().stream()
                    .filter(e -> e.key().equals(providerKey))
                    .findFirst()
                    .orElseThrow(() -> new RequestValidationException(
                            "PROVIDER_NOT_FOUND", "服务商不存在：" + providerKey));
            providerName = entry.config().name();
            listedModels = entry.config().models();
        }
        // 模型 ID 大小写敏感：不做归一，直接校验是否在该服务商名下
        if (!listedModels.contains(model)) {
            throw new RequestValidationException("INVALID_SCENE_BINDING",
                    "模型 " + model + " 不属于服务商 " + providerName);
        }
        if (VISION_FALLBACK.equals(scene)) {
            // 路由器运行时按注册表里的能力判断是否收图，这里提前用同一份能力拦住，免得存一个永远不生效的绑定。
            // 池里登记的模型能力是推算出来的，也算在内；还没同步过的按注册后会得到的能力算
            if (!modelRegistry.effectiveCapabilities(model).supportsImages()) {
                throw new RequestValidationException("INVALID_SCENE_BINDING",
                        "模型 " + model + " 不支持图片输入，不能用作图片理解兜底");
            }
        }
        Setting.SceneBinding binding = new Setting.SceneBinding(source, providerKey, model);
        synchronized (lock) {
            repository.upsert(SettingsRepository.CATEGORY_SCENE_BINDING, scene, serialize(binding), null);
            Map<String, Setting.SceneBinding> current = new LinkedHashMap<>(bindings());
            current.put(scene, binding);
            cache = Collections.unmodifiableMap(current);
        }
        log.info("Scene binding saved: scene={} source={} provider={} model={}", scene, source, providerKey, model);
        return binding;
    }

    public void clear(String scene) {
        synchronized (lock) {
            repository.delete(SettingsRepository.CATEGORY_SCENE_BINDING, scene);
            Map<String, Setting.SceneBinding> current = new LinkedHashMap<>(bindings());
            current.remove(scene);
            cache = Collections.unmodifiableMap(current);
        }
    }

    /** 丢弃缓存并从库重新加载。 */
    public void reload() {
        synchronized (lock) {
            cache = null;
            bindings();
        }
    }

    // ───── 内部 ─────

    private Map<String, Setting.SceneBinding> bindings() {
        Map<String, Setting.SceneBinding> snapshot = cache;
        if (snapshot != null) return snapshot;
        synchronized (lock) {
            if (cache != null) return cache;
            Map<String, Setting.SceneBinding> loaded = new LinkedHashMap<>();
            for (var stored : repository.list(SettingsRepository.CATEGORY_SCENE_BINDING)) {
                Setting.SceneBinding binding = deserialize(stored.value());
                if (binding != null) loaded.put(stored.key(), binding);
            }
            cache = Collections.unmodifiableMap(loaded);
            return cache;
        }
    }

    private String serialize(Setting.SceneBinding binding) {
        try {
            return objectMapper.writeValueAsString(binding);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Failed to serialize scene binding", e);
        }
    }

    private Setting.SceneBinding deserialize(String json) {
        try {
            Setting.SceneBinding binding = objectMapper.readValue(json, Setting.SceneBinding.class);
            if (binding == null || binding.providerKey() == null || binding.modelId() == null) return null;
            // 早期存的绑定没有 source 字段，那时只有池里的服务商可选
            return binding.source() == null
                    ? new Setting.SceneBinding(SOURCE_POOL, binding.providerKey(), binding.modelId())
                    : binding;
        } catch (JsonProcessingException e) {
            log.warn("Ignoring unreadable scene binding value: {}", e.getMessage());
            return null;
        }
    }
}
