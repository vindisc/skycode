package com.aicodeassistant.llm;

import com.aicodeassistant.llm.impl.OpenAiCompatibleProvider;
import com.aicodeassistant.settings.LlmProviderSettingsService;
import com.aicodeassistant.settings.Setting;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 把设置页服务商池里启用的条目注册进 {@link LlmProviderRegistry}，这样在设置页加的服务商和模型
 * 才会真正出现在模型选择器和主会话里。
 * <p>
 * 触发时机：全部单例创建完成后（早于 Web 服务器启动）同步一次；之后由设置接口在保存、删除、
 * reload 之后调用 {@link #sync()}。这里不反过来依赖设置接口，避免循环依赖。
 * <p>
 * 注册的名字带 {@link LlmProviderRegistry#POOL_PROVIDER_PREFIX} 前缀。直接用原名会覆盖配置里
 * 同名的那份，连带让压缩摘要和视觉兜底找不到模型。
 * <p>
 * 不抢模型：同一个模型出现在两个 Provider 名下时 {@link LlmProviderRegistry#getProvider} 会直接
 * 抛错。配置 / 环境变量已声明的模型，以及本轮已被池里靠前条目声明的模型，都会被跳过并记下原因。
 * <p>
 * 模型不需要先在内置能力表里登记过：没登记的由 {@link PoolModelCapabilities} 推算一份能力
 * （沿用相近型号的参数，或者用通用参数），登记进 {@link ModelRegistry}。
 * 不这么做的话，设置页里加的新模型只会拿到保守默认值（8K 窗口、不支持工具），
 * 算出的预算为负，一选就报错——用户看到的就是"加了却不显示 / 不能用"。
 */
@Service
public class DbProviderRegistrySync implements SmartInitializingSingleton {

    private static final Logger log = LoggerFactory.getLogger(DbProviderRegistrySync.class);

    /** 某个模型没有注册进运行时的原因。 */
    public record ModelSkip(String model, String reason) {}

    /** 一个不在内置能力表里的模型，以及给它登记能力时依据的是什么。 */
    public record InferredModel(String model, String basis) {}

    /**
     * 池里一个条目的同步结果。
     *
     * @param registeredAs     注册进注册表的名字（{@code db:<key>}）；没有注册时为 null
     * @param inferredModels   注册的模型里不在内置能力表里的那些，以及各自登记能力时依据的参数
     * @param defaultModel     实际生效的默认模型；条目里填的默认模型被跳过时，退到第一个注册成功的模型
     * @param skipReason       整个条目被跳过的原因；已注册时为 null
     * @param needsAttention   有需要用户处理的问题（目前只有注册失败）。已停用、模型都由其他服务商提供不算
     */
    public record ProviderSync(
            String providerKey,
            String providerName,
            String registeredAs,
            List<String> registeredModels,
            List<InferredModel> inferredModels,
            String defaultModel,
            List<ModelSkip> skippedModels,
            String skipReason,
            boolean needsAttention) {}

    public record SyncResult(List<ProviderSync> providers) {
        /** 注册进运行时的全部模型，按池里的顺序。 */
        public List<String> registeredModels() {
            return providers.stream().flatMap(p -> p.registeredModels().stream()).toList();
        }

        /** 其中不在内置能力表里、按推算参数登记的模型。 */
        public List<InferredModel> inferredModels() {
            return providers.stream().flatMap(p -> p.inferredModels().stream()).toList();
        }
    }

    private final LlmProviderSettingsService pool;
    private final LlmProviderRegistry registry;
    private final ModelRegistry modelRegistry;
    private final LlmHttpProperties httpProperties;
    private final ObjectMapper objectMapper;
    private final FinalProviderPayloadGuard payloadGuard;

    private volatile SyncResult last;

    public DbProviderRegistrySync(LlmProviderSettingsService pool,
                                  LlmProviderRegistry registry,
                                  ModelRegistry modelRegistry,
                                  LlmHttpProperties httpProperties,
                                  ObjectMapper objectMapper,
                                  FinalProviderPayloadGuard payloadGuard) {
        this.pool = pool;
        this.registry = registry;
        this.modelRegistry = modelRegistry;
        this.httpProperties = httpProperties;
        this.objectMapper = objectMapper;
        this.payloadGuard = payloadGuard;
    }

    @Override
    public void afterSingletonsInstantiated() {
        try {
            sync();
        } catch (RuntimeException failure) {
            // 池只是配置之外的一个补充来源，它出问题不该拖垮整个服务的启动
            log.error("Skipping provider pool sync at startup; continuing with configured providers only",
                    failure);
        }
    }

    /** 最近一次同步的结果；启动时同步失败则为 null。 */
    public SyncResult last() {
        return last;
    }

    public synchronized SyncResult sync() {
        Map<String, String> configuredOwners = registry.modelOwnersOutsidePool();
        // 本轮已被池里靠前条目声明的模型 -> 那个条目的显示名
        Map<String, String> poolOwners = new HashMap<>();
        List<LlmProvider> providers = new ArrayList<>();
        List<ProviderSync> results = new ArrayList<>();
        // 不在内置能力表里的模型，这一轮给它们登记的能力
        List<ModelCapabilities> poolCapabilities = new ArrayList<>();
        java.util.Set<String> knownModelIds = modelRegistry.staticModelIds();

        for (var entry : pool.getAllProviderEntries()) {
            String key = entry.key();
            Setting.LlmProviderConfig config = entry.config();
            if (!config.enabled()) {
                results.add(new ProviderSync(key, config.name(), null, List.of(), List.of(), null, List.of(),
                        "服务商已停用", false));
                continue;
            }

            List<String> registrable = new ArrayList<>();
            List<InferredModel> inferred = new ArrayList<>();
            List<ModelSkip> skips = new ArrayList<>();
            for (String model : config.models()) {
                String claimedBy = claimedBy(model, configuredOwners, poolOwners);
                if (claimedBy != null) {
                    skips.add(new ModelSkip(model, claimedBy));
                    continue;
                }
                registrable.add(model);
                poolOwners.put(model, config.name());
                if (!modelRegistry.hasStaticCapabilities(model)) {
                    PoolModelCapabilities.Inferred guess = PoolModelCapabilities.infer(
                            model, knownModelIds, modelRegistry::findStaticCapabilities);
                    poolCapabilities.add(guess.capabilities());
                    inferred.add(new InferredModel(model, guess.basis()));
                }
            }
            if (registrable.isEmpty()) {
                // 没被占用的模型都会注册，所以为空只剩一种情况：全是"别人已经在提供"。不算故障，
                // 文案上要说清楚，免得用户以为配置坏了
                results.add(new ProviderSync(key, config.name(), null, List.of(), List.of(), null, skips,
                        "模型都已由其他服务商提供，无需重复注册", false));
                continue;
            }

            String defaultModel = registrable.contains(config.defaultModel())
                    ? config.defaultModel() : registrable.getFirst();
            String registeredAs = LlmProviderRegistry.POOL_PROVIDER_PREFIX + key;
            try {
                providers.add(newProvider(registeredAs, config, registrable, defaultModel));
            } catch (RuntimeException failure) {
                // 构造失败（例如接口地址不合法）只影响这一个条目；释放它占住的模型，别挡住后面的条目
                registrable.forEach(poolOwners::remove);
                // 这一条注册不了，给它那些没登记过的模型推算的能力也一并撤掉
                for (InferredModel item : inferred) {
                    poolCapabilities.removeIf(capability -> capability.modelId().equals(item.model()));
                }
                log.warn("Provider pool entry '{}' cannot be registered: {}", key, failure.getMessage());
                results.add(new ProviderSync(key, config.name(), null, List.of(), List.of(), null, skips,
                        "注册失败：" + failure.getMessage(), true));
                continue;
            }
            results.add(new ProviderSync(key, config.name(), registeredAs, registrable, List.copyOf(inferred),
                    defaultModel, skips, null, false));
        }

        // 先登记能力再注册 Provider：Provider 一注册，请求就可能来查这些模型的能力
        modelRegistry.replacePoolModels(poolCapabilities);
        registry.replaceDbProviders(providers);
        SyncResult result = new SyncResult(List.copyOf(results));
        last = result;
        log.info("Provider pool synced: registered {}, inferred {}, skipped {} model(s)",
                result.registeredModels(), result.inferredModels(),
                results.stream().mapToInt(p -> p.skippedModels().size()).sum());
        return result;
    }

    /** @return 该模型已被哪个服务商占用（完整原因文案）；没人占用时返回 null */
    private String claimedBy(String model, Map<String, String> configuredOwners, Map<String, String> poolOwners) {
        String configuredOwner = configuredOwners.get(model);
        if (configuredOwner != null) {
            return "已由配置里的服务商「" + configuredOwner + "」提供";
        }
        String poolOwner = poolOwners.get(model);
        if (poolOwner != null) {
            return "已由池里排在前面的「" + poolOwner + "」提供";
        }
        return null;
    }

    private OpenAiCompatibleProvider newProvider(String registeredAs, Setting.LlmProviderConfig config,
                                                 List<String> models, String defaultModel) {
        // 与配置创建的 Provider 一致：逗号分隔的多把 Key 进轮换管理器，首把作为兜底
        List<String> apiKeys = MultiProviderConfiguration.splitApiKeys(config.apiKey());
        return new OpenAiCompatibleProvider(registeredAs, objectMapper, httpProperties,
                new ApiKeyRotationManager(apiKeys), apiKeys.isEmpty() ? null : apiKeys.getFirst(),
                config.baseUrl(), defaultModel, models, payloadGuard);
    }
}
