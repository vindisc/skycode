package com.aicodeassistant.prompt;

import com.aicodeassistant.memdir.MemdirService;
import com.aicodeassistant.memdir.MemoryCategory;
import com.aicodeassistant.service.ProjectMemoryService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

@Tag("smoke")
class MemoryPromptServiceTest {

    @TempDir Path temp;

    private MemoryPromptService service(Path personalDir) {
        return new MemoryPromptService(new MemdirService(personalDir), new ProjectMemoryService());
    }

    @Test
    void injectsAllThreeSourcesInPrecedenceOrder() throws Exception {
        Path personal = Files.createDirectories(temp.resolve("personal"));
        Path project = Files.createDirectories(temp.resolve("project")).toRealPath();
        Files.writeString(personal.resolve("MEMORY.md"), "PERSONAL_MARK");
        Files.writeString(project.resolve("skycode.md"), "SHARED_MARK");
        Files.writeString(project.resolve("skycode.local.md"), "LOCAL_MARK");

        String prompt = service(personal).buildMemoryPrompt(project);

        int p = prompt.indexOf("PERSONAL_MARK");
        int s = prompt.indexOf("SHARED_MARK");
        int l = prompt.indexOf("LOCAL_MARK");
        assertTrue(p >= 0 && s > p && l > s, "顺序应为 MEMORY → skycode.md → skycode.local.md");
        assertTrue(prompt.contains("<personal_memory>"));
        assertTrue(prompt.contains("<project_memory>"));
        assertTrue(prompt.contains("<project_local_memory>"));
        assertTrue(prompt.contains("内容冲突时以优先级高者为准"));
    }

    @Test
    void returnsEmptyWhenNoMemory() throws Exception {
        Path personal = Files.createDirectories(temp.resolve("personal-empty"));
        Path project = Files.createDirectories(temp.resolve("project-empty")).toRealPath();
        assertEquals("", service(personal).buildMemoryPrompt(project));
    }

    @Test
    void rereadsFilesOnEveryCall() throws Exception {
        Path personal = Files.createDirectories(temp.resolve("personal-v"));
        Path project = Files.createDirectories(temp.resolve("project-v")).toRealPath();
        MemoryPromptService svc = service(personal);

        Files.writeString(project.resolve("skycode.md"), "PROJECT_V1");
        assertTrue(svc.buildMemoryPrompt(project).contains("PROJECT_V1"));

        Files.writeString(project.resolve("skycode.md"), "PROJECT_V2");
        String second = svc.buildMemoryPrompt(project);
        assertTrue(second.contains("PROJECT_V2"));
        assertFalse(second.contains("PROJECT_V1"));
    }

    @Test
    void nullProjectRootInjectsOnlyPersonal() throws Exception {
        Path personal = Files.createDirectories(temp.resolve("personal-only"));
        Files.writeString(personal.resolve("MEMORY.md"), "PERSONAL_ONLY");
        String prompt = service(personal).buildMemoryPrompt(null);
        assertTrue(prompt.contains("PERSONAL_ONLY"));
        assertFalse(prompt.contains("<project_memory>"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"personal", "shared", "local"})
    void failedSourceDoesNotSuppressOtherMemories(String failedSource) {
        MemdirService personal = mock(MemdirService.class);
        ProjectMemoryService project = mock(ProjectMemoryService.class);
        // 检索接线后先读全文判长度（短全文走 readMemoriesForPrompt 整文件注入）
        when(personal.readMemories()).thenReturn("PERSONAL_MARK");
        when(personal.readMemoriesForPrompt()).thenReturn("PERSONAL_MARK");
        when(project.loadMemoryFile(temp, ProjectMemoryService.SHARED_FILE)).thenReturn("SHARED_MARK");
        when(project.loadMemoryFile(temp, ProjectMemoryService.LOCAL_FILE)).thenReturn("LOCAL_MARK");
        RuntimeException unavailable = new IllegalStateException("source unavailable");
        switch (failedSource) {
            case "personal" -> {
                // 检索接线后先读全文判长度，再走注入分支；两个读取点都要 stub
                when(personal.readMemories()).thenThrow(unavailable);
                when(personal.readMemoriesForPrompt()).thenThrow(unavailable);
            }
            case "shared" -> when(project.loadMemoryFile(temp, ProjectMemoryService.SHARED_FILE))
                    .thenThrow(unavailable);
            case "local" -> when(project.loadMemoryFile(temp, ProjectMemoryService.LOCAL_FILE))
                    .thenThrow(unavailable);
            default -> throw new IllegalArgumentException(failedSource);
        }

        String prompt = new MemoryPromptService(personal, project).buildMemoryPrompt(temp);

        assertEquals(!failedSource.equals("personal"), prompt.contains("PERSONAL_MARK"));
        assertEquals(!failedSource.equals("shared"), prompt.contains("SHARED_MARK"));
        assertEquals(!failedSource.equals("local"), prompt.contains("LOCAL_MARK"));
        assertTrue(prompt.startsWith("<memory>"));
        assertTrue(prompt.endsWith("</memory>"));
        if (failedSource.equals("personal")) {
            // 检索接线后先读全文判长度，抛错即短路，不会走到注入读取
            verify(personal).readMemories();
        } else {
            verify(personal).readMemoriesForPrompt();
        }
        verify(project).loadMemoryFile(temp, ProjectMemoryService.SHARED_FILE);
        verify(project).loadMemoryFile(temp, ProjectMemoryService.LOCAL_FILE);
    }

    @Test
    void allSourcesFailWithoutBlockingPromptConstruction() {
        MemdirService personal = mock(MemdirService.class);
        ProjectMemoryService project = mock(ProjectMemoryService.class);
        when(personal.readMemories()).thenThrow(new IllegalStateException("personal unavailable"));
        when(personal.readMemoriesForPrompt()).thenThrow(new IllegalStateException("personal unavailable"));
        when(project.loadMemoryFile(temp, ProjectMemoryService.SHARED_FILE))
                .thenThrow(new IllegalStateException("shared unavailable"));
        when(project.loadMemoryFile(temp, ProjectMemoryService.LOCAL_FILE))
                .thenThrow(new IllegalStateException("local unavailable"));

        assertEquals("", new MemoryPromptService(personal, project).buildMemoryPrompt(temp));
    }

    // ═══ 检索接线（2026-11-28）═══

    /** 超过检索阈值的假记忆全文（> 20_000 字符） */
    private static String oversizedMemory() {
        return ("<!-- source:TOOL time:2026-11-01T00:00:00Z category:semantic -->\n"
                + "记忆条目内容填充段落，包含若干背景信息使得整体长度超过阈值。\n").repeat(300);
    }

    @Test
    void oversizedPersonalMemoryWithQueryInjectsRetrievedEntriesOnly() {
        MemdirService personal = mock(MemdirService.class);
        when(personal.readMemories()).thenReturn(oversizedMemory());
        var hits = List.of(
                new MemdirService.Memory("h1", "相关条目一：连接池配置偏好", MemoryCategory.SEMANTIC),
                new MemdirService.Memory("h2", "相关条目二：部署流程", MemoryCategory.PROCEDURAL));
        when(personal.searchMemories("连接池", 12)).thenReturn(hits);

        String prompt = new MemoryPromptService(personal, new ProjectMemoryService())
                .buildMemoryPrompt(null, "连接池");

        assertTrue(prompt.contains("相关条目一"), "应注入检索命中条目");
        assertTrue(prompt.contains("相关条目二"), "应注入检索命中条目");
        assertTrue(prompt.contains("最相关"), "应有检索模式说明");
        assertFalse(prompt.contains("记忆条目内容填充段落"), "超长全文不应整体注入");
    }

    @Test
    void oversizedPersonalMemoryWithoutQueryFallsBackToFullFile() {
        MemdirService personal = mock(MemdirService.class);
        when(personal.readMemories()).thenReturn(oversizedMemory());
        when(personal.readMemoriesForPrompt()).thenReturn("TRUNCATED_FULL_FILE");

        String prompt = new MemoryPromptService(personal, new ProjectMemoryService())
                .buildMemoryPrompt(null, null);

        assertTrue(prompt.contains("TRUNCATED_FULL_FILE"), "无 query 时回落整文件注入");
        verify(personal, never()).searchMemories(anyString(), anyInt());
    }

    @Test
    void retrievalWithoutHitsFallsBackToFullFile() {
        MemdirService personal = mock(MemdirService.class);
        when(personal.readMemories()).thenReturn(oversizedMemory());
        when(personal.readMemoriesForPrompt()).thenReturn("TRUNCATED_FULL_FILE");
        when(personal.searchMemories(anyString(), anyInt())).thenReturn(List.of());

        String prompt = new MemoryPromptService(personal, new ProjectMemoryService())
                .buildMemoryPrompt(null, "毫无关联的新话题");

        assertTrue(prompt.contains("TRUNCATED_FULL_FILE"), "检索无命中时回落整文件注入");
    }

    // ═══ 团队记忆层（2026-11-28）═══

    @Test
    void teamMemoriesInjectBetweenPersonalAndProject() throws Exception {
        Path personal = Files.createDirectories(temp.resolve("personal-team"));
        Path project = Files.createDirectories(temp.resolve("project-team")).toRealPath();
        Files.writeString(personal.resolve("MEMORY.md"), "PERSONAL_MARK");
        Files.createDirectories(project.resolve(".skycode/team-memories"));
        Files.writeString(project.resolve(".skycode/team-memories/conventions.md"), "TEAM_MARK");
        Files.writeString(project.resolve("skycode.md"), "SHARED_MARK");

        String prompt = service(personal).buildMemoryPrompt(project, null);

        int p = prompt.indexOf("PERSONAL_MARK");
        int t = prompt.indexOf("TEAM_MARK");
        int s = prompt.indexOf("SHARED_MARK");
        assertTrue(t >= 0, "应注入团队记忆");
        assertTrue(p < t && t < s, "顺序应为 personal < team < project");
        assertTrue(prompt.contains("<team_memory>"));
    }

    @Test
    void oversizedTeamFilesAreTruncatedAndCapped() throws Exception {
        Path personal = Files.createDirectories(temp.resolve("personal-team-cap"));
        Path project = Files.createDirectories(temp.resolve("project-team-cap")).toRealPath();
        Path teamDir = Files.createDirectories(project.resolve(".skycode/team-memories"));
        Files.writeString(teamDir.resolve("big.md"), "团队大文件内容".repeat(2000)); // 12000 字符 > 单文件 10000 上限
        Files.writeString(teamDir.resolve("big2.md"), "第二份团队记忆内容".repeat(2000)); // 超总量上限

        String prompt = service(personal).buildMemoryPrompt(project, null);

        assertTrue(prompt.contains("…（截断）"), "超单文件上限应截断");
        assertTrue(prompt.contains("仅注入前"), "超总量上限应有提示");
        // big2 加进第一个文件后必超总量上限，不应被注入
        assertFalse(prompt.contains("第二份团队记忆内容"), "第二个大文件不应注入");
    }
}
