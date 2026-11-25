package com.aicodeassistant.controller;

import com.aicodeassistant.engine.ContextCompactor;
import com.aicodeassistant.llm.DbProviderRegistrySync;
import com.aicodeassistant.llm.LlmProviderRegistry;
import com.aicodeassistant.llm.ModelScenes;
import com.aicodeassistant.prompt.optimize.ExternalLlmClient;
import com.aicodeassistant.service.PythonCapabilityAwareClient;
import com.aicodeassistant.service.PythonCapabilityAwareClient.CapabilityStatus;
import com.aicodeassistant.service.PythonProcessManager;
import com.aicodeassistant.settings.SceneBindingService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Comparator;
import java.util.List;
import java.util.Map;

/**
 * 设置页「运行状态」的接口：把散在各处的运行时事实集中成一屏只读信息——
 * Python 服务起没起来、各条管线此刻实际在用哪个模型、哪些服务商注册上了。
 * 让人不用翻日志和 .env 就能判断"配置到底生效了没有"。
 */
@RestController
@RequestMapping("/api/settings/runtime")
public class RuntimeStatusController {

    /** @param source 模型的来源：{@code scene_binding:<服务商>} 表示设置页里分派的，{@code config} 表示配置文件里的 */
    public record ModelStatus(String model, String source) {}

    /**
     * @param key   能力域代码（CODE_INTEL、GIT_ENHANCED……）
     * @param name  Python 服务给的显示名
     */
    public record CapabilityView(String key, String name, boolean available, String reason) {}

    /** 能力域的固定展示顺序；没见过的排在最后。 */
    private static final List<String> CAPABILITY_ORDER = List.of("CODE_INTEL", "FILE_PROCESSING", "GIT_ENHANCED",
            "BROWSER_AUTOMATION", "CODE_QUALITY", "ANALYSIS", "HTTP_API");

    /**
     * @param running 进程在跑；{@code healthy} 是接口能通。两个都为真才算 Python 能力真的可用。
     */
    public record PythonStatus(boolean autoStart, boolean running, boolean healthy, String state,
                               Integer restartCount, String lastHealthCheck, String serviceUrl,
                               List<CapabilityView> capabilities, String hint) {}

    public record RuntimeStatus(
            PythonStatus python,
            ModelStatus defaultModel,
            ModelStatus fastModel,
            ModelStatus subAgentModel,
            ModelStatus visionFallbackModel,
            ModelStatus promptOptimizeModel,
            ContextCompactor.SummaryStatus summary,
            List<String> configuredProviders,
            List<String> poolProviders) {}

    private final PythonCapabilityAwareClient pythonClient;
    private final PythonProcessManager pythonProcess;
    private final boolean pythonAutoStart;
    /** 没有场景绑定时各条管线实际回落到的值。 */
    private final LlmProviderRegistry registry;
    private final SceneBindingService sceneBindings;
    private final ContextCompactor compactor;
    private final ExternalLlmClient promptOptimize;
    private final String configuredVisionFallback;

    public RuntimeStatusController(PythonCapabilityAwareClient pythonClient,
                                   PythonProcessManager pythonProcess,
                                   @Value("${python.service.auto-start:false}") boolean pythonAutoStart,
                                   LlmProviderRegistry registry,
                                   SceneBindingService sceneBindings,
                                   ContextCompactor compactor,
                                   ExternalLlmClient promptOptimize,
                                   @Value("${app.model.vision-fallback:}") String configuredVisionFallback) {
        this.pythonClient = pythonClient;
        this.pythonProcess = pythonProcess;
        this.pythonAutoStart = pythonAutoStart;
        this.registry = registry;
        this.sceneBindings = sceneBindings;
        this.compactor = compactor;
        this.promptOptimize = promptOptimize;
        this.configuredVisionFallback = configuredVisionFallback;
    }

    @GetMapping
    public RuntimeStatus runtime() {
        // 缓存可能还没刷新过（Python 服务是启动后才拉起的）：先按过期策略刷一次再读
        pythonClient.refreshIfStale();
        List<CapabilityView> capabilities = pythonClient.getCapabilities().entrySet().stream()
                .sorted(Comparator.comparingInt((Map.Entry<String, CapabilityStatus> entry) -> capabilityRank(entry.getKey()))
                        .thenComparing(Map.Entry::getKey))
                .map(entry -> new CapabilityView(entry.getKey(), entry.getValue().name(),
                        entry.getValue().isAvailable(), entry.getValue().reason()))
                .toList();
        boolean running = pythonProcess.isRunning();
        boolean healthy = running && pythonClient.isHealthy();
        String hint = healthy ? null
                : !pythonAutoStart ? "没有开启自动启动（PYTHON_SERVICE_AUTO_START）。"
                : pythonProcess.getState() == PythonProcessManager.ProcessState.STARTING ? "进程正在启动，几秒后再看。"
                : "进程没有在运行。看容器日志里的 PythonProcessManager / PythonCapabilityAwareClient 输出。";
        PythonStatus python = new PythonStatus(pythonAutoStart, running, healthy,
                pythonProcess.getState().name(), pythonProcess.getRestartCount(),
                String.valueOf(pythonProcess.getLastHealthCheck()), pythonProcess.getServiceUrl(),
                capabilities, hint);

        List<String> configured = registry.registeredProviderNames().stream()
                .filter(name -> !LlmProviderRegistry.isPoolProviderName(name))
                .toList();
        List<String> pool = registry.registeredProviderNames().stream()
                .filter(LlmProviderRegistry::isPoolProviderName)
                .toList();
        return new RuntimeStatus(python,
                boundOr(ModelScenes.MAIN_DEFAULT, new ModelStatus(registry.getDefaultModel(), "config")),
                boundOr(ModelScenes.FAST, new ModelStatus(registry.getFastModel(), "config")),
                // 子 Agent 没绑定时跟随主对话的模型
                boundOr(ModelScenes.SUB_AGENT, new ModelStatus(registry.getDefaultModel(), "inherit")),
                boundOr(ModelScenes.VISION_FALLBACK, new ModelStatus(configuredVisionFallback, "config")),
                boundOr(ModelScenes.PROMPT_OPTIMIZE, promptOptimize.resolveEndpoint()
                        .map(endpoint -> new ModelStatus(endpoint.model(), endpoint.source()))
                        .orElse(new ModelStatus(null, null))),
                compactor.summaryStatus(), configured, pool);
    }

    /** 有场景绑定就用绑定的（并标明是哪个服务商）；没有、或绑定的模型此刻没有服务商提供，就用回落值。 */
    private ModelStatus boundOr(String scene, ModelStatus fallback) {
        SceneBindingService.Resolved bound = sceneBindings.resolve(scene).orElse(null);
        return bound != null && registry.supportsModel(bound.modelId())
                ? new ModelStatus(bound.modelId(), "scene_binding:" + bound.providerName())
                : fallback;
    }

    private static int capabilityRank(String key) {
        int index = CAPABILITY_ORDER.indexOf(key);
        return index < 0 ? CAPABILITY_ORDER.size() : index;
    }
}
