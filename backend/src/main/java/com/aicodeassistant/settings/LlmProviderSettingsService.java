package com.aicodeassistant.settings;

import com.aicodeassistant.exception.RequestValidationException;
import com.aicodeassistant.mcp.TokenEncryptionService;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 服务商池：在设置页里增删改 LLM 服务商，保存后由 DbProviderRegistrySync 注册进运行时。
 * <p>
 * 存储键在创建时由显示名生成，之后不再变化（改显示名不会改键）；场景绑定引用的是存储键，
 * 所以任何对外下发"可选服务商"的地方都必须用 {@link #getAllProviderEntries()} 里的真实键，
 * 不能从显示名反推——反推值与库里的键在改过名之后对不上，下拉选中后会报"服务商不存在"。
 */
@Service
public class LlmProviderSettingsService {

    private static final Logger log = LoggerFactory.getLogger(LlmProviderSettingsService.class);
    private static final Pattern KEY_NORMALIZE = Pattern.compile("[^\\p{L}\\p{N}]+");
    private static final Pattern MODEL_SEPARATORS = Pattern.compile("[,\\n\\r]+");

    private final SettingsRepository repository;
    private final TokenEncryptionService encryption;
    private final ObjectMapper objectMapper;
    /** 保护缓存与库的一致性；缓存为 null 表示尚未从库加载。 */
    private final Object lock = new Object();
    private volatile Map<String, Setting.LlmProviderConfig> cache;

    public LlmProviderSettingsService(SettingsRepository repository,
                                     TokenEncryptionService encryption,
                                     ObjectMapper objectMapper) {
        this.repository = repository;
        this.encryption = encryption;
        this.objectMapper = objectMapper;
    }

    /** 池里的一条服务商，apiKey 为解密后的真实值，仅供进程内部使用，绝不能直接下发给前端。 */
    public record ProviderEntry(String key, Setting.LlmProviderConfig config) {}

    /** 下发给界面的视图：密钥只给打码后的形式。 */
    public record ProviderView(
            String key,
            String name,
            String baseUrl,
            String apiKeyMasked,
            boolean hasApiKey,
            List<String> models,
            String defaultModel,
            boolean enabled,
            String updatedAt) {}

    /** 创建或更新时的入参。apiKey 为 null 或空白表示保持原值不变。 */
    public record ProviderInput(
            String name,
            String baseUrl,
            String apiKey,
            List<String> models,
            String defaultModel,
            Boolean enabled) {}

    /** 池里全部服务商，按创建顺序。键是实际存储键。 */
    public List<ProviderEntry> getAllProviderEntries() {
        return load().entrySet().stream()
                .map(e -> new ProviderEntry(e.getKey(), e.getValue()))
                .toList();
    }

    public List<ProviderView> list() {
        List<ProviderView> views = new ArrayList<>();
        var entries = repository.list(SettingsRepository.CATEGORY_LLM_PROVIDER);
        for (var stored : entries) {
            Setting.LlmProviderConfig config = load().get(stored.key());
            if (config == null) continue;
            views.add(toView(stored.key(), config, stored.updatedAt()));
        }
        return views;
    }

    public ProviderEntry create(ProviderInput input) {
        Setting.LlmProviderConfig config = validate(input, null);
        synchronized (lock) {
            Map<String, Setting.LlmProviderConfig> current = new LinkedHashMap<>(load());
            String key = uniqueKey(current.keySet(), config.name());
            repository.upsert(SettingsRepository.CATEGORY_LLM_PROVIDER, key, serialize(config), null);
            current.put(key, config);
            cache = Collections.unmodifiableMap(current);
            log.info("LLM provider created from settings pool: key={}, name={}", key, config.name());
            return new ProviderEntry(key, config);
        }
    }

    public ProviderEntry update(String key, ProviderInput input) {
        synchronized (lock) {
            Map<String, Setting.LlmProviderConfig> current = new LinkedHashMap<>(load());
            Setting.LlmProviderConfig existing = current.get(key);
            if (existing == null) {
                throw new RequestValidationException("PROVIDER_NOT_FOUND", "服务商不存在：" + key);
            }
            Setting.LlmProviderConfig config = validate(input, existing);
            repository.upsert(SettingsRepository.CATEGORY_LLM_PROVIDER, key, serialize(config), null);
            current.put(key, config);
            cache = Collections.unmodifiableMap(current);
            log.info("LLM provider updated from settings pool: key={}, name={}", key, config.name());
            return new ProviderEntry(key, config);
        }
    }

    public void delete(String key) {
        synchronized (lock) {
            if (!repository.delete(SettingsRepository.CATEGORY_LLM_PROVIDER, key)) {
                throw new RequestValidationException("PROVIDER_NOT_FOUND", "服务商不存在：" + key);
            }
            Map<String, Setting.LlmProviderConfig> current = new LinkedHashMap<>(load());
            current.remove(key);
            cache = Collections.unmodifiableMap(current);
            log.info("LLM provider deleted from settings pool: key={}", key);
        }
    }

    /** 丢弃缓存并从库重新加载。 */
    public void reload() {
        synchronized (lock) {
            cache = null;
            load();
        }
    }

    /**
     * 加密密钥在进程重启后是否仍然可用。为 false 时拒绝保存带密钥的服务商，
     * 而不是先写进去、等下次启动解不开。
     */
    public boolean encryptionKeyIsStable() {
        return encryption.keyIsPersistent();
    }

    // ───── 内部 ─────

    private Map<String, Setting.LlmProviderConfig> load() {
        Map<String, Setting.LlmProviderConfig> snapshot = cache;
        if (snapshot != null) return snapshot;
        synchronized (lock) {
            if (cache != null) return cache;
            Map<String, Setting.LlmProviderConfig> loaded = new LinkedHashMap<>();
            for (var stored : repository.list(SettingsRepository.CATEGORY_LLM_PROVIDER)) {
                try {
                    loaded.put(stored.key(), deserialize(stored.value()));
                } catch (RuntimeException failure) {
                    // 单条损坏不该让整个设置页打不开；跳过它并留下可定位的日志
                    log.warn("Skipping unreadable LLM provider setting '{}': {}", stored.key(), failure.getMessage());
                }
            }
            cache = Collections.unmodifiableMap(loaded);
            return cache;
        }
    }

    private Setting.LlmProviderConfig validate(ProviderInput input, Setting.LlmProviderConfig existing) {
        if (input == null) {
            throw new RequestValidationException("INVALID_PROVIDER", "请求体不能为空");
        }
        String name = requireText(input.name(), "服务商名称不能为空");
        String baseUrl = requireText(input.baseUrl(), "接口地址不能为空").replaceAll("/+$", "");
        if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
            throw new RequestValidationException("INVALID_PROVIDER", "接口地址必须以 http:// 或 https:// 开头");
        }
        // 构造 Provider 时不校验网址，要等发请求才报错；在保存时就拦住，用户能马上改
        if (okhttp3.HttpUrl.parse(baseUrl) == null) {
            throw new RequestValidationException("INVALID_PROVIDER", "接口地址不是一个完整的网址，形如 https://api.example.com/v1");
        }
        List<String> models = normalizeModels(input.models());
        if (models.isEmpty()) {
            throw new RequestValidationException("INVALID_PROVIDER", "至少要填写一个模型");
        }
        String defaultModel = input.defaultModel() == null ? "" : input.defaultModel().trim();
        if (defaultModel.isEmpty()) defaultModel = models.getFirst();
        if (!models.contains(defaultModel)) {
            // 模型 ID 的匹配是大小写敏感的，这里不做大小写归一，只校验是否在清单里
            throw new RequestValidationException("INVALID_PROVIDER",
                    "默认模型 " + defaultModel + " 不在该服务商的模型清单里");
        }
        boolean enabled = input.enabled() == null
                ? (existing == null || existing.enabled()) : input.enabled();

        String apiKey;
        String submitted = input.apiKey() == null ? "" : input.apiKey().trim();
        if (submitted.isEmpty()) {
            // 留空表示不修改；新建时留空即保存为无密钥的服务商（例如本地模型）
            apiKey = existing == null ? "" : Objects.requireNonNullElse(existing.apiKey(), "");
        } else {
            if (!encryption.keyIsPersistent()) {
                throw new RequestValidationException("ENCRYPTION_KEY_REQUIRED",
                        "当前运行环境没有稳定的加密密钥，不能保存 API Key。请通过环境变量 ZHIKU_ENCRYPTION_KEY "
                                + "（Base64 编码的 32 字节随机值）提供密钥后重启服务；密钥丢失会导致已保存的 Key 无法解密。");
            }
            apiKey = submitted;
        }
        return new Setting.LlmProviderConfig(name, baseUrl, apiKey, models, defaultModel, enabled);
    }

    /** 逗号、换行分隔都接受；逐个去空白、去空项、去重，保持大小写与原顺序。 */
    static List<String> normalizeModels(List<String> raw) {
        if (raw == null) return List.of();
        Set<String> out = new LinkedHashSet<>();
        for (String item : raw) {
            if (item == null) continue;
            for (String piece : MODEL_SEPARATORS.split(item)) {
                String model = piece.trim();
                if (!model.isEmpty()) out.add(model);
            }
        }
        return List.copyOf(out);
    }

    /** 保留任何文字的字母和数字（中文名得到中文键），其余字符折成短横线；归一后为空时退回通用前缀。 */
    static String normalizeKey(String name) {
        String lowered = name == null ? "" : name.toLowerCase(Locale.ROOT);
        String key = KEY_NORMALIZE.matcher(lowered).replaceAll("-").replaceAll("^-+|-+$", "");
        return key.isEmpty() ? "provider" : key;
    }

    private static String uniqueKey(Iterable<String> existing, String name) {
        String base = normalizeKey(name);
        String candidate = base;
        for (int suffix = 2; contains(existing, candidate); suffix++) {
            candidate = base + "-" + suffix;
        }
        return candidate;
    }

    private static boolean contains(Iterable<String> keys, String candidate) {
        for (String key : keys) if (key.equals(candidate)) return true;
        return false;
    }

    private String serialize(Setting.LlmProviderConfig config) {
        Map<String, Object> plain = new LinkedHashMap<>();
        plain.put("name", config.name());
        plain.put("baseUrl", config.baseUrl());
        plain.put("apiKey", config.apiKey() == null || config.apiKey().isEmpty()
                ? "" : encryption.encrypt(config.apiKey()));
        plain.put("models", config.models());
        plain.put("defaultModel", config.defaultModel());
        plain.put("enabled", config.enabled());
        return toJson(plain);
    }

    private Setting.LlmProviderConfig deserialize(String json) {
        try {
            var node = objectMapper.readTree(json);
            String encryptedKey = node.path("apiKey").asText("");
            // 解不开的密钥（例如换了加密密钥）当作无密钥处理并告警，由同步层带原因跳过
            String apiKey = "";
            if (!encryptedKey.isEmpty()) {
                try {
                    apiKey = encryption.decrypt(encryptedKey);
                } catch (RuntimeException failure) {
                    log.warn("Stored API key cannot be decrypted; treating as missing until it is re-entered");
                }
            }
            List<String> models = new ArrayList<>();
            node.path("models").forEach(m -> models.add(m.asText()));
            return new Setting.LlmProviderConfig(
                    node.path("name").asText(""),
                    node.path("baseUrl").asText(""),
                    apiKey,
                    normalizeModels(models),
                    node.path("defaultModel").asText(""),
                    node.path("enabled").asBoolean(true));
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Stored LLM provider setting is not valid JSON", e);
        }
    }

    private ProviderView toView(String key, Setting.LlmProviderConfig config, String updatedAt) {
        String masked = mask(config.apiKey());
        return new ProviderView(key, config.name(), config.baseUrl(), masked,
                config.apiKey() != null && !config.apiKey().isEmpty(),
                config.models(), config.defaultModel(), config.enabled(), updatedAt);
    }

    /** 只保留末 4 位；过短的密钥整体打码。 */
    static String mask(String secret) {
        if (secret == null || secret.isEmpty()) return "";
        if (secret.length() <= 8) return "••••";
        return "••••" + secret.substring(secret.length() - 4);
    }

    private static String requireText(String value, String message) {
        if (value == null || value.isBlank()) {
            throw new RequestValidationException("INVALID_PROVIDER", message);
        }
        return value.trim();
    }

    private String toJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Failed to serialize LLM provider setting", e);
        }
    }
}
