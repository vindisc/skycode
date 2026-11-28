package com.aicodeassistant.hook;

import com.aicodeassistant.engine.SideQueryService;
import com.aicodeassistant.memdir.MemdirService;
import com.aicodeassistant.model.ContentBlock;
import com.aicodeassistant.model.Message;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.lang.reflect.Field;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/**
 * 自动记忆沉淀（2026-11-28 重写）的回归测试。
 * 旧实现方向性错误：触发词与提取都在助手回复上，存的是助手回复开头 200 字；
 * 新实现从用户消息识别「请记住 / remember that / 备忘」，提取指令之后的实际内容。
 */
class HookServiceMemoryCaptureTest {

    @TempDir
    java.nio.file.Path tempDir;

    private HookService service(MemdirService memdir, SideQueryService side) throws Exception {
        HookService s = new HookService(new HookRegistry(), memdir);
        Field f = HookService.class.getDeclaredField("sideQueryService");
        f.setAccessible(true);
        f.set(s, side);
        return s;
    }

    private static List<Message> messages(String userText) {
        return List.of(
                new Message.UserMessage(UUID.randomUUID().toString(), Instant.now(),
                        List.of(new ContentBlock.TextBlock("上一轮的问题")), null, null),
                new Message.UserMessage(UUID.randomUUID().toString(), Instant.now(),
                        List.of(new ContentBlock.TextBlock(userText)), null, null),
                new Message.AssistantMessage(UUID.randomUUID().toString(), Instant.now(),
                        List.of(new ContentBlock.TextBlock("好的，我已经记住了。")), "end_turn", null));
    }

    // ═══ extractMemoryCandidate 纯函数 ═══

    @Test
    @DisplayName("「请记住：X」提取冒号后的内容")
    void extractsAfterColon() {
        assertThat(HookService.extractMemoryCandidate("请记住：我偏好深色主题"))
                .isEqualTo("我偏好深色主题");
    }

    @Test
    @DisplayName("「remember that X」提取英文指令后的内容")
    void extractsAfterRememberThat() {
        assertThat(HookService.extractMemoryCandidate("remember that all commits use Chinese"))
                .isEqualTo("all commits use Chinese");
    }

    @Test
    @DisplayName("「备忘 X」提取内容")
    void extractsAfterBeiwang() {
        assertThat(HookService.extractMemoryCandidate("备忘：部署前跑全量测试"))
                .isEqualTo("部署前跑全量测试");
    }

    @Test
    @DisplayName("裸「记住」不触发（避免「记住密码功能」这类实现话题误触发）")
    void bareRememberDoesNotTrigger() {
        assertThat(HookService.extractMemoryCandidate("帮我实现记住密码功能的实现方案")).isNull();
    }

    @Test
    @DisplayName("无触发词返回 null")
    void noTriggerReturnsNull() {
        assertThat(HookService.extractMemoryCandidate("帮我看看这个报错")).isNull();
    }

    @Test
    @DisplayName("触发词后无内容返回 null")
    void emptyCandidateReturnsNull() {
        assertThat(HookService.extractMemoryCandidate("请记住")).isNull();
        assertThat(HookService.extractMemoryCandidate("请记住：")).isNull();
    }

    // ═══ executePostStopActions 行为 ═══

    @Test
    @DisplayName("触发时异步写入 AUTO 记忆（LLM 不可用回落原文）")
    void triggeredCaptureWritesAutoEntry() throws Exception {
        MemdirService memdir = mock(MemdirService.class);
        var s = service(memdir, null); // side query 不可用 → 回落原文

        s.executePostStopActions(messages("请记住：测试偏好项 ABC"), "sess-1");

        verify(memdir, timeout(3000)).writeMemory(
                contains("测试偏好项 ABC"), eq(MemdirService.MemorySource.AUTO));
    }

    @Test
    @DisplayName("side query 可用时写入提炼后的文本")
    void usesSideQueryRefinementWhenAvailable() throws Exception {
        MemdirService memdir = mock(MemdirService.class);
        SideQueryService side = mock(SideQueryService.class);
        when(side.isAvailable()).thenReturn(true);
        when(side.query(anyString(), anyString(), anyInt(), anyLong()))
                .thenReturn("用户偏好：测试偏好项 ABC");
        var s = service(memdir, side);

        s.executePostStopActions(messages("请记住：测试偏好项 ABC"), "sess-2");

        verify(memdir, timeout(3000)).writeMemory(
                eq("用户偏好：测试偏好项 ABC"), eq(MemdirService.MemorySource.AUTO));
    }

    @Test
    @DisplayName("LLM 提炼失败回落原文")
    void sideQueryFailureFallsBackToRaw() throws Exception {
        MemdirService memdir = mock(MemdirService.class);
        SideQueryService side = mock(SideQueryService.class);
        when(side.isAvailable()).thenReturn(true);
        when(side.query(anyString(), anyString(), anyInt(), anyLong()))
                .thenThrow(new IllegalStateException("fast model unavailable"));
        var s = service(memdir, side);

        s.executePostStopActions(messages("请记住：回落内容验证 XYZ"), "sess-3");

        verify(memdir, timeout(3000)).writeMemory(
                contains("回落内容验证 XYZ"), eq(MemdirService.MemorySource.AUTO));
    }

    @Test
    @DisplayName("无触发词不写入")
    void noTriggerWritesNothing() throws Exception {
        MemdirService memdir = mock(MemdirService.class);
        var s = service(memdir, null);

        s.executePostStopActions(messages("普通提问，没有任何指令"), "sess-4");

        verify(memdir, never()).writeMemory(anyString(), any());
    }

    @Test
    @DisplayName("开关关闭时不写入")
    void disabledSwitchWritesNothing() throws Exception {
        MemdirService memdir = mock(MemdirService.class);
        var s = service(memdir, null);
        Field f = HookService.class.getDeclaredField("autoCaptureEnabled");
        f.setAccessible(true);
        f.setBoolean(s, false);

        s.executePostStopActions(messages("请记住：这条不该写入"), "sess-5");

        verify(memdir, never()).writeMemory(anyString(), any());
    }

    @Test
    @DisplayName("memdirService 为 null（部分既有测试如此构造）时不抛异常")
    void nullMemdirDoesNotThrow() throws Exception {
        HookService s = new HookService(new HookRegistry(), null);
        s.executePostStopActions(messages("请记住：无存储也应安静失败"), "sess-6");
        // 异步线程内吞掉 NPE——只要调用不抛即达标
    }
}
