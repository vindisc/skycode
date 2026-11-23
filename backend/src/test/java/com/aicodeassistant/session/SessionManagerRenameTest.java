package com.aicodeassistant.session;

import com.aicodeassistant.config.database.SqliteConfig;
import com.aicodeassistant.hook.HookService;
import com.aicodeassistant.model.SessionSummary;
import com.aicodeassistant.run.RunExecutionRegistry;
import com.aicodeassistant.run.RunTerminationCoordinator;
import com.aicodeassistant.state.AppStateStore;
import com.aicodeassistant.tool.agent.BackgroundAgentTracker;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.SingleConnectionDataSource;

import java.sql.DriverManager;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

/**
 * 会话重命名 — updateSessionTitle（侧栏改名）。
 * <p>
 * 使用真实 SQLite 内存库验证 SQL 行为（与 SessionManagerSearchTest 同模式）。
 */
class SessionManagerRenameTest {

    private final ObjectMapper objectMapper = new ObjectMapper();
    private JdbcTemplate jdbc;
    private SessionManager sessionManager;

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
                    content_json TEXT NOT NULL, created_at TEXT NOT NULL, seq_num INTEGER NOT NULL)
                """);
        sessionManager = new SessionManager(jdbc, objectMapper, mock(SqliteConfig.class),
                mock(AppStateStore.class), mock(HookService.class), mock(SessionSnapshotService.class),
                mock(BackgroundAgentTracker.class), mock(RunExecutionRegistry.class),
                mock(RunTerminationCoordinator.class));
        insertSession("s1", "2026-11-21T01:00:00Z");
        insertUserMessage("m1", "s1", "我想做黄金投资，但是不太懂怎么具体操作");
        insertSession("s2", "2026-11-21T02:00:00Z");
    }

    private void insertSession(String id, String updatedAt) {
        jdbc.update("INSERT INTO sessions (id, title, model, working_dir, status, metadata_json, created_at, updated_at)"
                        + " VALUES (?,?,?,?,?,?,?,?)",
                id, null, "test-model", "/workspace", "active", null, updatedAt, updatedAt);
    }

    private void insertUserMessage(String id, String sessionId, String text) throws Exception {
        String contentJson = objectMapper.writeValueAsString(List.of(Map.of("type", "text", "text", text)));
        jdbc.update("INSERT INTO messages (id, session_id, role, content_json, created_at, seq_num)"
                        + " VALUES (?,?,?,?,?,?)",
                id, sessionId, "user", contentJson, "2026-11-21T01:00:01Z", 1);
    }

    @Test
    void renameTrimsTitleAndLeavesUpdatedAtUntouched() {
        assertThat(sessionManager.updateSessionTitle("s1", "  黄金投资方案  ")).isTrue();

        Map<String, Object> row = jdbc.queryForMap("SELECT title, updated_at FROM sessions WHERE id = 's1'");
        assertThat(row.get("title")).isEqualTo("黄金投资方案");
        // 改名不算新活动：列表按 updated_at 排序，位置不应因改名而变化
        assertThat(row.get("updated_at")).isEqualTo("2026-11-21T01:00:00Z");
        // 其他会话不受影响
        assertThat(jdbc.queryForObject("SELECT title FROM sessions WHERE id = 's2'", String.class)).isNull();
    }

    @Test
    void blankTitleClearsCustomName() {
        sessionManager.updateSessionTitle("s1", "黄金投资方案");

        assertThat(sessionManager.updateSessionTitle("s1", "   ")).isTrue();
        assertThat(jdbc.queryForObject("SELECT title FROM sessions WHERE id = 's1'", String.class)).isNull();
        assertThat(sessionManager.updateSessionTitle("s1", null)).isTrue();
        assertThat(jdbc.queryForObject("SELECT title FROM sessions WHERE id = 's1'", String.class)).isNull();
    }

    @Test
    void returnsFalseForUnknownSession() {
        assertThat(sessionManager.updateSessionTitle("nope", "任意名称")).isFalse();
    }

    @Test
    void listAndSearchUseCustomTitle() {
        sessionManager.updateSessionTitle("s1", "黄金投资方案");

        // 列表返回自定义标题；首条用户消息预览保持不变
        SessionSummary summary = sessionManager.listSessionsPaginated(true, null, 20, null).sessions().stream()
                .filter(s -> s.id().equals("s1")).findFirst().orElseThrow();
        assertThat(summary.title()).isEqualTo("黄金投资方案");
        assertThat(summary.goalPreview()).contains("黄金投资");

        // 搜索按自定义标题命中
        assertThat(sessionManager.listSessionsPaginated(true, null, 20, "黄金投资方案").sessions())
                .extracting(SessionSummary::id).containsExactly("s1");
    }
}
