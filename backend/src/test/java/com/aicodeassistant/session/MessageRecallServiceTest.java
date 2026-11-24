package com.aicodeassistant.session;

import com.aicodeassistant.config.database.SqliteConfig;
import com.aicodeassistant.hook.HookService;
import com.aicodeassistant.model.ContentBlock;
import com.aicodeassistant.model.Message;
import com.aicodeassistant.run.RunExecutionRegistry;
import com.aicodeassistant.run.RunTerminationCoordinator;
import com.aicodeassistant.service.MessageRepository;
import com.aicodeassistant.state.AppStateStore;
import com.aicodeassistant.tool.agent.BackgroundAgentTracker;
import com.aicodeassistant.websocket.WebSocketController;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

import java.sql.DriverManager;
import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * 撤回单条消息 — MessageRecallService。使用真实 SQLite 内存库验证 SQL 行为。
 */
class MessageRecallServiceTest {

    private final ObjectMapper objectMapper = new ObjectMapper();
    private JdbcTemplate jdbc;
    private SessionManager sessionManager;
    private SessionExecutionGate gate;
    private WebSocketController webSocketController;
    private MessageRecallService service;

    @BeforeEach
    void setUp() throws Exception {
        var dataSource = new SingleConnectionDataSource(
                DriverManager.getConnection("jdbc:sqlite::memory:"), true);
        jdbc = new JdbcTemplate(dataSource);
        jdbc.execute("""
                CREATE TABLE sessions (
                    id TEXT PRIMARY KEY, title TEXT, model TEXT NOT NULL, working_dir TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'active', total_cost_usd REAL DEFAULT 0.0,
                    metadata_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)
                """);
        jdbc.execute("""
                CREATE TABLE messages (
                    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL,
                    content_json TEXT NOT NULL, stop_reason TEXT,
                    input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
                    created_at TEXT NOT NULL, seq_num INTEGER NOT NULL, meta_json TEXT,
                    UNIQUE(session_id, seq_num))
                """);
        sessionManager = new SessionManager(jdbc, objectMapper, mock(SqliteConfig.class),
                mock(AppStateStore.class), mock(HookService.class), mock(SessionSnapshotService.class),
                mock(BackgroundAgentTracker.class), mock(RunExecutionRegistry.class),
                mock(RunTerminationCoordinator.class));
        for (String id : List.of("s1", "s2")) {
            jdbc.update("INSERT INTO sessions (id, title, model, working_dir, status, created_at, updated_at)"
                            + " VALUES (?,?,?,?,?,?,?)",
                    id, null, "test-model", "/workspace", "active", "2026-11-24T00:00:00Z", "2026-11-24T00:00:00Z");
        }
        gate = new SessionExecutionGate();
        webSocketController = mock(WebSocketController.class);
        service = new MessageRecallService(sessionManager, new MessageRepository(jdbc, objectMapper),
                gate, webSocketController);
    }

    private void insertUserMessage(String id, String sessionId, String text) {
        sessionManager.addMessageWithId(id, sessionId, "user",
                List.of(new ContentBlock.TextBlock(text)), null, 0, 0, null);
    }

    private long count(String messageId) {
        Long value = jdbc.queryForObject("SELECT COUNT(*) FROM messages WHERE id = ?", Long.class, messageId);
        return value == null ? 0 : value;
    }

    @Test
    void recallsPlainMessageAndBroadcastsToBoundClients() {
        insertUserMessage("m1", "s1", "误贴的超大截图");

        assertThat(service.recall("s1", "m1")).isEqualTo(MessageRecallService.Outcome.RECALLED);

        assertThat(count("m1")).isZero();
        assertThat(sessionManager.loadSession("s1").orElseThrow().messages()).isEmpty();
        verify(webSocketController).pushToUser(eq("s1"), eq(MessageRecallService.MESSAGE_RECALLED_EVENT),
                eq(Map.of("messageId", "m1")));
    }

    @Test
    void sessionConditionPreventsCrossSessionDeletion() {
        insertUserMessage("m1", "s1", "属于 s1 的消息");

        assertThat(service.recall("s2", "m1")).isEqualTo(MessageRecallService.Outcome.NOT_FOUND);

        assertThat(count("m1")).isEqualTo(1); // 用别的会话 ID 撤不掉
        assertThat(service.recall("s1", "nope")).isEqualTo(MessageRecallService.Outcome.NOT_FOUND);
        verify(webSocketController, never()).pushToUser(any(), any(), any());
    }

    @Test
    void refusesAssistantMessageCarryingToolUse() {
        sessionManager.addMessageWithId("a1", "s1", "assistant",
                List.of(new ContentBlock.TextBlock("查一下"),
                        new ContentBlock.ToolUseBlock("tu1", "Bash", objectMapper.createObjectNode())),
                "tool_use", 0, 0, null);

        assertThat(service.recall("s1", "a1")).isEqualTo(MessageRecallService.Outcome.TOOL_TRANSACTION);

        assertThat(count("a1")).isEqualTo(1);
        verify(webSocketController, never()).pushToUser(any(), any(), any());
    }

    @Test
    void refusesUserMessageCarryingToolResult() {
        sessionManager.addMessageWithId("r1", "s1", "user",
                List.of(new ContentBlock.ToolResultBlock("tu1", "output", false)), null, 0, 0, null);

        assertThat(service.recall("s1", "r1")).isEqualTo(MessageRecallService.Outcome.TOOL_TRANSACTION);

        assertThat(count("r1")).isEqualTo(1);
    }

    @Test
    void refusesLegacyToolResultCarrierButAllowsAssistantTextWithoutTools() {
        Instant now = Instant.now();
        assertThat(MessageRecallService.isToolTransaction(new Message.UserMessage("legacy", now,
                List.of(new ContentBlock.TextBlock("result")), "raw tool result", "assistant-uuid", null))).isTrue();
        assertThat(MessageRecallService.isToolTransaction(new Message.UserMessage("plain", now,
                List.of(new ContentBlock.TextBlock("hi")), null, null, null))).isFalse();

        sessionManager.addMessageWithId("a2", "s1", "assistant",
                List.of(new ContentBlock.TextBlock("普通回复")), "end_turn", 5, 3, null);
        assertThat(service.recall("s1", "a2")).isEqualTo(MessageRecallService.Outcome.RECALLED);
        assertThat(count("a2")).isZero();
    }

    @Test
    void refusesWhileSessionIsExecuting() {
        insertUserMessage("m1", "s1", "正在生成时会话被占用");

        // 模拟一次正在执行的查询持有前台令牌
        SessionExecutionGate.Token running = gate.tryAcquire(sessionManager.dataSourceIdentity(), "s1");
        assertThat(running).isNotNull();
        assertThat(service.recall("s1", "m1")).isEqualTo(MessageRecallService.Outcome.BUSY);
        assertThat(count("m1")).isEqualTo(1);
        running.close();

        assertThat(service.recall("s1", "m1")).isEqualTo(MessageRecallService.Outcome.RECALLED);
        assertThat(count("m1")).isZero();
    }

    @Test
    void blankIdentifiersAreRejectedWithoutTouchingStorage() {
        assertThat(service.recall("s1", " ")).isEqualTo(MessageRecallService.Outcome.NOT_FOUND);
        assertThat(service.recall("", "m1")).isEqualTo(MessageRecallService.Outcome.NOT_FOUND);
        verify(webSocketController, never()).pushToUser(any(), any(), any());
    }
}
