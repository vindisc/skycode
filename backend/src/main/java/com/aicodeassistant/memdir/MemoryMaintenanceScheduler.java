package com.aicodeassistant.memdir;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * MemoryMaintenanceScheduler — 个人记忆的每日维护。
 * <p>
 * 2026-11-28 接线：此前 {@link MemdirService#purgeExpiredMemories()}（90 天 TTL）
 * 与压缩逻辑均已实现但无调度器，时间衰减与容量收敛形同虚设。每天 04:30 执行：
 * <ol>
 *     <li>清理超过 90 天的 AUTO/TOOL 记忆（USER 与无时间戳条目永不过期）；</li>
 *     <li>容量超过 80% 时压缩 AUTO/TOOL 条目（USER 条目不动，见 compactMemories）。</li>
 * </ol>
 * 只操作个人记忆文件（~/.ai-code-assistant/MEMORY.md）；
 * 项目记忆（skycode.md / skycode.local.md）由人工维护，不自动改写。
 */
@Component
public class MemoryMaintenanceScheduler {

    private static final Logger log = LoggerFactory.getLogger(MemoryMaintenanceScheduler.class);

    private final MemdirService memdirService;

    public MemoryMaintenanceScheduler(MemdirService memdirService) {
        this.memdirService = memdirService;
    }

    /** 每天 04:30 执行记忆维护（过期清理 + 超容量压缩）。 */
    @Scheduled(cron = "0 30 4 * * *")
    public void dailyMaintenance() {
        try {
            int purged = memdirService.purgeExpiredMemories();
            boolean compacted = memdirService.compactIfNeeded();
            if (purged > 0 || compacted) {
                log.info("Memory daily maintenance done: purged={}, compacted={}", purged, compacted);
            }
        } catch (RuntimeException e) {
            // 维护失败不拖垮调度线程池，下一天会再试
            log.warn("Memory daily maintenance failed: {}", e.getMessage());
        }
    }
}
