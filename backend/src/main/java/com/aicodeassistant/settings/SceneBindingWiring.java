package com.aicodeassistant.settings;

import com.aicodeassistant.llm.LlmProviderRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.stereotype.Component;

/**
 * 把场景分派接到只需要"模型 ID"的消费方上（主对话默认模型、后台小任务、子 Agent）。
 * <p>
 * 注册表在构造阶段不能依赖场景服务（场景服务依赖模型注册表，模型注册表又依赖它，会循环），
 * 所以等全部单例建好之后再把这个查询入口装上去。之前的调用都按"没绑定"处理，走配置文件里的默认值。
 */
@Component
public class SceneBindingWiring implements SmartInitializingSingleton {

    private static final Logger log = LoggerFactory.getLogger(SceneBindingWiring.class);

    private final LlmProviderRegistry registry;
    private final SceneBindingService sceneBindings;

    public SceneBindingWiring(LlmProviderRegistry registry, SceneBindingService sceneBindings) {
        this.registry = registry;
        this.sceneBindings = sceneBindings;
    }

    @Override
    public void afterSingletonsInstantiated() {
        registry.setSceneModelLookup(sceneBindings::supportedBoundModel);
        log.info("Scene bindings wired into the provider registry (default model / fast model / sub-agent)");
    }
}
