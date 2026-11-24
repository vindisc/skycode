package com.aicodeassistant.controller;

import com.aicodeassistant.exception.RequestValidationException;
import com.aicodeassistant.exception.ResourceNotFoundException;
import com.aicodeassistant.session.MessageRecallService;
import com.aicodeassistant.session.SessionExecutionBusyException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 会话内单条消息的操作 — 消息气泡上的「撤回」按钮走这里，与 {@code /recall} 命令共用同一个服务。
 */
@RestController
@RequestMapping("/api/sessions")
public class SessionMessageController {

    private final MessageRecallService recallService;

    public SessionMessageController(MessageRecallService recallService) {
        this.recallService = recallService;
    }

    /**
     * 撤回一条消息。成功后服务端会广播 {@code message_recalled}，各端据此移除本地消息。
     */
    @DeleteMapping("/{sessionId}/messages/{messageId}")
    public ResponseEntity<Map<String, Object>> recallMessage(
            @PathVariable String sessionId,
            @PathVariable String messageId) {
        return switch (recallService.recall(sessionId, messageId)) {
            case RECALLED -> ResponseEntity.ok(Map.of("success", true, "messageId", messageId));
            case NOT_FOUND -> throw new ResourceNotFoundException("MESSAGE_NOT_FOUND",
                    "没有找到这条消息，它可能已经被删除。");
            case TOOL_TRANSACTION -> throw new RequestValidationException("MESSAGE_NOT_RECALLABLE",
                    "这条消息包含工具调用或工具结果，撤回会让对话里的工具调用配不上对，不能撤回。");
            case BUSY -> throw new SessionExecutionBusyException(sessionId);
        };
    }
}
