package com.aicodeassistant.controller;

import com.aicodeassistant.engine.QueryMessageHandler;
import com.aicodeassistant.exception.RequestValidationException;
import com.aicodeassistant.model.ContentBlock;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Tag;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 2026-11-27 审计修复的回归测试：
 * 1. ResultCollectingHandler 按 toolUseId 配对（并行工具交错下不再错配）；
 * 2. /api/query 系列端点的空 prompt 与非法 timeoutSeconds 拒绝。
 */
@Tag("smoke")
class QueryControllerValidationTest {

    // ═══ 工具结果配对 ═══

    private static ContentBlock.ToolResultBlock result(String toolUseId, String content) {
        return new ContentBlock.ToolResultBlock(toolUseId, content, false);
    }

    @Test
    @DisplayName("并行工具交错完成时结果按 toolUseId 精确配对")
    void interleavedToolResultsPairById() {
        QueryController.ResultCollectingHandler handler = new QueryController.ResultCollectingHandler();

        // start A → start B → result B → result A（并行执行的真实交错）
        handler.onToolUseStart("tool-a", "Bash");
        handler.onToolUseStart("tool-b", "Read");
        handler.onToolResult("tool-b", result("tool-b", "output-of-b"));
        handler.onToolResult("tool-a", result("tool-a", "output-of-a"));

        List<QueryController.ToolCallSummary> calls = handler.getToolCalls();
        assertThat(calls).hasSize(2);
        // 插入序保持 A 在前
        assertThat(calls.get(0).tool()).isEqualTo("Bash");
        assertThat(calls.get(0).output()).isEqualTo("output-of-a");
        assertThat(calls.get(1).tool()).isEqualTo("Read");
        assertThat(calls.get(1).output()).isEqualTo("output-of-b");
    }

    @Test
    @DisplayName("未知 toolUseId 的结果不会污染已有条目")
    void unknownToolResultDoesNotClobberExistingEntries() {
        QueryController.ResultCollectingHandler handler = new QueryController.ResultCollectingHandler();
        handler.onToolUseStart("tool-a", "Grep");
        handler.onToolResult("tool-ghost", result("tool-ghost", "stray"));
        handler.onToolResult("tool-a", result("tool-a", "real"));

        List<QueryController.ToolCallSummary> calls = handler.getToolCalls();
        assertThat(calls).hasSize(1);
        assertThat(calls.getFirst().output()).isEqualTo("real");
        assertThat(calls.getFirst().isError()).isFalse();
    }

    @Test
    @DisplayName("重复同 id 的 start 不会产生重复条目")
    void duplicateStartKeepsSingleEntry() {
        QueryController.ResultCollectingHandler handler = new QueryController.ResultCollectingHandler();
        handler.onToolUseStart("tool-a", "Bash");
        handler.onToolUseStart("tool-a", "Bash");
        handler.onToolResult("tool-a", result("tool-a", "done"));
        assertThat(handler.getToolCalls()).hasSize(1);
    }

    // ═══ 请求校验 ═══

    @Test
    @DisplayName("prompt 为空且无 stdin 时拒绝")
    void blankPromptWithoutStdinIsRejected() {
        assertThatThrownBy(() -> QueryController.requireUsablePrompt(null, null))
                .isInstanceOf(RequestValidationException.class)
                .hasMessageContaining("prompt");
        assertThatThrownBy(() -> QueryController.requireUsablePrompt("   ", null))
                .isInstanceOf(RequestValidationException.class);
        assertThatThrownBy(() -> QueryController.requireUsablePrompt(null,
                new QueryController.QueryContext(null, null)))
                .isInstanceOf(RequestValidationException.class);
    }

    @Test
    @DisplayName("有 stdin 兜底时允许 prompt 为空")
    void stdinBacksEmptyPrompt() {
        QueryController.requireUsablePrompt(null,
                new QueryController.QueryContext("some piped input", null));
        QueryController.requireUsablePrompt("正常提问", null);
    }

    @Test
    @DisplayName("timeoutSeconds <= 0 被拒绝（Servlet 会把 <=0 当永不超时）")
    void nonPositiveTimeoutIsRejected() {
        assertThatThrownBy(() -> QueryController.resolveTimeoutMs(0))
                .isInstanceOf(RequestValidationException.class)
                .hasMessageContaining("timeoutSeconds");
        assertThatThrownBy(() -> QueryController.resolveTimeoutMs(-5))
                .isInstanceOf(RequestValidationException.class);
        assertThat(QueryController.resolveTimeoutMs(null)).isEqualTo(600_000L);
        assertThat(QueryController.resolveTimeoutMs(30)).isEqualTo(30_000L);
    }
}
