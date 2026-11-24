package com.aicodeassistant.command.impl;

import com.aicodeassistant.command.CommandContext;
import com.aicodeassistant.command.CommandResult;
import com.aicodeassistant.state.AppState;
import com.aicodeassistant.session.MessageRecallService;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * /recall — 把服务结果映射为命令结果；成功时不产生文本，界面更新靠广播事件。
 */
class RecallCommandHandlerTest {

    private final MessageRecallService service = mock(MessageRecallService.class);
    private final RecallCommandHandler handler = new RecallCommandHandler(service);
    private final CommandContext context = CommandContext.of("s1", "/tmp", "test-model", AppState.defaultState());

    @Test
    void successReturnsSkipSoNoSystemMessageIsInserted() {
        when(service.recall("s1", "m1")).thenReturn(MessageRecallService.Outcome.RECALLED);

        CommandResult result = handler.execute("  m1  ", context);

        assertThat(result.type()).isEqualTo(CommandResult.ResultType.SKIP);
    }

    @Test
    void missingIdReportsUsage() {
        CommandResult result = handler.execute("   ", context);

        assertThat(result.type()).isEqualTo(CommandResult.ResultType.ERROR);
        assertThat(result.error()).contains("/recall");
        verifyNoInteractions(service);
    }

    @Test
    void outcomesAreExplainedToTheUser() {
        when(service.recall("s1", "missing")).thenReturn(MessageRecallService.Outcome.NOT_FOUND);
        when(service.recall("s1", "tool")).thenReturn(MessageRecallService.Outcome.TOOL_TRANSACTION);
        when(service.recall("s1", "busy")).thenReturn(MessageRecallService.Outcome.BUSY);

        assertThat(handler.execute("missing", context).error()).contains("没有找到");
        assertThat(handler.execute("tool", context).error()).contains("工具调用");
        assertThat(handler.execute("busy", context).error()).contains("正在执行");
    }

    @Test
    void noActiveSessionIsRejected() {
        CommandResult result = handler.execute("m1",
                CommandContext.of("", "/tmp", "test-model", AppState.defaultState()));

        assertThat(result.type()).isEqualTo(CommandResult.ResultType.ERROR);
        verifyNoInteractions(service);
    }
}
