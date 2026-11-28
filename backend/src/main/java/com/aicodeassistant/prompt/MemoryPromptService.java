package com.aicodeassistant.prompt;

import com.aicodeassistant.memdir.MemdirService;
import com.aicodeassistant.service.ProjectMemoryService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.nio.file.Path;
import java.util.List;

/**
 * MemoryPromptService — 统一生成注入系统提示的记忆段。
 * <p>
 * 来源与顺序（后者优先级更高，冲突时以后者为准）:
 * <ol>
 *     <li>个人记忆 {@code ~/.ai-code-assistant/MEMORY.md}（跨项目）</li>
 *     <li>团队记忆 {@code <项目>/.skycode/team-memories/*.md}（项目内协作共享）</li>
 *     <li>项目共享记忆 {@code skycode.md}（提交共享）</li>
 *     <li>项目个人本地记忆 {@code skycode.local.md}（本地不提交）</li>
 * </ol>
 * 不做缓存：每次构建系统提示都重新读取，文件修改后下一次请求即生效。
 * 同一次查询执行内的多轮工具循环仍复用执行开始时构建的系统提示。
 * <p>
 * 个人记忆的注入策略（2026-11-28 接线）：
 * <ul>
 *     <li>全文不超过 {@link #PROMPT_RETRIEVAL_THRESHOLD} 时整文件注入（与旧行为一致）；
 *         仍由 {@link MemdirService#readMemoriesForPrompt()} 做 200 行 / 25KB 硬截断兜底。</li>
 *     <li>超过阈值且本次请求带用户消息（query 非空）时，改为按 query 走 BM25 + LLM
 *         rerank 检索注入 Top-K 相关条目——记忆量大后整文件截断会静默丢内容，
 *         检索正是为这个场景准备的；检索无结果同样回落整文件截断。</li>
 *     <li>query 为空（某些续跑/后台链路）时回落整文件截断，行为与旧版一致。</li>
 * </ul>
 */
@Service
public class MemoryPromptService {

    private static final Logger log = LoggerFactory.getLogger(MemoryPromptService.class);

    static final String PRECEDENCE_NOTE =
            "以下为持久化记忆，按优先级从低到高排列：个人记忆（MEMORY.md）< 团队记忆（.skycode/team-memories/）"
            + "< 项目记忆（skycode.md）< 项目本地记忆（skycode.local.md）。内容冲突时以优先级高者为准；"
            + "记忆不凌驾于用户当前的明确指令。";

    /** 个人记忆全文超过该字符数时改走按 query 检索注入（低于 readMemoriesForPrompt 的 25KB 截断线） */
    static final int PROMPT_RETRIEVAL_THRESHOLD = 20_000;
    /** 检索模式注入的条目数 */
    static final int RETRIEVAL_TOP_K = 12;
    /** 单个团队记忆文件注入上限（字符） */
    static final int TEAM_MEMORY_FILE_LIMIT = 10_000;
    /** 团队记忆注入总量上限（字符） */
    static final int TEAM_MEMORY_TOTAL_LIMIT = 20_000;

    private final MemdirService memdirService;
    private final ProjectMemoryService projectMemoryService;

    public MemoryPromptService(MemdirService memdirService,
                               ProjectMemoryService projectMemoryService) {
        this.memdirService = memdirService;
        this.projectMemoryService = projectMemoryService;
    }

    /**
     * 构建记忆段（不带查询）——行为与旧版一致：个人记忆整文件注入。
     *
     * @param projectRoot 当前 Session 的 Project 根目录（可为 null，此时只注入个人记忆）
     */
    public String buildMemoryPrompt(Path projectRoot) {
        return buildMemoryPrompt(projectRoot, null);
    }

    /**
     * 构建记忆段。
     *
     * @param projectRoot 当前 Session 的 Project 根目录（可为 null，此时只注入个人记忆）
     * @param userQuery   本次请求的用户消息文本（可为 null——null 时个人记忆整文件注入）
     */
    public String buildMemoryPrompt(Path projectRoot, String userQuery) {
        String personal = buildPersonalSection(userQuery);
        String team = projectRoot == null ? ""
                : safe(() -> buildTeamSection(projectRoot), "team memories");
        String shared = projectRoot == null ? ""
                : safe(() -> projectMemoryService.loadMemoryFile(projectRoot, ProjectMemoryService.SHARED_FILE),
                        "skycode.md");
        String local = projectRoot == null ? ""
                : safe(() -> projectMemoryService.loadMemoryFile(projectRoot, ProjectMemoryService.LOCAL_FILE),
                        "skycode.local.md");

        if (personal.isBlank() && team.isBlank() && shared.isBlank() && local.isBlank()) return "";

        StringBuilder sb = new StringBuilder("<memory>\n").append(PRECEDENCE_NOTE).append("\n");
        appendSection(sb, "personal_memory", personal);
        appendSection(sb, "team_memory", team);
        appendSection(sb, "project_memory", shared);
        appendSection(sb, "project_local_memory", local);
        sb.append("</memory>");
        return sb.toString();
    }

    /**
     * 个人记忆段：小文件整文件注入；超过阈值且带查询时改为检索注入。
     */
    private String buildPersonalSection(String userQuery) {
        return safe(() -> {
            String full = memdirService.readMemories();
            if (full.isBlank()) return "";
            if (full.length() <= PROMPT_RETRIEVAL_THRESHOLD || userQuery == null || userQuery.isBlank()) {
                return memdirService.readMemoriesForPrompt();
            }

            List<MemdirService.Memory> relevant = memdirService.searchMemories(userQuery, RETRIEVAL_TOP_K);
            if (relevant.isEmpty()) {
                // 检索无命中（比如 query 是与记忆无关的新话题）：回落整文件截断，
                // 保证通用偏好类记忆（时间无关、不含 query 词）不至于完全消失
                log.debug("Memory retrieval returned no hits; falling back to full-file injection");
                return memdirService.readMemoriesForPrompt();
            }

            StringBuilder sb = new StringBuilder();
            sb.append("个人记忆条目较多，以下为与当前请求最相关的 ").append(relevant.size())
              .append(" 条（完整记忆可通过 Memory 工具的 read 动作查看）：\n\n");
            for (MemdirService.Memory mem : relevant) {
                sb.append(mem.content()).append("\n\n");
            }
            return sb.toString();
        }, "personal");
    }

    /**
     * 团队记忆段：每个文件截断到 {@link #TEAM_MEMORY_FILE_LIMIT}，
     * 总量超过 {@link #TEAM_MEMORY_TOTAL_LIMIT} 后停止追加（按文件名序稳定选取）。
     */
    private String buildTeamSection(Path projectRoot) {
        List<MemdirService.Memory> teamMemories = memdirService.loadTeamMemories(projectRoot);
        if (teamMemories.isEmpty()) return "";

        StringBuilder sb = new StringBuilder();
        int total = 0;
        int included = 0;
        for (MemdirService.Memory mem : teamMemories) {
            String content = mem.content();
            if (content.length() > TEAM_MEMORY_FILE_LIMIT) {
                content = content.substring(0, TEAM_MEMORY_FILE_LIMIT) + "\n…（截断）";
            }
            // 追加前预判：加进去会达到总量上限就停（避免只差一点点却整体超限）
            if (total > 0 && total + content.length() >= TEAM_MEMORY_TOTAL_LIMIT) {
                sb.append("\n（团队记忆条目较多，仅注入前 ").append(included).append(" 个文件；")
                  .append("其余见 ").append(projectRoot.resolve(".skycode/team-memories/")).append("）");
                break;
            }
            sb.append("### ").append(mem.name()).append("\n").append(content).append("\n\n");
            total += content.length();
            included++;
        }
        return sb.toString();
    }

    private static void appendSection(StringBuilder sb, String tag, String content) {
        if (content == null || content.isBlank()) return;
        sb.append("\n<").append(tag).append(">\n")
          .append(content)
          .append("\n</").append(tag).append(">\n");
    }

    /** 记忆读取失败不得阻断查询：记录日志并跳过该来源。 */
    private static String safe(java.util.function.Supplier<String> supplier, String name) {
        try {
            String value = supplier.get();
            return value == null ? "" : value;
        } catch (RuntimeException e) {
            log.warn("Failed to load {} memory for prompt: {}", name, e.getMessage());
            return "";
        }
    }
}
