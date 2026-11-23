package com.aicodeassistant.controller;

import com.aicodeassistant.engine.CompactService;
import com.aicodeassistant.exception.RequestValidationException;
import com.aicodeassistant.exception.SessionNotFoundException;
import com.aicodeassistant.llm.LlmProviderRegistry;
import com.aicodeassistant.model.Usage;
import com.aicodeassistant.permission.PermissionModeManager;
import com.aicodeassistant.run.RunEnvelopeRepository;
import com.aicodeassistant.service.ProjectWorkspaceService;
import com.aicodeassistant.service.PublicMessageProjection;
import com.aicodeassistant.session.SessionData;
import com.aicodeassistant.session.SessionExecutionGate;
import com.aicodeassistant.session.SessionManager;
import com.aicodeassistant.websocket.WebSocketSessionManager;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.messaging.simp.SimpMessagingTemplate;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 侧栏改名 — 入参规整与边界。
 */
class SessionControllerRenameTest {

    @Test
    void trimsTitleBeforePersisting() {
        SessionManager sessions = knownSession("s1");
        when(sessions.updateSessionTitle("s1", "黄金投资方案")).thenReturn(true);

        var response = controller(sessions).renameSession("s1", request("  黄金投资方案  "));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody().sessionId()).isEqualTo("s1");
        assertThat(response.getBody().title()).isEqualTo("黄金投资方案");
    }

    @Test
    void blankTitleClearsCustomName() {
        SessionManager sessions = knownSession("s1");
        when(sessions.updateSessionTitle("s1", "")).thenReturn(true);

        var response = controller(sessions).renameSession("s1", request("   "));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody().title()).isNull();
    }

    @Test
    void acceptsTitleAtLengthLimit() {
        SessionManager sessions = knownSession("s1");
        String limit = "长".repeat(120);
        when(sessions.updateSessionTitle("s1", limit)).thenReturn(true);

        var response = controller(sessions).renameSession("s1", request(limit));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody().title()).hasSize(120);
    }

    @Test
    void rejectsOverlongTitleWithoutWriting() {
        SessionManager sessions = knownSession("s1");

        assertThatThrownBy(() -> controller(sessions).renameSession("s1", request("长".repeat(121))))
                .isInstanceOf(RequestValidationException.class);
        verify(sessions, never()).updateSessionTitle(any(), any());
    }

    @Test
    void unknownSessionIsReportedAsNotFound() {
        SessionManager sessions = mock(SessionManager.class);

        assertThatThrownBy(() -> controller(sessions).renameSession("nope", request("任意名称")))
                .isInstanceOf(SessionNotFoundException.class);
        verify(sessions, never()).updateSessionTitle(any(), any());
    }

    private static SessionController.RenameSessionRequest request(String title) {
        return new SessionController.RenameSessionRequest(title);
    }

    /** loadSession 能查到的会话（接口先确认会话存在再改名）。 */
    private static SessionManager knownSession(String sessionId) {
        SessionManager sessions = mock(SessionManager.class);
        Instant now = Instant.now();
        when(sessions.loadSession(sessionId)).thenReturn(Optional.of(new SessionData(
                sessionId, "model", "/tmp/workspace", null, "active",
                List.of(), Map.of(), Usage.zero(), 0.0, null, now, now)));
        return sessions;
    }

    private static SessionController controller(SessionManager sessions) {
        return new SessionController(
                sessions,
                mock(CompactService.class),
                mock(LlmProviderRegistry.class),
                mock(com.aicodeassistant.llm.ModelRegistry.class),
                mock(SimpMessagingTemplate.class),
                mock(WebSocketSessionManager.class),
                mock(ProjectWorkspaceService.class),
                mock(PermissionModeManager.class),
                new PublicMessageProjection(),
                mock(RunEnvelopeRepository.class),
                mock(SessionExecutionGate.class),
                "");
    }
}
