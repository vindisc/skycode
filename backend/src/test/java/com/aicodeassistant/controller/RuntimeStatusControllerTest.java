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
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * /api/settings/runtime — 运行状态页的数据：每条管线此刻实际在用哪个模型、Python 服务起没起来。
 */
class RuntimeStatusControllerTest {

    private final PythonCapabilityAwareClient pythonClient = mock(PythonCapabilityAwareClient.class);
    private final PythonProcessManager pythonProcess = mock(PythonProcessManager.class);
    private final LlmProviderRegistry registry = mock(LlmProviderRegistry.class);
    private final SceneBindingService sceneBindings = mock(SceneBindingService.class);
    private final ContextCompactor compactor = mock(ContextCompactor.class);
    private final ExternalLlmClient promptOptimize = mock(ExternalLlmClient.class);

    @BeforeEach
    void setUp() {
        when(pythonProcess.getState()).thenReturn(PythonProcessManager.ProcessState.STOPPED);
        when(registry.getDefaultModel()).thenReturn("gpt-6.2-sol");
        when(registry.getFastModel()).thenReturn("gpt-6-sol");
        when(registry.registeredProviderNames()).thenReturn(List.of("deepseek", "zhipu", "db:pool"));
        when(compactor.summaryStatus()).thenReturn(new ContextCompactor.SummaryStatus(true, "deepseek", "deepseek-flash",
                "deepseek-flash", "config", null));
        when(promptOptimize.resolveEndpoint()).thenReturn(Optional.of(new ExternalLlmClient.Endpoint(
                ExternalLlmClient.SOURCE_ENV, "环境变量", "https://relay.example/v1", "k", "gpt-6.1-sol")));
    }

    @Test
    void pythonIsReportedHealthyOnlyWhenTheProcessRunsAndTheApiAnswers() {
        when(pythonProcess.isRunning()).thenReturn(true);
        when(pythonProcess.getState()).thenReturn(PythonProcessManager.ProcessState.RUNNING);
        when(pythonClient.isHealthy()).thenReturn(true);
        when(pythonClient.getCapabilities()).thenReturn(new LinkedHashMap<>(Map.of(
                "CODE_INTEL", new CapabilityStatus("CODE_INTEL", true, null),
                "FILE_PROCESSING", new CapabilityStatus("FILE_PROCESSING", false, "import failed"))));
        var controller = new RuntimeStatusController(pythonClient, pythonProcess, true, registry, sceneBindings,
                compactor, promptOptimize, "gpt-6.1-sol");

        var status = controller.runtime();

        assertThat(status.python().healthy()).isTrue();
        assertThat(status.python().hint()).isNull();
        assertThat(status.python().capabilities()).hasSize(2);
        assertThat(status.python().capabilities().get(1).key()).isEqualTo("FILE_PROCESSING");
        assertThat(status.python().capabilities().get(1).name()).isEqualTo("FILE_PROCESSING");
        assertThat(status.python().capabilities().get(1).available()).isFalse();
    }

    @Test
    void capabilitiesKeepAStableOrderAndUnknownOnesGoLast() {
        when(pythonClient.getCapabilities()).thenReturn(new LinkedHashMap<>(Map.of(
                "HTTP_API", new CapabilityStatus("HTTP API Verification", true, null),
                "BROWSER_AUTOMATION", new CapabilityStatus("浏览器自动化", true, null),
                "NEW_DOMAIN", new CapabilityStatus("新能力", true, null),
                "CODE_INTEL", new CapabilityStatus("代码智能", true, null))));
        var controller = new RuntimeStatusController(pythonClient, pythonProcess, true, registry, sceneBindings,
                compactor, promptOptimize, "gpt-6.1-sol");

        assertThat(controller.runtime().python().capabilities())
                .extracting(RuntimeStatusController.CapabilityView::key)
                .containsExactly("CODE_INTEL", "BROWSER_AUTOMATION", "HTTP_API", "NEW_DOMAIN");
    }

    @Test
    void pythonProblemsComeWithAHintThatSaysWhatToDo() {
        when(pythonProcess.isRunning()).thenReturn(false);
        when(pythonProcess.getState()).thenReturn(PythonProcessManager.ProcessState.STOPPED);
        var off = new RuntimeStatusController(pythonClient, pythonProcess, false, registry, sceneBindings,
                compactor, promptOptimize, "gpt-6.1-sol");
        assertThat(off.runtime().python().hint()).contains("PYTHON_SERVICE_AUTO_START");

        var starting = new RuntimeStatusController(pythonClient, pythonProcess, true, registry, sceneBindings,
                compactor, promptOptimize, "gpt-6.1-sol");
        when(pythonProcess.getState()).thenReturn(PythonProcessManager.ProcessState.STARTING);
        assertThat(starting.runtime().python().hint()).contains("正在启动");

        when(pythonProcess.getState()).thenReturn(PythonProcessManager.ProcessState.FAILED);
        assertThat(starting.runtime().python().hint()).contains("日志");
    }

    @Test
    void everyPipelineReportsItsModelAndWhetherItComesFromASceneBinding() {
        var controller = new RuntimeStatusController(pythonClient, pythonProcess, false, registry, sceneBindings,
                compactor, promptOptimize, "gpt-6.1-sol");
        // 只有「主对话默认模型」被分派了
        when(sceneBindings.resolve(ModelScenes.MAIN_DEFAULT)).thenReturn(Optional.of(new SceneBindingService.Resolved(
                ModelScenes.MAIN_DEFAULT, SceneBindingService.SOURCE_CONFIGURED, "zhipu", "智谱", "zhipu",
                "https://open.bigmodel.cn/api/paas/v4", "k", "glm-5.4")));
        when(registry.supportsModel("glm-5.4")).thenReturn(true);

        var status = controller.runtime();

        assertThat(status.defaultModel()).isEqualTo(new RuntimeStatusController.ModelStatus("glm-5.4", "scene_binding:智谱"));
        assertThat(status.fastModel()).isEqualTo(new RuntimeStatusController.ModelStatus("gpt-6-sol", "config"));
        assertThat(status.subAgentModel()).isEqualTo(new RuntimeStatusController.ModelStatus("gpt-6.2-sol", "inherit"));
        assertThat(status.visionFallbackModel()).isEqualTo(new RuntimeStatusController.ModelStatus("gpt-6.1-sol", "config"));
        assertThat(status.promptOptimizeModel()).isEqualTo(new RuntimeStatusController.ModelStatus("gpt-6.1-sol", "env"));
        assertThat(status.summary().model()).isEqualTo("deepseek-flash");
        assertThat(status.summary().unavailable()).isNull();
        assertThat(status.configuredProviders()).containsExactly("deepseek", "zhipu");
        assertThat(status.poolProviders()).containsExactly("db:pool");
    }

    @Test
    void aPipelineWithoutAnyWorkingModelIsReportedAsSuch() {
        when(promptOptimize.resolveEndpoint()).thenReturn(Optional.empty());
        var controller = new RuntimeStatusController(pythonClient, pythonProcess, false, registry, sceneBindings,
                compactor, promptOptimize, "gpt-6.1-sol");

        var status = controller.runtime();

        assertThat(status.promptOptimizeModel().model()).isNull();
        assertThat(status.promptOptimizeModel().source()).isNull();
    }

    @Test
    void aBindingWhoseModelNoProviderServesIsReportedAsTheFallback() {
        // 服务商被停用后绑定还在，但模型已经没有服务商提供：运行状态要如实显示回落值，而不是一个调不动的模型
        when(sceneBindings.resolve(ModelScenes.FAST)).thenReturn(Optional.of(new SceneBindingService.Resolved(
                ModelScenes.FAST, SceneBindingService.SOURCE_CONFIGURED, "zhipu", "智谱", "zhipu",
                "https://open.bigmodel.cn/api/paas/v4", "k", "glm-5.4")));
        var controller = new RuntimeStatusController(pythonClient, pythonProcess, false, registry, sceneBindings,
                compactor, promptOptimize, "gpt-6.1-sol");

        assertThat(controller.runtime().fastModel()).isEqualTo(new RuntimeStatusController.ModelStatus("gpt-6-sol", "config"));
    }
}
