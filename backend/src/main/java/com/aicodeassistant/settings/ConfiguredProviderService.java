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
import java.util.Set;
import java.util.function.Predicate;

/**
 * 配置文件（application.yml + 环境变量）里定义的那批服务商：OpenAI、百炼、DeepSeek、智谱、火神中转站……
 * 它们的接口地址和默认模型清单都写在配置里，通常只差一把密钥。
 * <p>
 * 这些条目也能在设置页里改：填密钥、改模型清单、启停。改动以"覆盖"的形式存库
 * （{@value #CATEGORY}），和配置文件合成一份生效配置；删掉覆盖就回到配置文件的值。
 * 注册名始终是配置里的名字（huoshenai、deepseek…），所以按名字生效的特殊行为
 * （ZenMux 的 Responses 接口、百炼 Token Plan 的模型 ID 映射等）都不受影响。
 * <p>
 * 覆盖记录只存用户明确改过的东西：没在页面上输入密钥时 {@code apiKey} 记为 null，
 * 表示沿用配置文件里的那把——配置文件里换了密钥照样生效。
 */
@Service
public class ConfiguredProviderService {

    private static final Logger log = LoggerFactory.getLogger(ConfiguredProviderService.class);

    public static final String CATEGORY = "configured_provider_override";

    /** 配置里接口地址可以被环境变量改掉的服务商；其余的地址是写死的，设置页里不给改。 */
    private static final Set<String> BASE_URL_EDITABLE = Set.of("deepseek");

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
     * 生效配置：配置文件里的定义叠加设置页里的覆盖。
     *
     * @param keyFromConfig 生效的密钥来自配置文件（而不是页面上填的）
     */
    public record Effective(
            String name,
            String displayName,
            String baseUrl,
            String apiKey,
            List<String> models,
            String defaultModel,
            boolean enabled,
            boolean overridden,
            boolean keyFromConfig,
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
            boolean keyFromConfig,
            List<String> models,
            String defaultModel,
            boolean enabled,
            boolean overridden,
            boolean active,
            boolean baseUrlEditable) {}

    /**
     * 在设置页里保存时的入参。apiKey 为 null 或空白表示不改密钥；models、defaultModel 为 null 表示不改；
     * enabled 为 null 表示启用。
     */
    public record ConfiguredProviderInput(
            String apiKey, String baseUrl, List<String> models, String defaultModel, Boolean enabled) {}

    /** 覆盖记录。apiKey 为 null 表示沿用配置文件里的密钥；落库时只有它是加密的。 */
    record Override(String apiKey, String baseUrl, List<String> models, String defaultModel, boolean enabled) {}

    private final LlmProvidersProperties properties;
    private final SettingsRepository repository;
    private final TokenEncryptionService encryption;
    private final ObjectMapper objectMapper;
    /** 保护缓存与库的一致性；缓存为 null 表示尚未从库加载。 */
    private final Object lock = new Object();
    private volatile Map<String, Override> cache;

    public ConfiguredProviderService(LlmProvidersProperties properties,
                                     SettingsRepository repository,
                                     TokenEncryptionService encryption,
                                     ObjectMapper objectMapper) {
        this.properties = properties;
        this.repository = repository;
        this.encryption = encryption;
        this.objectMapper = objectMapper;
    }

    /** 配置里定义的全部服务商名，按配置文件里的顺序。 */
    public List<String> names() {
        Map<String, LlmProvidersProperties.ProviderConfig> configs = properties.providers();
        return configs == null ? List.of() : List.copyOf(configs.keySet());
    }

    public static String displayName(String name) {
        return DISPLAY_NAMES.getOrDefault(name, name);
    }

    public static boolean baseUrlEditable(String name) {
        return BASE_URL_EDITABLE.contains(name);
    }

    /** 全部配置里的服务商的生效配置，按配置文件里的顺序。 */
    public List<Effective> effectiveProviders() {
        List<Effective> result = new ArrayList<>();
        for (String name : names()) effective(name).ifPresent(result::add);
        return List.copyOf(result);
    }

    public Optional<Effective> effective(String name) {
        LlmProvidersProperties.ProviderConfig template = template(name);
        if (template == null) return Optional.empty();
        Override override = overrides().get(name);
        String apiKey = override != null && override.apiKey() != null ? override.apiKey()
                : Objects.requireNonNullElse(template.apiKey(), "");
        String baseUrl = override != null && override.baseUrl() != null ? override.baseUrl()
                : Objects.requireNonNullElse(template.baseUrl(), "");
        List<String> models = override != null ? override.models() : template.models();
        String defaultModel = override != null ? override.defaultModel() : template.defaultModel();
        boolean enabled = override == null || override.enabled();
        return Optional.of(new Effective(name, displayName(name), baseUrl, apiKey, models, defaultModel,
                enabled, override != null, override == null || override.apiKey() == null,
                template.keySelectionStrategy()));
    }

    /**
     * @param isActive 按服务商名判断它此刻是否已注册进运行时
     */
    public List<ConfiguredProviderView> views(Predicate<String> isActive) {
        List<ConfiguredProviderView> views = new ArrayList<>();
        for (String name : names()) {
            Effective effective = effective(name).orElseThrow();
            views.add(new ConfiguredProviderView(name, effective.displayName(), effective.baseUrl(),
                    LlmProviderSettingsService.mask(effective.apiKey()),
                    effective.apiKey() != null && !effective.apiKey().isBlank(),
                    effective.keyFromConfig(), effective.models(), effective.defaultModel(), effective.enabled(),
                    effective.overridden(), isActive.test(name), baseUrlEditable(name)));
        }
        return views;
    }

    /** 保存一条覆盖。留空的密钥表示不改密钥：之前在页面上填过就沿用那把，否则用配置文件里的。 */
    public void save(String name, ConfiguredProviderInput input) {
        LlmProvidersProperties.ProviderConfig template = template(name);
        if (template == null) {
            throw new RequestValidationException("PROVIDER_NOT_FOUND", "配置里没有这个服务商：" + name);
        }
        if (input == null) {
            throw new RequestValidationException("INVALID_PROVIDER", "请求体不能为空");
        }
        synchronized (lock) {
            Override previous = overrides().get(name);
            String submitted = input.apiKey() == null ? "" : input.apiKey().trim();
            String storedKey = previous == null ? null : previous.apiKey();
            if (!submitted.isEmpty()) {
                if (!encryption.keyIsPersistent()) {
                    throw new RequestValidationException("ENCRYPTION_KEY_REQUIRED",
                            "当前运行环境没有稳定的加密密钥，不能保存 API Key。请通过环境变量 ZHIKU_ENCRYPTION_KEY "
                                    + "（Base64 编码的 32 字节随机值）提供密钥后重启服务；密钥丢失会导致已保存的 Key 无法解密。");
                }
                storedKey = submitted;
            }
            // 模型清单不传表示不改（比如只想停用）；传了就整体替换
            List<String> models = input.models() == null ? null : normalizeModels(input.models());
            if (models == null) {
                models = effective(name).orElseThrow().models();
            }
            if (models.isEmpty()) {
                throw new RequestValidationException("INVALID_PROVIDER", "至少要填写一个模型");
            }
            // 默认模型不传表示不改（比如只想停用）；传了就以传的为准。它不在清单里时退到第一个
            String defaultModel = input.defaultModel() == null ? null : input.defaultModel().trim();
            if (defaultModel == null || defaultModel.isEmpty()) {
                defaultModel = effective(name).orElseThrow().defaultModel();
            }
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
            String baseUrl = Objects.requireNonNullElse(template.baseUrl(), "");
            if (baseUrlEditable(name) && input.baseUrl() != null && !input.baseUrl().isBlank()) {
                baseUrl = input.baseUrl().trim().replaceAll("/+$", "");
                if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
                    throw new RequestValidationException("INVALID_PROVIDER", "接口地址必须以 http:// 或 https:// 开头");
                }
                if (okhttp3.HttpUrl.parse(baseUrl) == null) {
                    throw new RequestValidationException("INVALID_PROVIDER",
                            "接口地址不是一个完整的网址，形如 https://api.example.com/v1");
                }
            }
            Override override = new Override(storedKey, baseUrl, models, defaultModel,
                    input.enabled() == null || input.enabled());
            repository.upsert(CATEGORY, name, serialize(override), null);
            Map<String, Override> current = new LinkedHashMap<>(overrides());
            current.put(name, override);
            cache = Collections.unmodifiableMap(current);
            log.info("Configured provider '{}' overridden from settings: models={}, enabled={}, keyChanged={}",
                    name, models, override.enabled(), !submitted.isEmpty());
        }
    }

    /** 删掉覆盖，回到配置文件里的值。 */
    public boolean reset(String name) {
        synchronized (lock) {
            boolean removed = repository.delete(CATEGORY, name);
            Map<String, Override> current = new LinkedHashMap<>(overrides());
            current.remove(name);
            cache = Collections.unmodifiableMap(current);
            return removed;
        }
    }

    /** 丢弃缓存并从库重新加载。 */
    public void reload() {
        synchronized (lock) {
            cache = null;
            overrides();
        }
    }

    // ───── 内部 ─────

    private LlmProvidersProperties.ProviderConfig template(String name) {
        Map<String, LlmProvidersProperties.ProviderConfig> configs = properties.providers();
        return configs == null ? null : configs.get(name);
    }

    private Map<String, Override> overrides() {
        Map<String, Override> snapshot = cache;
        if (snapshot != null) return snapshot;
        synchronized (lock) {
            if (cache != null) return cache;
            Map<String, Override> loaded = new LinkedHashMap<>();
            for (var stored : repository.list(CATEGORY)) {
                try {
                    loaded.put(stored.key(), deserialize(stored.value()));
                } catch (RuntimeException failure) {
                    // 单条损坏不该让整个设置页打不开；跳过它并留下可定位的日志
                    log.warn("Skipping unreadable configured provider override '{}': {}",
                            stored.key(), failure.getMessage());
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

    private String serialize(Override override) {
        Map<String, Object> plain = new LinkedHashMap<>();
        plain.put("apiKey", override.apiKey() == null ? null : encryption.encrypt(override.apiKey()));
        plain.put("baseUrl", override.baseUrl());
        plain.put("models", override.models());
        plain.put("defaultModel", override.defaultModel());
        plain.put("enabled", override.enabled());
        try {
            return objectMapper.writeValueAsString(plain);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Failed to serialize configured provider override", e);
        }
    }

    private Override deserialize(String json) {
        try {
            var node = objectMapper.readTree(json);
            var keyNode = node.path("apiKey");
            String encryptedKey = keyNode.isMissingNode() || keyNode.isNull() ? null : keyNode.asText(null);
            String apiKey = null;
            if (encryptedKey != null && !encryptedKey.isEmpty()) {
                try {
                    apiKey = encryption.decrypt(encryptedKey);
                } catch (RuntimeException failure) {
                    // 解不开的密钥（例如换了加密密钥）当作没填过：回落到配置文件里的，等用户重新输入
                    log.warn("Stored API key of a configured provider override cannot be decrypted; "
                            + "using the configured key until it is re-entered");
                }
            }
            List<String> models = new ArrayList<>();
            node.path("models").forEach(m -> models.add(m.asText()));
            return new Override(apiKey, node.path("baseUrl").asText(null), normalizeModels(models),
                    node.path("defaultModel").asText(null), node.path("enabled").asBoolean(true));
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Stored configured provider override is not valid JSON", e);
        }
    }
}
