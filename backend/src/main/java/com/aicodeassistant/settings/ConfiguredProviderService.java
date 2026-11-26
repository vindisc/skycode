package com.aicodeassistant.settings;

import com.aicodeassistant.exception.RequestValidationException;
import com.aicodeassistant.llm.ApiKeyRotationManager;
import com.aicodeassistant.llm.LlmProvidersProperties;
import com.aicodeassistant.mcp.TokenEncryptionService;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.function.Predicate;

/**
 * 设置页「模型服务商」里带注册名的那一类服务商（deepseek、zhipu、huoshenai……）。
 * <p>
 * 定义存在全局库里，页面是唯一来源：改密钥、改模型清单、停用、删除都只动库里的这份。
 * 历史上这类服务商是"application.yml + .env 的定义，页面存覆盖"，.env 一直参与；
 * 2026-11-26 起改为<b>一次性导入</b>：第一次启动把 .env 里配了密钥、能用的服务商复制进库
 * （{@link #SEED_MARKER} 记录做过这件事），之后 .env 里那几行 {@code LLM_PROVIDER_*} 不再生效——
 * 改了不生效，删了服务商也不会回来。
 * <p>
 * 它们保留注册名注册（不带 {@code db:} 前缀），所以按名字找服务商的链路不受影响：
 * 压缩摘要的 {@code LLM_COMPACT_PROVIDER} 兜底、TTS/ASR 的 dashscope。
 * 页面上"添加服务商"新建的走 {@link LlmProviderSettingsService} 那个池。
 */
@Service
public class ConfiguredProviderService {

    private static final Logger log = LoggerFactory.getLogger(ConfiguredProviderService.class);

    public static final String CATEGORY = "configured_provider";

    /** 一次性导入标记（存在即不再导入）。值是导入时间，仅供排查。 */
    static final String SEED_MARKER = "__seeded__";

    /** 导入时给知名服务商用的显示名；不认识的原样用注册名。 */
    private static final Map<String, String> DISPLAY_NAMES = Map.ofEntries(
            Map.entry("openai", "OpenAI"),
            Map.entry("dashscope", "阿里云百炼"),
            Map.entry("dashscope-token-plan", "百炼 Token Plan"),
            Map.entry("deepseek", "DeepSeek"),
            Map.entry("moonshot", "Moonshot（Kimi）"),
            Map.entry("kimi-code", "Kimi Code 订阅"),
            Map.entry("zhipu", "智谱"),
            Map.entry("minimax", "MiniMax"),
            Map.entry("huoshenai", "HuoshenAI 中转站"),
            Map.entry("openrouter", "OpenRouter"),
            Map.entry("zenmux", "ZenMux"));

    /**
     * 库里存的服务商定义。
     *
     * @param apiKey             明文密钥，仅进程内部使用；落库时加密。null 表示没有密钥
     * @param keySelectionStrategy 多密钥时的选 key 策略（导入时从配置带过来），见 {@link ApiKeyRotationManager}
     */
    public record Effective(
            String name,
            String displayName,
            String baseUrl,
            String apiKey,
            List<String> models,
            String defaultModel,
            boolean enabled,
            ApiKeyRotationManager.KeySelectionStrategy keySelectionStrategy) {

        /** 已启用，且密钥、地址、模型都齐，可以注册进运行时。 */
        public boolean usable() {
            return enabled
                    && apiKey != null && !apiKey.isBlank()
                    && baseUrl != null && !baseUrl.isBlank()
                    && models != null && !models.isEmpty();
        }
    }

    /** 下发给界面的视图；密钥只有打码后的形式。active 表示已经注册进运行时。 */
    public record ConfiguredProviderView(
            String name,
            String displayName,
            String baseUrl,
            String apiKeyMasked,
            boolean hasApiKey,
            List<String> models,
            String defaultModel,
            boolean enabled,
            boolean active) {}

    /** 在设置页里保存时的入参。apiKey 为 null 或空白表示不改密钥；baseUrl、models、defaultModel 为 null 表示不改；
     * enabled 为 null 表示启用。 */
    public record ConfiguredProviderInput(
            String apiKey, String baseUrl, List<String> models, String defaultModel, Boolean enabled) {}

    record Stored(String apiKey, String baseUrl, List<String> models, String defaultModel,
                  boolean enabled, String keySelectionStrategy) {}

    private final LlmProvidersProperties properties;
    private final SettingsRepository repository;
    private final TokenEncryptionService encryption;
    private final ObjectMapper objectMapper;
    /** 保护缓存与库的一致性；缓存为 null 表示尚未从库加载。 */
    private final Object lock = new Object();
    private volatile Map<String, Stored> cache;

    public ConfiguredProviderService(LlmProvidersProperties properties,
                                     SettingsRepository repository,
                                     TokenEncryptionService encryption,
                                     ObjectMapper objectMapper) {
        this.properties = properties;
        this.repository = repository;
        this.encryption = encryption;
        this.objectMapper = objectMapper;
    }

    /**
     * 第一次启动时把 .env 里能用的服务商导入库，然后记下标记。之后调用只是查一下标记，
     * 不会重复导入——用户在页面上删掉的服务商不会因为重启又回来。
     */
    public void seedIfNeeded() {
        synchronized (lock) {
            if (repository.find(CATEGORY, SEED_MARKER).isPresent()) return;
            Map<String, LlmProvidersProperties.ProviderConfig> templates = properties.providers();
            if (templates == null || templates.isEmpty()) {
                repository.upsert(CATEGORY, SEED_MARKER, String.valueOf(System.currentTimeMillis()), null);
                return;
            }
            Map<String, Stored> current = new LinkedHashMap<>(rows());
            List<String> seeded = new ArrayList<>();
            for (var entry : templates.entrySet()) {
                if (current.containsKey(entry.getKey())) continue;
                LlmProvidersProperties.ProviderConfig template = entry.getValue();
                if (!template.isValid()) continue;
                // 加密密钥不可用就先不带密钥导入（页面会显示"还没有填写密钥"，填上即可）
                String key = encryption.keyIsPersistent() && template.apiKey() != null ? template.apiKey() : null;
                Stored stored = new Stored(key,
                        Objects.requireNonNullElse(template.baseUrl(), ""),
                        template.models(), template.defaultModel(), true,
                        strategyName(template.keySelectionStrategy()));
                repository.upsert(CATEGORY, entry.getKey(), serialize(stored), null);
                current.put(entry.getKey(), stored);
                seeded.add(entry.getKey());
            }
            repository.upsert(CATEGORY, SEED_MARKER, String.valueOf(System.currentTimeMillis()), null);
            cache = Collections.unmodifiableMap(current);
            log.info("Imported providers from .env into the settings store (one-time): {} — LLM_PROVIDER_* no longer applies to them",
                    seeded);
        }
    }

    /** 全部服务商的生效定义，按库里的顺序（导入顺序）。 */
    public List<Effective> effectiveProviders() {
        List<Effective> result = new ArrayList<>();
        for (var row : rows().entrySet()) {
            result.add(new Effective(row.getKey(), displayName(row.getKey()), row.getValue().baseUrl(),
                    row.getValue().apiKey(), row.getValue().models(), row.getValue().defaultModel(),
                    row.getValue().enabled(), strategy(row.getValue().keySelectionStrategy())));
        }
        return List.copyOf(result);
    }

    public Optional<Effective> effective(String name) {
        Stored stored = rows().get(name);
        if (stored == null) return Optional.empty();
        return Optional.of(new Effective(name, displayName(name), stored.baseUrl(), stored.apiKey(),
                stored.models(), stored.defaultModel(), stored.enabled(), strategy(stored.keySelectionStrategy())));
    }

    public static String displayName(String name) {
        return DISPLAY_NAMES.getOrDefault(name, name);
    }

    /**
     * @param isActive 按服务商名判断它此刻是否已注册进运行时
     */
    public List<ConfiguredProviderView> views(Predicate<String> isActive) {
        List<ConfiguredProviderView> views = new ArrayList<>();
        for (Effective effective : effectiveProviders()) {
            views.add(new ConfiguredProviderView(effective.name(), effective.displayName(), effective.baseUrl(),
                    LlmProviderSettingsService.mask(effective.apiKey()),
                    effective.apiKey() != null && !effective.apiKey().isBlank(),
                    effective.models(), effective.defaultModel(), effective.enabled(), isActive.test(effective.name())));
        }
        return views;
    }

    /** 保存对某个服务商的修改。留空的密钥表示不改密钥；不传的项保持原值。 */
    public void save(String name, ConfiguredProviderInput input) {
        if (input == null) {
            throw new RequestValidationException("INVALID_PROVIDER", "请求体不能为空");
        }
        synchronized (lock) {
            Stored previous = rows().get(name);
            if (previous == null) {
                throw new RequestValidationException("PROVIDER_NOT_FOUND", "没有这个服务商：" + name);
            }
            String submitted = input.apiKey() == null ? "" : input.apiKey().trim();
            String storedKey = previous.apiKey();
            if (!submitted.isEmpty()) {
                if (!encryption.keyIsPersistent()) {
                    throw new RequestValidationException("ENCRYPTION_KEY_REQUIRED",
                            "当前运行环境没有稳定的加密密钥，不能保存 API Key。请通过环境变量 SKYCODE_ENCRYPTION_KEY "
                                    + "（Base64 编码的 32 字节随机值）提供密钥后重启服务；密钥丢失会导致已保存的 Key 无法解密。");
                }
                storedKey = submitted;
            }
            // 模型清单不传表示不改（比如只想停用）；传了就整体替换
            List<String> models = input.models() == null ? null : normalizeModels(input.models());
            if (models == null) models = previous.models();
            if (models.isEmpty()) {
                throw new RequestValidationException("INVALID_PROVIDER", "至少要填写一个模型");
            }
            // 默认模型不传表示不改；它不在清单里时退到第一个
            String defaultModel = input.defaultModel() == null ? null : input.defaultModel().trim();
            if (defaultModel == null || defaultModel.isEmpty()) defaultModel = previous.defaultModel();
            if (!models.contains(defaultModel)) defaultModel = models.getFirst();
            // 同一个模型出现在两个服务商名下，运行时按模型找服务商会直接报"路由有歧义"
            for (Effective other : effectiveProviders()) {
                if (other.name().equals(name) || !other.usable()) continue;
                String clash = other.models() == null ? null
                        : other.models().stream().filter(models::contains).findFirst().orElse(null);
                if (clash != null) {
                    throw new RequestValidationException("INVALID_PROVIDER",
                            "模型 " + clash + " 已经由 " + other.displayName() + " 提供，同一个模型只能放在一个服务商下");
                }
            }
            String baseUrl = previous.baseUrl();
            if (input.baseUrl() != null && !input.baseUrl().isBlank()) {
                baseUrl = input.baseUrl().trim().replaceAll("/+$", "");
                if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
                    throw new RequestValidationException("INVALID_PROVIDER", "接口地址必须以 http:// 或 https:// 开头");
                }
                if (okhttp3.HttpUrl.parse(baseUrl) == null) {
                    throw new RequestValidationException("INVALID_PROVIDER",
                            "接口地址不是一个完整的网址，形如 https://api.example.com/v1");
                }
            }
            Stored stored = new Stored(storedKey, baseUrl, models, defaultModel,
                    input.enabled() == null || input.enabled(), previous.keySelectionStrategy());
            repository.upsert(CATEGORY, name, serialize(stored), null);
            Map<String, Stored> current = new LinkedHashMap<>(rows());
            current.put(name, stored);
            cache = Collections.unmodifiableMap(current);
            log.info("Configured provider '{}' saved from settings: models={}, enabled={}, keyChanged={}",
                    name, models, stored.enabled(), !submitted.isEmpty());
        }
    }

    /** 删掉一个服务商。删了就是删了：模型从选择器消失，指向它的场景分派会失效。 */
    public boolean delete(String name) {
        synchronized (lock) {
            boolean removed = repository.delete(CATEGORY, name);
            Map<String, Stored> current = new LinkedHashMap<>(rows());
            current.remove(name);
            cache = Collections.unmodifiableMap(current);
            if (removed) log.info("Configured provider '{}' deleted from settings", name);
            return removed;
        }
    }

    /** 丢弃缓存并从库重新加载。 */
    public void reload() {
        synchronized (lock) {
            cache = null;
            rows();
        }
    }

    // ───── 内部 ─────

    private Map<String, Stored> rows() {
        Map<String, Stored> snapshot = cache;
        if (snapshot != null) return snapshot;
        synchronized (lock) {
            if (cache != null) return cache;
            Map<String, Stored> loaded = new LinkedHashMap<>();
            for (var stored : repository.list(CATEGORY)) {
                if (SEED_MARKER.equals(stored.key())) continue;
                try {
                    loaded.put(stored.key(), deserialize(stored.value()));
                } catch (RuntimeException failure) {
                    // 单条损坏不该让整个设置页打不开；跳过它并留下可定位的日志
                    log.warn("Skipping unreadable configured provider '{}': {}", stored.key(), failure.getMessage());
                }
            }
            cache = Collections.unmodifiableMap(loaded);
            return cache;
        }
    }

    static List<String> normalizeModels(List<String> raw) {
        return LlmProviderSettingsService.normalizeModels(raw).stream()
                .filter(model -> !LlmProvidersProperties.isRemovedModel(model))
                .toList();
    }

    private static ApiKeyRotationManager.KeySelectionStrategy strategy(String name) {
        if (name == null) return ApiKeyRotationManager.KeySelectionStrategy.ROUND_ROBIN;
        try {
            return ApiKeyRotationManager.KeySelectionStrategy.valueOf(name);
        } catch (IllegalArgumentException e) {
            return ApiKeyRotationManager.KeySelectionStrategy.ROUND_ROBIN;
        }
    }

    private static String strategyName(ApiKeyRotationManager.KeySelectionStrategy strategy) {
        return strategy == null ? null : strategy.name();
    }

    private String serialize(Stored stored) {
        Map<String, Object> plain = new LinkedHashMap<>();
        plain.put("apiKey", stored.apiKey() == null ? null : encryption.encrypt(stored.apiKey()));
        plain.put("baseUrl", stored.baseUrl());
        plain.put("models", stored.models());
        plain.put("defaultModel", stored.defaultModel());
        plain.put("enabled", stored.enabled());
        plain.put("keySelectionStrategy", stored.keySelectionStrategy());
        try {
            return objectMapper.writeValueAsString(plain);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Failed to serialize configured provider", e);
        }
    }

    private Stored deserialize(String json) {
        try {
            var node = objectMapper.readTree(json);
            var keyNode = node.path("apiKey");
            String encryptedKey = keyNode.isMissingNode() || keyNode.isNull() ? null : keyNode.asText(null);
            String apiKey = null;
            if (encryptedKey != null && !encryptedKey.isEmpty()) {
                try {
                    apiKey = encryption.decrypt(encryptedKey);
                } catch (RuntimeException failure) {
                    // 解不开的密钥（例如换了加密密钥）当作没填过，等用户重新输入
                    log.warn("Stored API key of provider '{}' cannot be decrypted; treating it as not set",
                            node.path("name").asText("?"));
                }
            }
            List<String> models = new ArrayList<>();
            node.path("models").forEach(m -> models.add(m.asText()));
            return new Stored(apiKey, node.path("baseUrl").asText(""),
                    normalizeModels(models), node.path("defaultModel").asText(null),
                    node.path("enabled").asBoolean(true),
                    node.has("keySelectionStrategy") && !node.path("keySelectionStrategy").isNull()
                            ? node.path("keySelectionStrategy").asText() : null);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Stored configured provider is not valid JSON", e);
        }
    }
}
