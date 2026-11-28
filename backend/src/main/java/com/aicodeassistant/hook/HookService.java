package com.aicodeassistant.hook;

import com.aicodeassistant.engine.SideQueryService;
import com.aicodeassistant.memdir.MemdirService;
import com.aicodeassistant.model.Message;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

/**
 * 钩子执行服务 — 统一的钩子触发和执行入口。
 * <p>
 * 从 HookRegistry 获取已注册钩子，按优先级排序，
 * 通过正则匹配器过滤后链式执行。
 * <p>
 * 钩子可以:
 * <ul>
 *     <li>修改工具输入 (PreToolUse)</li>
 *     <li>修改工具输出 (PostToolUse)</li>
 *     <li>拒绝操作 (返回 proceed=false)</li>
 *     <li>注入额外上下文 (UserPromptSubmit)</li>
 * </ul>
 *
 */
@Service
public class HookService {

    private static final Logger log = LoggerFactory.getLogger(HookService.class);

    private final HookRegistry hookRegistry;
    private final MemdirService memdirService;

    /** 可选的 fast 模型通道——用于把「请记住 X」提炼成一条干净记忆；不可用时回落原文 */
    @Autowired(required = false)
    private SideQueryService sideQueryService;

    /** 自动沉淀开关（默认开；@Value 仅在 Spring 环境覆盖，直接 new 的测试环境保持默认） */
    @Value("${app.memory.auto-capture:true}")
    private boolean autoCaptureEnabled = true;

    /**
     * 会话级配置快照 — 确保会话内钩子配置一致性 (§11.5.8)。
     * key=sessionId, value=会话开始时的钩子注册快照
     */
    private final ConcurrentHashMap<String, Map<HookEvent, List<HookRegistry.HookRegistration>>> sessionSnapshots
            = new ConcurrentHashMap<>();

    public HookService(HookRegistry hookRegistry, MemdirService memdirService) {
        this.hookRegistry = hookRegistry;
        this.memdirService = memdirService;
    }

    /**
     * 执行指定事件的所有匹配钩子。
     *
     * @param event   钩子事件类型
     * @param context 执行上下文
     * @return 执行结果（如果有钩子拒绝则 proceed=false）
     */
    public HookRegistry.HookResult execute(HookEvent event, HookRegistry.HookContext context) {
        return execute(event, context, java.util.EnumSet.allOf(HookRegistry.HookRole.class));
    }

    private HookRegistry.HookResult execute(HookEvent event, HookRegistry.HookContext context,
                                            java.util.Set<HookRegistry.HookRole> roles) {
        List<HookRegistry.HookRegistration> hooks = hookRegistry.getHooks(event);
        if (hooks.isEmpty()) {
            return HookRegistry.HookResult.passThrough();
        }

        log.debug("Executing {} hooks for event: {}", hooks.size(), event);

        HookRegistry.HookContext currentContext = context;

        for (HookRegistry.HookRegistration hook : hooks) {
            if (!roles.contains(hook.role())) continue;
            // 匹配器检查
            if (!matchesContext(hook.matcher(), currentContext)) {
                continue;
            }

            try {
                HookRegistry.HookResult result = hook.handler().apply(currentContext);

                if (hook.role() == HookRegistry.HookRole.SECURITY_CONSTRAINT
                        && (result.modifiedInput() != null || result.modifiedOutput() != null)) {
                    return HookRegistry.HookResult.deny("SECURITY_HOOK_ATTEMPTED_INPUT_MUTATION");
                }
                if (hook.role() == HookRegistry.HookRole.PRESENTATION
                        && event == HookEvent.PRE_TOOL_USE) {
                    return HookRegistry.HookResult.deny("PRESENTATION_HOOK_REGISTERED_PRE_EXECUTION");
                }

                if (!result.proceed()) {
                    log.info("Hook denied operation: event={}, source={}, role={}",
                            event, hook.source(), hook.role());
                    log.debug("Hook denial detail: event={}, source={}, reason={}",
                            event, hook.source(), result.message());
                    return result;
                }

                // 如果钩子修改了输入，更新上下文供后续钩子使用
                if (result.modifiedInput() != null) {
                    currentContext = new HookRegistry.HookContext(
                            currentContext.toolName(),
                            result.modifiedInput(),
                            currentContext.output(),
                            currentContext.sessionId(),
                            currentContext.metadata()
                    );
                }

                // 如果钩子修改了输出
                if (result.modifiedOutput() != null) {
                    currentContext = new HookRegistry.HookContext(
                            currentContext.toolName(),
                            currentContext.input(),
                            result.modifiedOutput(),
                            currentContext.sessionId(),
                            currentContext.metadata()
                    );
                }

            } catch (Exception e) {
                log.warn("Hook execution failed: event={}, source={}, role={}",
                        event, hook.source(), hook.role(), e);
                if (hook.role() != HookRegistry.HookRole.PRESENTATION
                        || event == HookEvent.PRE_TOOL_USE) {
                    return HookRegistry.HookResult.deny("HOOK_EXECUTION_FAILED");
                }
            }
        }

        // 所有钩子都通过，返回可能被修改的结果
        if (currentContext != context) {
            // 上下文被修改过
            if (currentContext.input() != null && !currentContext.input().equals(context.input())) {
                return HookRegistry.HookResult.modifyInput(currentContext.input());
            }
            if (currentContext.output() != null && !currentContext.output().equals(context.output())) {
                return HookRegistry.HookResult.modifyOutput(currentContext.output());
            }
        }

        return HookRegistry.HookResult.passThrough();
    }

    /**
     * 执行 PreToolUse 钩子。
     */
    public HookRegistry.HookResult executePreToolUse(String toolName, String toolInput, String sessionId) {
        return execute(HookEvent.PRE_TOOL_USE,
                HookRegistry.HookContext.forTool(toolName, toolInput, sessionId),
                java.util.EnumSet.of(HookRegistry.HookRole.INPUT_TRANSFORM));
    }

    /** 安全钩子只在不可变输入分析后运行，并且只能拒绝或收紧约束。 */
    public HookRegistry.HookResult executeSecurityConstraints(String toolName, String toolInput,
                                                              String sessionId,
                                                              Map<String, Object> authorizationFacts) {
        return execute(HookEvent.PRE_TOOL_USE,
                new HookRegistry.HookContext(toolName, toolInput, null, sessionId,
                        Map.copyOf(authorizationFacts)),
                java.util.EnumSet.of(HookRegistry.HookRole.SECURITY_CONSTRAINT));
    }

    /**
     * 执行 PostToolUse 钩子。
     */
    public HookRegistry.HookResult executePostToolUse(String toolName, String toolOutput, String sessionId) {
        return execute(HookEvent.POST_TOOL_USE,
                HookRegistry.HookContext.forToolOutput(toolName, toolOutput, sessionId),
                java.util.EnumSet.of(HookRegistry.HookRole.PRESENTATION));
    }

    /**
     * 执行 UserPromptSubmit 钩子。
     */
    public HookRegistry.HookResult executeUserPromptSubmit(String userInput, String sessionId) {
        return execute(HookEvent.USER_PROMPT_SUBMIT,
                HookRegistry.HookContext.forMessage(userInput, sessionId));
    }

    /**
     * 执行 Stop 钩子 — 返回 StopHookResult。
         */
    public HookRegistry.StopHookResult executeStopHooks(List<Message> messages, String sessionId) {
        List<HookRegistry.HookRegistration> hooks = hookRegistry.getHooks(HookEvent.STOP);
        if (hooks.isEmpty()) {
            return HookRegistry.StopHookResult.ok();
        }

        List<String> blockingErrors = new ArrayList<>();
        boolean preventContinuation = false;

        for (HookRegistry.HookRegistration hook : hooks) {
            try {
                HookRegistry.HookContext context = HookRegistry.HookContext.forMessage(
                        messages.isEmpty() ? "" : messages.getLast().toString(),
                        sessionId);
                HookRegistry.HookResult result = hook.handler().apply(context);

                if (!result.proceed()) {
                    if (result.message() != null && result.message().startsWith("[PREVENT]")) {
                        preventContinuation = true;
                    } else {
                        blockingErrors.add(result.message() != null
                                ? result.message() : "Stop hook blocked continuation");
                    }
                }
            } catch (Exception e) {
                log.warn("Stop hook execution failed: source={}, error={}",
                        hook.source(), e.getMessage());
            }
        }

        if (preventContinuation) {
            return HookRegistry.StopHookResult.preventContinuation(
                    blockingErrors.isEmpty() ? "Hook prevented continuation"
                            : String.join("; ", blockingErrors));
        }
        if (!blockingErrors.isEmpty()) {
            return HookRegistry.StopHookResult.blocking(blockingErrors);
        }
        return HookRegistry.StopHookResult.ok();
    }

    /**
     * 执行 SessionStart 钩子 — 会话创建时触发。
     */
    public void executeSessionStart(String sessionId) {
        execute(HookEvent.SESSION_START,
                new HookRegistry.HookContext(null, null, null, sessionId,
                        Map.of("timestamp", Instant.now().toString())));
    }

    /**
     * 执行 SessionEnd 钩子 — 会话删除时触发。
     */
    public void executeSessionEnd(String sessionId, Map<String, Object> stats) {
        execute(HookEvent.SESSION_END,
                new HookRegistry.HookContext(null, null, null, sessionId,
                        stats != null ? stats : Map.of()));
    }

    /**
     * 执行 Notification 钩子 — 系统通知事件。
     */
    public void executeNotification(String level, String message) {
        execute(HookEvent.NOTIFICATION,
                new HookRegistry.HookContext(null, null, null, null,
                        Map.of("level", level, "message", message)));
    }

    /**
     * 匹配器检查 — 使用正则表达式匹配工具名。
     */
    private boolean matchesContext(String matcher, HookRegistry.HookContext context) {
        if (matcher == null || matcher.isEmpty()) {
            return true;
        }
        String target = context.toolName();
        if (target == null || target.isEmpty()) {
            return true;
        }
        try {
            return Pattern.matches(matcher, target);
        } catch (Exception e) {
            log.warn("Invalid hook matcher pattern: {}", matcher);
            return false;
        }
    }

    // ============ 新增：TaskCompleted 和 PostStop 钩子 ============

    public void executeTaskCompletedHooks(String sessionId, String taskResult) {
        List<HookRegistry.HookRegistration> hooks = hookRegistry.getHooks(HookEvent.TASK_COMPLETED);
        for (HookRegistry.HookRegistration hook : hooks) {
            try {
                HookRegistry.HookContext context = HookRegistry.HookContext.forMessage(
                    taskResult, sessionId);
                hook.handler().apply(context);
            } catch (Exception e) {
                log.warn("TaskCompleted hook failed: {}", e.getMessage());
            }
        }
    }

    /**
     * 自动记忆沉淀 — 会话正常终止后调用（QueryEngine TERMINATE_SUCCESS 分支）。
     * <p>
     * 2026-11-28 重写：旧实现从<strong>助手回复</strong>里找触发词并存<strong>助手回复
     * 开头 200 字</strong>——用户说「请记住 X」，存进去的却是「好的，我已记住…」，
     * 方向完全反了。现在从<strong>用户消息</strong>里识别记忆指令（请记住 / remember
     * that / 备忘），提取指令之后的实际内容，经 fast 模型提炼成一条干净记忆
     * （LLM 不可用回落原文），异步写入 AUTO 记忆——绝不阻塞、绝不影响查询链路。
     */
    public void executePostStopActions(List<Message> messages, String sessionId) {
        if (!autoCaptureEnabled) return;
        String userText = extractLastUserText(messages);
        if (userText == null) return;
        String candidate = extractMemoryCandidate(userText);
        if (candidate == null) return;

        Thread.ofVirtual().name("memory-capture-" + sessionId).start(() -> {
            try {
                String content = refineWithSideQuery(sessionId, userText, candidate);
                memdirService.writeMemory(content, MemdirService.MemorySource.AUTO);
                log.info("Auto memory captured for session {}: {}", sessionId,
                        content.length() > 80 ? content.substring(0, 80) + "…" : content);
            } catch (Exception e) {
                log.warn("Auto memory capture failed for session {}: {}", sessionId, e.getMessage());
            }
        });
    }

    /** 触发词匹配的是用户消息，不是助手回复（旧实现的方向性错误） */
    private String extractLastUserText(List<Message> messages) {
        for (int i = messages.size() - 1; i >= 0; i--) {
            if (messages.get(i) instanceof Message.UserMessage um && um.content() != null) {
                for (var block : um.content()) {
                    if (block instanceof com.aicodeassistant.model.ContentBlock.TextBlock tb
                            && tb.text() != null && !tb.text().isBlank()) {
                        return tb.text();
                    }
                }
            }
        }
        return null;
    }

    /**
     * 从用户消息提取记忆候选：必须是明确的记忆指令（请记住 / remember that / 备忘），
     * 返回指令之后的实际内容；无触发词或内容过短返回 null。
     * 不匹配裸「记住」/「remember」——讨论「记住密码功能」这类实现话题不应误触发。
     */
    static String extractMemoryCandidate(String userText) {
        if (userText == null || userText.isBlank()) return null;
        String lower = userText.toLowerCase();
        String[] triggers = {"请记住", "记住一下", "remember that", "remember:", "备忘"};
        for (String trigger : triggers) {
            int idx = lower.indexOf(trigger);
            if (idx >= 0) {
                String candidate = userText.substring(idx + trigger.length()).trim();
                candidate = candidate.replaceFirst("^[：:，,。\\-—]+\\s*", "").trim();
                if (candidate.length() >= 4 && candidate.length() <= 500) {
                    return candidate;
                }
                return null;
            }
        }
        return null;
    }

    /**
     * fast 模型提炼（2.5 秒超时）——把用户原话整理成一条不含对话痕迹的记忆；
     * side query 不可用或失败时回落到原文（触发词之后的内容，足够可用）。
     */
    private String refineWithSideQuery(String sessionId, String userText, String fallback) {
        if (sideQueryService == null || !sideQueryService.isAvailable()) {
            return fallback;
        }
        try {
            String refined = sideQueryService.query(
                    "把用户的记忆指令整理成一条独立、自包含的持久记忆（第三人称，去掉「请记住」等指令"
                  + "痕迹与寒暄，保留关键事实与细节），只输出整理后的记忆正文，不要解释。",
                    "会话 " + sessionId + " 中用户说：" + userText,
                    128, 2_500L);
            return (refined == null || refined.isBlank()) ? fallback : refined.trim();
        } catch (Exception e) {
            return fallback;
        }
    }

    // ============ 会话级配置快照 (§11.5.8) ============

    /**
     * 为指定会话拍摄当前钩子配置快照。
     * 应在会话开始时调用，确保会话内钩子配置不变。
     *
     * @param sessionId 会话ID
     */
    public void snapshotConfig(String sessionId) {
        Map<HookEvent, List<HookRegistry.HookRegistration>> snapshot = new java.util.EnumMap<>(HookEvent.class);
        for (HookEvent event : HookEvent.values()) {
            List<HookRegistry.HookRegistration> hooks = hookRegistry.getHooks(event);
            if (!hooks.isEmpty()) {
                snapshot.put(event, List.copyOf(hooks));
            }
        }
        sessionSnapshots.put(sessionId, snapshot);
        log.debug("Hook config snapshot created for session: {}", sessionId);
    }

    /**
     * 获取会话级钩子快照 — 如果有快照则使用快照，否则回退到实时查询。
     *
     * @param sessionId 会话ID
     * @param event     钩子事件类型
     * @return 匹配的钩子列表
     */
    public List<HookRegistry.HookRegistration> getSessionHooks(String sessionId, HookEvent event) {
        Map<HookEvent, List<HookRegistry.HookRegistration>> snapshot = sessionSnapshots.get(sessionId);
        if (snapshot != null) {
            return snapshot.getOrDefault(event, List.of());
        }
        // 无快照时回退到实时查询
        return hookRegistry.getHooks(event);
    }

    /**
     * 释放会话快照 — 会话结束时调用。
     *
     * @param sessionId 会话ID
     */
    public void releaseSnapshot(String sessionId) {
        sessionSnapshots.remove(sessionId);
        log.debug("Hook config snapshot released for session: {}", sessionId);
    }
}
