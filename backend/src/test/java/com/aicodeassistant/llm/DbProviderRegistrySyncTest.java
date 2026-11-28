package com.aicodeassistant.llm;

import com.aicodeassistant.llm.DbProviderRegistrySync.ModelSkip;
import com.aicodeassistant.llm.DbProviderRegistrySync.ProviderSync;
import com.aicodeassistant.llm.impl.OpenAiCompatibleProvider;
import com.aicodeassistant.settings.ConfiguredProviderService;
import com.aicodeassistant.settings.LlmProviderSettingsService;
import com.aicodeassistant.settings.LlmProviderSettingsService.ProviderInput;
import com.aicodeassistant.settings.SettingsRepository;
import com.aicodeassistant.settings.SettingsTestSupport;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.api.Tag;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.env.MockEnvironment;

import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * 池同步：池里的服务商以 db: 前缀注册进运行时，不抢配置里已有的模型，
 * 配置里的服务商按原名注册（叠加设置页里的修改），池里的以 db: 前缀注册、不抢已被占用的模型。
 */
@Tag("smoke")
class DbProviderRegistrySyncTest {

    @TempDir
    Path temp;

    private final ObjectMapper mapper = new ObjectMapper();
    private LlmProviderRegistry registry;
    private ModelRegistry modelRegistry;
    private LlmProviderSettingsService pool;
    private ConfiguredProviderService configured;
    private DbProviderRegistrySync sync;

    @BeforeEach
    void setUp() {
        JdbcTemplate jdbc = SettingsTestSupport.globalDb(temp);
        registry = new LlmProviderRegistry(
                List.of(provider("huoshen", List.of("gpt-6.2-sol", "gpt-6.1-sol"))), new MockEnvironment());
        modelRegistry = new ModelRegistry(registry);
        pool = new LlmProviderSettingsService(new SettingsRepository(jdbc), SettingsTestSupport.encryption(), mapper);
        // 配置文件里的两个服务商：huoshen 有密钥，zhipu 没有
        Map<String, LlmProvidersProperties.ProviderConfig> templates = new java.util.LinkedHashMap<>();
        templates.put("huoshen", new LlmProvidersProperties.ProviderConfig("sk-config-huoshen",
                "https://huoshen.example/v1", "gpt-6.2-sol", List.of("gpt-6.2-sol", "gpt-6.1-sol")));
        templates.put("zhipu", new LlmProvidersProperties.ProviderConfig("",
                "https://open.bigmodel.cn/api/paas/v4", "glm-5.3", List.of("glm-5.3")));
        configured = new ConfiguredProviderService(new LlmProvidersProperties(templates),
                new SettingsRepository(jdbc), SettingsTestSupport.encryption(), mapper);
        configured.seedIfNeeded();
        sync = new DbProviderRegistrySync(pool, configured, registry, modelRegistry, httpProperties(), mapper, null);
    }

    @Test
    void configuredProvidersAreRegisteredUnderTheirOwnNamesAndCanBeEnabledFromTheSettingsPage() {
        sync.sync();

        // huoshen 按原名注册（没有 db: 前缀）；zhipu 在配置里没有密钥，不注册
        assertThat(registry.registeredProviderNames()).containsExactly("huoshen");
        assertThat(registry.getProvider("gpt-6.2-sol").getProviderName()).isEqualTo("huoshen");

        // 在设置页上删掉它：从注册表里消失，再同步也不会回来（.env 只提供首次导入的初始值）
        configured.delete("huoshen");
        sync.sync();
        assertThat(registry.registeredProviderNames()).isEmpty();
        sync.sync();
        assertThat(registry.registeredProviderNames()).isEmpty();
    }

    @Test
    void aConfiguredProviderDisabledOnTheSettingsPageIsRemovedFromTheRegistry() {
        configured.save("huoshen", new ConfiguredProviderService.ConfiguredProviderInput(
                null, null, null, null, false));
        sync.sync();

        assertThat(registry.findProviderByName("huoshen")).isEmpty();
        assertThat(registry.supportsModel("gpt-6.2-sol")).isFalse();
    }

    @Test
    void aModelAddedToAConfiguredProviderOnTheSettingsPageGetsInferredCapabilities() {
        configured.save("huoshen", new ConfiguredProviderService.ConfiguredProviderInput(
                null, null, List.of("gpt-6.2-sol", "huoshen-new-model"), null, null));
        sync.sync();

        assertThat(registry.supportsModel("huoshen-new-model")).isTrue();
        assertThat(modelRegistry.findKnownCapabilities("huoshen-new-model")).isPresent();
        assertThat(modelRegistry.getCapabilities("huoshen-new-model").contextWindow())
                .isEqualTo(PoolModelCapabilities.GENERIC_CONTEXT_WINDOW);
    }

    @Test
    void registersPoolProvidersUnderTheDbPrefixAndOnlySkipsModelsClaimedElsewhere() {
        String key = addProvider("智谱", List.of("gpt-6.2-sol", "mystery-model", "glm-5.4"), "gpt-6.2-sol", null);

        var result = sync.sync();

        assertThat(result.providers()).hasSize(1);
        ProviderSync entry = result.providers().getFirst();
        assertThat(entry.registeredAs()).isEqualTo("db:" + key);
        // 不在内置能力表里的 mystery-model 也注册了：用户在设置页加了模型，就得真的能用
        assertThat(entry.registeredModels()).containsExactly("mystery-model", "glm-5.4");
        // 条目里填的默认模型被跳过了，退到第一个注册成功的模型
        assertThat(entry.defaultModel()).isEqualTo("mystery-model");
        assertThat(entry.skipReason()).isNull();
        assertThat(entry.needsAttention()).isFalse();
        assertThat(entry.skippedModels()).extracting(ModelSkip::model).containsExactly("gpt-6.2-sol");
        assertThat(entry.skippedModels().getFirst().reason()).contains("huoshen");
        assertThat(entry.inferredModels()).hasSize(1);
        assertThat(entry.inferredModels().getFirst().model()).isEqualTo("mystery-model");
        assertThat(entry.inferredModels().getFirst().basis()).startsWith("通用参数");
        assertThat(result.registeredModels()).containsExactly("mystery-model", "glm-5.4");

        // 配置里的 Provider 排在前面、原样不动；池里的追加在后面
        assertThat(registry.registeredProviderNames()).containsExactly("huoshen", "db:" + key);
        assertThat(registry.getProvider("mystery-model").getProviderName()).isEqualTo("db:" + key);
        assertThat(registry.getProvider("glm-5.4").getProviderName()).isEqualTo("db:" + key);
        assertThat(registry.getProvider("gpt-6.2-sol").getProviderName()).isEqualTo("huoshen");
        assertThat(registry.listAvailableModels()).contains("mystery-model", "glm-5.4");
        // 已登记的模型能力仍来自内置表；没登记的拿到推算出来的通用参数，而不是会让预算算成负数的保守默认值
        assertThat(modelRegistry.getCapabilities("glm-5.4").contextWindow()).isEqualTo(1048576);
        assertThat(modelRegistry.getCapabilities("mystery-model").contextWindow())
                .isEqualTo(PoolModelCapabilities.GENERIC_CONTEXT_WINDOW);
        assertThat(modelRegistry.getCapabilities("mystery-model").modelId()).isEqualTo("mystery-model");
        assertThat(modelRegistry.findKnownCapabilities("mystery-model")).isPresent();
        // "静态登记过"的判断不受影响：mystery-model 确实不在内置表里
        assertThat(modelRegistry.hasStaticCapabilities("mystery-model")).isFalse();
        assertThat(sync.last()).isSameAs(result);
    }

    @Test
    void anUnknownModelInheritsCapabilitiesFromTheClosestModelOfItsFamily() {
        addProvider("智谱", List.of("glm-5.9"), null, null);

        var result = sync.sync();

        // glm-5.9 不在内置表里，按最相近的 glm-5.4 登记，于是它收图，可以作为视觉兜底
        assertThat(result.inferredModels()).singleElement().satisfies(inferred -> {
            assertThat(inferred.model()).isEqualTo("glm-5.9");
            assertThat(inferred.basis()).isEqualTo("沿用 glm-5.4 的参数");
        });
        assertThat(modelRegistry.getCapabilities("glm-5.9").supportsImages()).isTrue();
        assertThat(modelRegistry.getCapabilities("glm-5.9").contextWindow()).isEqualTo(1048576);
        assertThat(modelRegistry.getCapabilities("glm-5.9").supportsToolUse()).isTrue();
        assertThat(modelRegistry.isKnownModel("glm-5.9")).isTrue();
    }

    @Test
    void inferredCapabilitiesGoAwayWhenTheProviderThatBroughtThemIsRemoved() {
        String key = addProvider("智谱", List.of("mystery-model", "glm-5.9"), null, null);
        sync.sync();
        assertThat(modelRegistry.findKnownCapabilities("glm-5.9")).isPresent();

        pool.update(key, new ProviderInput("智谱", "https://relay.example/v1", null, List.of("glm-5.9"), null, null));
        sync.sync();
        // 清单里删掉的模型，能力也跟着撤掉
        assertThat(modelRegistry.findKnownCapabilities("mystery-model")).isEmpty();
        assertThat(modelRegistry.getCapabilities("mystery-model")).isEqualTo(ModelCapabilities.DEFAULT);

        pool.delete(key);
        sync.sync();
        assertThat(modelRegistry.findKnownCapabilities("glm-5.9")).isEmpty();
        assertThat(modelRegistry.listAllModels()).noneMatch(capabilities -> capabilities.modelId().equals("glm-5.9"));
    }

    @Test
    void earlierPoolEntryKeepsTheModelAndLaterOnesAreSkippedWithTheOwner() {
        String first = addProvider("甲", List.of("glm-5.4", "glm-5.3"), null, null);
        String second = addProvider("乙", List.of("glm-5.4", "MiniMax-M3"), null, null);

        var result = byKey(sync.sync());

        assertThat(result.get(first).registeredModels()).containsExactly("glm-5.4", "glm-5.3");
        assertThat(result.get(second).registeredModels()).containsExactly("MiniMax-M3");
        assertThat(result.get(second).skippedModels()).singleElement().satisfies(skip -> {
            assertThat(skip.model()).isEqualTo("glm-5.4");
            assertThat(skip.reason()).contains("甲");
        });
        // 只是因为排在了后面，不算需要处理的问题
        assertThat(result.get(second).needsAttention()).isFalse();
        assertThat(registry.getProvider("glm-5.4").getProviderName()).isEqualTo("db:" + first);
        assertThat(registry.getProvider("MiniMax-M3").getProviderName()).isEqualTo("db:" + second);
    }

    @Test
    void disabledEntryIsSkippedEntirely() {
        String key = addProvider("停用的", List.of("glm-5.4"), null, false);

        var entry = byKey(sync.sync()).get(key);

        assertThat(entry.registeredAs()).isNull();
        assertThat(entry.registeredModels()).isEmpty();
        assertThat(entry.skippedModels()).isEmpty();
        assertThat(entry.skipReason()).isEqualTo("服务商已停用");
        assertThat(entry.needsAttention()).isFalse();
        assertThat(registry.findProviderByName("db:" + key)).isEmpty();
    }

    @Test
    void entryWhoseModelsAreAllProvidedElsewhereIsReportedAsNotNeeded() {
        String key = addProvider("重复的", List.of("gpt-6.2-sol", "gpt-6.1-sol"), null, null);

        var entry = byKey(sync.sync()).get(key);

        assertThat(entry.registeredAs()).isNull();
        assertThat(entry.skipReason()).isEqualTo("模型都已由其他服务商提供，无需重复注册");
        assertThat(entry.skippedModels()).hasSize(2);
        assertThat(entry.needsAttention()).isFalse();
    }

    @Test
    void resyncReplacesThePreviousPoolProviders() {
        String first = addProvider("甲", List.of("glm-5.4"), null, null);
        String second = addProvider("乙", List.of("glm-5.3"), null, null);
        sync.sync();
        assertThat(registry.registeredProviderNames())
                .containsExactly("huoshen", "db:" + first, "db:" + second);

        pool.delete(first);
        sync.sync();

        assertThat(registry.registeredProviderNames()).containsExactly("huoshen", "db:" + second);
        assertThat(registry.findProviderByName("db:" + first)).isEmpty();
        assertThatThrownBy(() -> registry.getProvider("glm-5.4"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(registry.getProvider("glm-5.3").getProviderName()).isEqualTo("db:" + second);
    }

    @Test
    void replaceDbProvidersRefusesToBreakTheRegistryInvariants() {
        assertThatThrownBy(() -> registry.replaceDbProviders(List.of(provider("naked", List.of("glm-5.4")))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("db:");
        // 与配置里的 Provider 争用同一个模型
        assertThatThrownBy(() -> registry.replaceDbProviders(List.of(provider("db:x", List.of("gpt-6.2-sol")))))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Ambiguous model route: gpt-6.2-sol");
        // 两个池 Provider 争用同一个模型
        assertThatThrownBy(() -> registry.replaceDbProviders(List.of(
                provider("db:x", List.of("glm-5.4")), provider("db:y", List.of("glm-5.4")))))
                .isInstanceOf(IllegalArgumentException.class);

        // 被拒绝之后注册表原样未动
        assertThat(registry.registeredProviderNames()).containsExactly("huoshen");
        assertThat(registry.modelOwnersOutsidePool()).containsEntry("gpt-6.2-sol", "huoshen");
    }

    @Test
    void poolProvidersDoNotCountAsConfiguredOwnersOnTheNextRound() {
        String first = addProvider("甲", List.of("glm-5.4"), null, null);
        sync.sync();

        // 第二轮：上一轮自己注册的 db: Provider 不能被当成"配置里的服务商"，否则改了名的同一个条目会被自己挡住
        assertThat(registry.modelOwnersOutsidePool()).doesNotContainKey("glm-5.4");
        pool.update(first, new ProviderInput("甲改名", "https://relay.example/v1", null, List.of("glm-5.4"), null, null));
        assertThat(byKey(sync.sync()).get(first).registeredModels()).containsExactly("glm-5.4");
        assertThat(registry.getProvider("glm-5.4").getProviderName()).isEqualTo("db:" + first);
    }

    @Test
    void staticCapabilityLookupIgnoresWhatTheRegistryCurrentlyServes() {
        assertThat(modelRegistry.hasStaticCapabilities("glm-5.4")).isTrue();
        assertThat(modelRegistry.hasStaticCapabilities("ollama/llama3")).isTrue();
        assertThat(modelRegistry.hasStaticCapabilities("mystery-model")).isFalse();
        assertThat(modelRegistry.hasStaticCapabilities(null)).isFalse();
        assertThat(modelRegistry.hasStaticCapabilities(" ")).isFalse();

        // 一个自报能力表的 Provider 可以让 isKnownModel 返回 true，哪怕内置表里没有这个模型。
        // 池同步要的是"内置表登记过"，所以不能拿 isKnownModel 当依据。
        LlmProvider vendor = mock(LlmProvider.class);
        when(vendor.getProviderName()).thenReturn("db:vendor");
        when(vendor.getSupportedModels()).thenReturn(List.of("vendor-only-model"));
        when(vendor.getModelCapabilities("vendor-only-model")).thenReturn(ModelCapabilities.DEFAULT);
        registry.replaceDbProviders(List.of(vendor));

        assertThat(modelRegistry.isKnownModel("vendor-only-model")).isTrue();
        assertThat(modelRegistry.hasStaticCapabilities("vendor-only-model")).isFalse();
        assertThat(modelRegistry.isKnownModel("mystery-model")).isFalse();
    }

    // ───── 辅助 ─────

    private String addProvider(String name, List<String> models, String defaultModel, Boolean enabled) {
        return pool.create(new ProviderInput(name, "https://relay.example/v1", "sk-pool-test-key-123456",
                models, defaultModel, enabled)).key();
    }

    private static Map<String, ProviderSync> byKey(DbProviderRegistrySync.SyncResult result) {
        return result.providers().stream()
                .collect(Collectors.toMap(ProviderSync::providerKey, Function.identity()));
    }

    private static OpenAiCompatibleProvider provider(String name, List<String> models) {
        return new OpenAiCompatibleProvider(name, new ObjectMapper(), httpProperties(),
                new ApiKeyRotationManager("sk-test"), "sk-test", "https://example.invalid/v1",
                models.getFirst(), models);
    }

    private static LlmHttpProperties httpProperties() {
        return new LlmHttpProperties(new LlmHttpProperties.PoolProperties(1, 5), 5, 5, false);
    }
}
