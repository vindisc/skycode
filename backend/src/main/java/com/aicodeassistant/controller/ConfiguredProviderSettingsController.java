package com.aicodeassistant.controller;

import com.aicodeassistant.exception.RequestValidationException;
import com.aicodeassistant.llm.DbProviderRegistrySync;
import com.aicodeassistant.llm.LlmProviderRegistry;
import com.aicodeassistant.llm.ProviderModelDiscovery;
import com.aicodeassistant.prompt.optimize.ExternalLlmClient;
import com.aicodeassistant.settings.ConfiguredProviderService;
import com.aicodeassistant.settings.ConfiguredProviderService.ConfiguredProviderInput;
import com.aicodeassistant.settings.ConfiguredProviderService.ConfiguredProviderView;
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
 * 设置页里带注册名的那批服务商的接口：查看、修改、删除、连通性测试、从接口获取模型清单。
 * <p>
 * 定义存在库里，页面是唯一来源（第一次启动时从 .env 一次性导入过一次）。响应只下发打码后的密钥。
 */
@RestController
@RequestMapping("/api/settings/configured-providers")
public class ConfiguredProviderSettingsController {

    /** 改动之后把池的同步结果一并带回去：配置里的服务商变了，池里哪些模型被占用也会跟着变。 */
    public record ConfiguredProviderResponse(
            ConfiguredProviderView provider,
            List<DbProviderRegistrySync.ProviderSync> routing) {}

    public record DiscoverRequest(String name) {}

    private final ConfiguredProviderService configured;
    private final DbProviderRegistrySync sync;
    private final LlmProviderRegistry registry;
    private final ExternalLlmClient externalLlmClient;
    private final ProviderModelDiscovery discovery;

    public ConfiguredProviderSettingsController(ConfiguredProviderService configured,
                                                DbProviderRegistrySync sync,
                                                LlmProviderRegistry registry,
                                                ExternalLlmClient externalLlmClient,
                                                ProviderModelDiscovery discovery) {
        this.configured = configured;
        this.sync = sync;
        this.registry = registry;
        this.externalLlmClient = externalLlmClient;
        this.discovery = discovery;
    }

    @GetMapping
    public List<ConfiguredProviderView> list() {
        configured.seedIfNeeded();
        return configured.views(this::isActive);
    }

    @PutMapping("/{name}")
    public ConfiguredProviderResponse save(@PathVariable String name,
                                           @RequestBody ConfiguredProviderInput input) {
        configured.save(name, input);
        var result = sync.sync();
        return new ConfiguredProviderResponse(view(name), result.providers());
    }

    /** 删掉这个服务商。删了就是删了：模型从选择器消失，指向它的场景分派会失效。 */
    @DeleteMapping("/{name}")
    public ResponseEntity<Void> delete(@PathVariable String name) {
        if (!configured.delete(name)) {
            throw new RequestValidationException("PROVIDER_NOT_FOUND", "没有这个服务商：" + name);
        }
        sync.sync();
        return ResponseEntity.noContent().build();
    }

    /**
     * 连通性测试：按此刻生效的配置（配置文件叠加设置页里的修改）向该服务商发一次最小对话请求。
     * model 留空表示测它的默认模型。
     */
    @PostMapping("/{name}/test")
    public LlmProviderSettingsController.TestResponse test(
            @PathVariable String name,
            @RequestBody(required = false) LlmProviderSettingsController.TestRequest request) {
        var effective = configured.effective(name)
                .orElseThrow(() -> new RequestValidationException("PROVIDER_NOT_FOUND", "配置里没有这个服务商：" + name));
        String model = request == null || request.model() == null || request.model().isBlank()
                ? effective.defaultModel() : request.model().trim();
        if (model == null || effective.models() == null || !effective.models().contains(model)) {
            throw new RequestValidationException("INVALID_PROVIDER",
                    "模型 " + model + " 不在 " + effective.displayName() + " 的模型清单里");
        }
        var endpoint = new ExternalLlmClient.Endpoint("configured", effective.displayName(),
                effective.baseUrl(), effective.apiKey(), model);
        try {
            long latencyMs = externalLlmClient.probe(endpoint);
            return new LlmProviderSettingsController.TestResponse(true, model, latencyMs, null);
        } catch (RuntimeException failure) {
            return new LlmProviderSettingsController.TestResponse(false, model, 0, failure.getMessage());
        }
    }

    /** 从接口获取模型清单，用此刻生效的地址和密钥。只读，不保存。 */
    @PostMapping("/discover")
    public LlmProviderSettingsController.DiscoverResponse discover(@RequestBody DiscoverRequest request) {
        var effective = request == null ? null : configured.effective(request.name()).orElse(null);
        if (effective == null) {
            throw new RequestValidationException("PROVIDER_NOT_FOUND", "配置里没有这个服务商");
        }
        return new LlmProviderSettingsController.DiscoverResponse(
                discovery.listModels(effective.baseUrl(), effective.apiKey()));
    }

    private boolean isActive(String name) {
        return registry.findProviderByName(name).isPresent() && !LlmProviderRegistry.isPoolProviderName(name);
    }

    private ConfiguredProviderView view(String name) {
        return configured.views(this::isActive).stream()
                .filter(view -> view.name().equals(name))
                .findFirst()
                .orElseThrow(() -> new IllegalStateException("Configured provider vanished: " + name));
    }
}
