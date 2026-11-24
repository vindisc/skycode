package com.aicodeassistant.command.impl;

import com.aicodeassistant.command.Command;
import com.aicodeassistant.command.CommandContext;
import com.aicodeassistant.command.CommandResult;
import com.aicodeassistant.command.CommandType;
import com.aicodeassistant.session.MessageRecallService;
import org.springframework.stereotype.Component;

/**
 * /recall &lt;messageId&gt; — 撤回单条消息。
 * <p>
 * 成功时不返回文本：界面更新由服务端广播的 {@code message_recalled} 事件驱动，
 * 这里若返回文本会在聊天里多插一条系统消息。
 */
@Component
public class RecallCommandHandler implements Command {

    private final MessageRecallService recallService;

    public RecallCommandHandler(MessageRecallService recallService) {
        this.recallService = recallService;
    }

    @Override public String getName() { return "recall"; }
    @Override public String getDescription() { return "撤回单条消息：/recall <消息ID>（不含工具调用的消息）"; }
    @Override public CommandType getType() { return CommandType.LOCAL; }

    @Override
    public CommandResult execute(String args, CommandContext context) {
        String sessionId = context.sessionId();
        if (sessionId == null || sessionId.isBlank()) {
            return CommandResult.error("当前没有活动的会话。");
        }
        String messageId = args == null ? "" : args.trim();
        if (messageId.isEmpty()) {
            return CommandResult.error("用法：/recall <消息ID> — 请指定要撤回的消息 ID。");
        }
        return switch (recallService.recall(sessionId, messageId)) {
            case RECALLED -> CommandResult.skip();
            case NOT_FOUND -> CommandResult.error("没有找到这条消息，它可能已经被删除。");
            case TOOL_TRANSACTION -> CommandResult.error(
                    "这条消息包含工具调用或工具结果，撤回会让对话里的工具调用配不上对，不能撤回。");
            case BUSY -> CommandResult.error("会话正在执行，暂时不能撤回消息。");
        };
    }
}
