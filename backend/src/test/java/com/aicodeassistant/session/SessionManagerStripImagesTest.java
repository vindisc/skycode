package com.aicodeassistant.session;

import com.aicodeassistant.config.database.SqliteConfig;
import com.aicodeassistant.hook.HookService;
import com.aicodeassistant.model.ContentBlock;
import com.aicodeassistant.model.Message;
import com.aicodeassistant.run.RunExecutionRegistry;
import com.aicodeassistant.run.RunTerminationCoordinator;
import com.aicodeassistant.state.AppStateStore;
import com.aicodeassistant.tool.agent.BackgroundAgentTracker;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Tag;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

import java.sql.DriverManager;
import java.time.Instant;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

/**
 * 消息级修补 — stripImagesFromMessage / replaceMessages（§图片撑爆上下文自救）。
 * <p>
 * 使用真实 SQLite 内存库验证 SQL 行为（与 SessionManagerSearchTest 同模式）。
 */
@Tag("smoke")
class SessionManagerStripImagesTest {

    private final ObjectMapper objectMapper = new ObjectMapper();
    private JdbcTemplate jdbc;
    private SessionManager sessionManager;

    private static final String SESSION_ID = "s-strip";

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
        jdbc.update("INSERT INTO sessions (id, model, working_dir, status, created_at, updated_at)"
                        + " VALUES (?,?,?,?,?,?)",
                SESSION_ID, "test-model", "/workspace", "idle",
                "2026-11-21T00:00:00Z", "2026-11-21T00:00:00Z");
        sessionManager = new SessionManager(jdbc, objectMapper, mock(SqliteConfig.class),
                mock(AppStateStore.class), mock(HookService.class), mock(SessionSnapshotService.class),
                mock(BackgroundAgentTracker.class), mock(RunExecutionRegistry.class),
                mock(RunTerminationCoordinator.class));
    }

    private Message.UserMessage userMessageWithImage(String uuid, String text) {
        return new Message.UserMessage(uuid, Instant.parse("2026-11-21T00:00:01Z"),
                List.of(
                        new ContentBlock.TextBlock(text),
                        new ContentBlock.ImageBlock("image/png", "aGVsbG8=", 800, 600, null),
                        new ContentBlock.ImageBlock("image/jpeg", null, 400, 300, "https://example.com/a.jpg")
                ),
                null, null, null);
    }

    @Test
    void stripImagesReplacesBlocksWithPlaceholderAndPersists() {
        sessionManager.addMessageWithId("m1", SESSION_ID, "user",
                userMessageWithImage("m1", "看这张图").content(), null, 0, 0, null);

        var result = sessionManager.stripImagesFromMessage(SESSION_ID, "m1");

        assertThat(result).isPresent();
        assertThat(result.get().strippedImages()).isEqualTo(2);

        // 落库校验：content_json 中的 image 块全部替换为占位 TextBlock
        var reloaded = sessionManager.loadSession(SESSION_ID).orElseThrow();
        assertThat(reloaded.messages()).hasSize(1);
        var blocks = ((Message.UserMessage) reloaded.messages().getFirst()).content();
        assertThat(blocks).allSatisfy(b -> assertThat(b).isInstanceOf(ContentBlock.TextBlock.class));
        assertThat(blocks.stream().filter(b -> b instanceof ContentBlock.TextBlock t
                && "[图片已移除]".equals(t.text()))).hasSize(2);
        // 原文本块保留
        assertThat(blocks.stream().anyMatch(b -> b instanceof ContentBlock.TextBlock t
                && "看这张图".equals(t.text()))).isTrue();
    }

    @Test
    void stripImagesReturnsZeroForMessageWithoutImages() {
        sessionManager.addMessageWithId("m2", SESSION_ID, "user",
                List.of(new ContentBlock.TextBlock("纯文本")), null, 0, 0, null);

        var result = sessionManager.stripImagesFromMessage(SESSION_ID, "m2");

        assertThat(result).isPresent();
        assertThat(result.get().strippedImages()).isZero();
        // 未含图时不落库 — content_json 原样
        String json = jdbc.queryForObject(
                "SELECT content_json FROM messages WHERE id = 'm2'", String.class);
        assertThat(json).contains("纯文本");
    }

    @Test
    void stripImagesEmptyForUnknownMessage() {
        assertThat(sessionManager.stripImagesFromMessage(SESSION_ID, "nope")).isEmpty();
        assertThat(sessionManager.stripImagesFromMessage("other-session", "m1")).isEmpty();
    }

    @Test
    void replaceMessagesRewritesHistoryWithContinuousSeqNums() {
        // 预置 3 条消息（seq 1..3），压缩产物只保留摘要 + 1 条用户消息
        sessionManager.addMessageWithId("old-1", SESSION_ID, "user",
                List.of(new ContentBlock.TextBlock("旧消息")), null, 0, 0, null);
        sessionManager.addMessageWithId("old-2", SESSION_ID, "assistant",
                List.of(new ContentBlock.TextBlock("旧回复")), "end_turn", 10, 5, null);
        sessionManager.addMessageWithId("old-3", SESSION_ID, "user",
                List.of(new ContentBlock.TextBlock("保留的要求")), null, 0, 0, null);

        List<Message> compacted = List.of(
                new Message.SystemMessage("summary-1", Instant.parse("2026-11-21T00:02:00Z"),
                        "此前的对话摘要", com.aicodeassistant.model.SystemMessageType.COMPACT_SUMMARY),
                new Message.UserMessage("keep-1", Instant.parse("2026-11-21T00:03:00Z"),
                        List.of(new ContentBlock.TextBlock("保留的要求")),
                        null, null, null)
        );
        sessionManager.replaceMessages(SESSION_ID, compacted);

        var reloaded = sessionManager.loadSession(SESSION_ID).orElseThrow();
        assertThat(reloaded.messages()).hasSize(2);
        assertThat(reloaded.messages().get(0).uuid()).isEqualTo("summary-1");
        assertThat(reloaded.messages().get(1).uuid()).isEqualTo("keep-1");

        // seq_num 连续重排 + UNIQUE 约束未被触发
        var seqs = jdbc.queryForList(
                "SELECT seq_num FROM messages WHERE session_id = ? ORDER BY seq_num",
                Integer.class, SESSION_ID);
        assertThat(seqs).containsExactly(1, 2);

        // SystemMessage 的 String content 以 TextBlock 落库，读回时拼回 String
        assertThat(reloaded.messages().get(0))
                .isInstanceOf(Message.SystemMessage.class)
                .satisfies(m -> assertThat(((Message.SystemMessage) m).content()).isEqualTo("此前的对话摘要"));

        // assistant 的 usage/stop_reason 往返保留
        sessionManager.replaceMessages(SESSION_ID, List.of(
                new Message.AssistantMessage("a-1", Instant.now(),
                        List.of(new ContentBlock.TextBlock("新回复")), "end_turn",
                        new com.aicodeassistant.model.Usage(7, 3, 0, 0))));
        var reloaded2 = sessionManager.loadSession(SESSION_ID).orElseThrow();
        var assistant = (Message.AssistantMessage) reloaded2.messages().getFirst();
        assertThat(assistant.stopReason()).isEqualTo("end_turn");
        assertThat(assistant.usage().inputTokens()).isEqualTo(7);
        assertThat(assistant.usage().outputTokens()).isEqualTo(3);
    }
}
