package com.aicodeassistant.session;

import com.aicodeassistant.model.ContentBlock;
import com.aicodeassistant.model.Message;
import com.aicodeassistant.service.MessageRepository;
import com.aicodeassistant.websocket.WebSocketController;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * 撤回单条已持久化的消息。
 * <p>
 * 典型用途：误贴了一张超大截图把上下文撑爆后，只撤回这一条，不必整个会话作废。
 * 删除后向所有绑定该会话的客户端广播 {@code message_recalled}，由各端各自移除本地消息。
 * 每次查询都会从数据库重新加载历史，服务端没有需要同步失效的历史缓存。
 */
@Service
public class MessageRecallService {

    private static final Logger log = LoggerFactory.getLogger(MessageRecallService.class);

    /** 服务端向客户端广播撤回事件时使用的消息类型。 */
    public static final String MESSAGE_RECALLED_EVENT = "message_recalled";

    public enum Outcome {
        /** 已删除并已广播。 */
        RECALLED,
        /** 该会话下没有这条消息。 */
        NOT_FOUND,
        /** 消息参与工具事务，撤回会留下配不上对的工具调用或结果。 */
        TOOL_TRANSACTION,
        /** 会话正在执行，不能改动历史。 */
        BUSY
    }

    private final SessionManager sessionManager;
    private final MessageRepository messageRepository;
    private final SessionExecutionGate executionGate;
    private final WebSocketController webSocketController;

    public MessageRecallService(SessionManager sessionManager,
                                MessageRepository messageRepository,
                                SessionExecutionGate executionGate,
                                @Lazy WebSocketController webSocketController) {
        this.sessionManager = sessionManager;
        this.messageRepository = messageRepository;
        this.executionGate = executionGate;
        this.webSocketController = webSocketController;
    }

    public Outcome recall(String sessionId, String messageId) {
        if (sessionId == null || sessionId.isBlank() || messageId == null || messageId.isBlank()) {
            return Outcome.NOT_FOUND;
        }
        // 必须先拿前台独占令牌：SessionManager 内部写入用的后台租约不与正在执行的查询互斥。
        SessionExecutionGate.Token token = executionGate.tryAcquire(
                sessionManager.dataSourceIdentity(), sessionId);
        if (token == null) return Outcome.BUSY;
        try (token) {
            Message target = sessionManager.loadSession(sessionId)
                    .map(SessionData::messages).orElse(List.<Message>of()).stream()
                    .filter(message -> Objects.equals(message.uuid(), messageId))
                    .findFirst().orElse(null);
            if (target == null) return Outcome.NOT_FOUND;
            if (isToolTransaction(target)) return Outcome.TOOL_TRANSACTION;
            if (messageRepository.deleteByIdAndSession(sessionId, messageId) == 0) return Outcome.NOT_FOUND;
            log.info("Message recalled: sessionId={}, messageId={}", sessionId, messageId);
            // 走 /user/queue/messages：前端只订阅这个通道，发到 /topic/session/{id} 它收不到。
            webSocketController.pushToUser(sessionId, MESSAGE_RECALLED_EVENT, Map.of("messageId", messageId));
            return Outcome.RECALLED;
        }
    }

    /**
     * 这条消息是否参与工具事务（含工具调用块、工具结果块，或旧式的 toolUseResult 载体）。
     * <p>
     * 这类消息不能撤回：删掉一侧会留下配不上对的另一半——界面上那张工具卡片会永远显示
     * 运行中，更严重的是下次请求会带上没有对应 tool_call 的 tool_result（或反过来），
     * 被模型接口直接拒绝，等于又把会话弄坏一次。
     */
    static boolean isToolTransaction(Message message) {
        List<ContentBlock> content = switch (message) {
            case Message.UserMessage user -> user.content() == null ? List.of() : user.content();
            case Message.AssistantMessage assistant -> assistant.content() == null ? List.of() : assistant.content();
            case Message.SystemMessage ignored -> List.of();
        };
        boolean toolBlocks = content.stream().anyMatch(block ->
                block instanceof ContentBlock.ToolUseBlock || block instanceof ContentBlock.ToolResultBlock);
        boolean legacyResult = message instanceof Message.UserMessage user && user.toolUseResult() != null;
        return toolBlocks || legacyResult;
    }
}
