package com.aicodeassistant.controller;

import com.aicodeassistant.exception.RequestValidationException;
import com.aicodeassistant.llm.DbProviderRegistrySync;
import com.aicodeassistant.prompt.optimize.ExternalLlmClient;
import com.aicodeassistant.settings.LlmProviderSettingsService;
import com.aicodeassistant.settings.LlmProviderSettingsService.ProviderInput;
import com.aicodeassistant.settings.LlmProviderSettingsService.ProviderView;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 设置页「模型服务商」的接口：管理服务商池（增删改查、连通性测试、从库重新加载）。
 * <p>
 * 每次改动之后都会把池同步到运行时注册表，并把同步结果一并返回，界面据此显示
 * 哪些服务商和模型真正注册上了、没注册的原因是什么。接口只下发打码后的密钥。
 */
@RestController
@RequestMapping("/api/settings/llm-providers")
public class LlmProviderSettingsController {

    public record ProviderListResponse(
            List<ProviderView> providers,
            boolean apiKeyStorageReady,
            List<DbProviderRegistrySync.ProviderSync> routing) {}

    public record ProviderResponse(
            ProviderView provider,
            List<DbProviderRegistrySync.ProviderSync> routing) {}

    public record RoutingResponse(List<DbProviderRegistrySync.ProviderSync> routing) {}

    /** error 为 null 表示连通。 */
    public record TestResponse(boolean ok, String model, long latencyMs, String error) {}

    /** 连通性测试的入参，可为空；model 留空表示测该服务商的默认模型。 */
    public record TestRequest(String model) {}

    private final LlmProviderSettingsService pool;
    private final DbProviderRegistrySync sync;
    private final ExternalLlmClient externalLlmClient;

    public LlmProviderSettingsController(LlmProviderSettingsService pool,
                                         DbProviderRegistrySync sync,
                                         ExternalLlmClient externalLlmClient) {
        this.pool = pool;
        this.sync = sync;
        this.externalLlmClient = externalLlmClient;
    }

    @GetMapping
    public ProviderListResponse list() {
        return new ProviderListResponse(pool.list(), pool.encryptionKeyIsStable(), routing());
    }

    @PostMapping
    public ProviderResponse create(@RequestBody ProviderInput request) {
        var created = pool.create(request);
        var result = sync.sync();
        return new ProviderResponse(view(created.key()), result.providers());
    }

    @PutMapping("/{key}")
    public ProviderResponse update(@PathVariable String key, @RequestBody ProviderInput request) {
        var updated = pool.update(key, request);
        var result = sync.sync();
        return new ProviderResponse(view(updated.key()), result.providers());
    }

    @DeleteMapping("/{key}")
    public ResponseEntity<Void> delete(@PathVariable String key) {
        pool.delete(key);
        sync.sync();
        return ResponseEntity.noContent().build();
    }

    /** 丢弃缓存、从库重新读取，再同步一次。用于库被本进程以外的途径改过的场合。 */
    @PostMapping("/reload")
    public ProviderListResponse reload() {
        pool.reload();
        sync.sync();
        return list();
    }

    @GetMapping("/routing")
    public RoutingResponse routingOnly() {
        return new RoutingResponse(routing());
    }

    /**
     * 连通性测试：用保存好的配置向该服务商的模型发一次最小对话请求。
     *
     * @param model 要测的模型；不传则用该服务商的默认模型
     */
    @PostMapping("/{key}/test")
    public TestResponse test(@PathVariable String key,
                             @RequestBody(required = false) TestRequest request) {
        var entry = pool.getAllProviderEntries().stream()
                .filter(e -> e.key().equals(key))
                .findFirst()
                .orElseThrow(() -> new RequestValidationException("PROVIDER_NOT_FOUND", "服务商不存在：" + key));
        var config = entry.config();
        String model = request == null || request.model() == null || request.model().isBlank()
                ? config.defaultModel() : request.model().trim();
        if (!config.models().contains(model)) {
            throw new RequestValidationException("INVALID_PROVIDER",
                    "模型 " + model + " 不属于服务商 " + config.name());
        }
        var endpoint = new ExternalLlmClient.Endpoint("pool", config.name(), config.baseUrl(),
                config.apiKey(), model);
        try {
            long latencyMs = externalLlmClient.probe(endpoint);
            return new TestResponse(true, model, latencyMs, null);
        } catch (RuntimeException failure) {
            return new TestResponse(false, model, 0, failure.getMessage());
        }
    }

    private ProviderView view(String key) {
        return pool.list().stream()
                .filter(p -> p.key().equals(key))
                .findFirst()
                .orElseThrow(() -> new IllegalStateException("Provider vanished right after being saved: " + key));
    }

    private List<DbProviderRegistrySync.ProviderSync> routing() {
        var last = sync.last();
        return last == null ? List.of() : last.providers();
    }
}
