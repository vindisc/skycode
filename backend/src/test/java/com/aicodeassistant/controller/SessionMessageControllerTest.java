package com.aicodeassistant.controller;

import com.aicodeassistant.exception.RequestValidationException;
import com.aicodeassistant.exception.ResourceNotFoundException;
import com.aicodeassistant.exception.SessionNotFoundException;
import com.aicodeassistant.session.MessageRecallService;
import com.aicodeassistant.session.SessionExecutionBusyException;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * DELETE /api/sessions/{sid}/messages/{mid} — 消息气泡上「撤回」按钮用的入口。
 */
class SessionMessageControllerTest {

    private final MessageRecallService service = mock(MessageRecallService.class);
    private final SessionMessageController controller = new SessionMessageController(service);

    @Test
    void returnsSuccessWhenRecalled() {
        when(service.recall("s1", "m1")).thenReturn(MessageRecallService.Outcome.RECALLED);

        var response = controller.recallMessage("s1", "m1");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody()).containsEntry("success", true).containsEntry("messageId", "m1");
    }

    @Test
    void unknownMessageBecomesNotFound() {
        when(service.recall("s1", "nope")).thenReturn(MessageRecallService.Outcome.NOT_FOUND);

        // GlobalExceptionHandler 把 ResourceNotFoundException 映射为 404
        assertThatThrownBy(() -> controller.recallMessage("s1", "nope"))
                .isInstanceOf(ResourceNotFoundException.class)
                .isNotInstanceOf(SessionNotFoundException.class)
                .extracting("code").isEqualTo("MESSAGE_NOT_FOUND");
    }

    @Test
    void toolTransactionBecomesBadRequest() {
        when(service.recall("s1", "tool")).thenReturn(MessageRecallService.Outcome.TOOL_TRANSACTION);

        // RequestValidationException 映射为 400
        assertThatThrownBy(() -> controller.recallMessage("s1", "tool"))
                .isInstanceOf(RequestValidationException.class)
                .extracting("code").isEqualTo("MESSAGE_NOT_RECALLABLE");
    }

    @Test
    void busySessionBecomesConflict() {
        when(service.recall("s1", "m1")).thenReturn(MessageRecallService.Outcome.BUSY);

        // SessionExecutionBusyException 映射为 409 SESSION_CONCURRENT_MODIFICATION
        assertThatThrownBy(() -> controller.recallMessage("s1", "m1"))
                .isInstanceOf(SessionExecutionBusyException.class);
    }
}
