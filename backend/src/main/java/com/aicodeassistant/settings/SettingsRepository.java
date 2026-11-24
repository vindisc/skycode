package com.aicodeassistant.settings;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;

/**
 * 设置页的键值存储（全局库 settings 表，按 category 分区）。
 * <p>
 * 这里只负责读写原始字符串，不理解值的含义；加密与反序列化由各 Service 负责。
 */
@Repository
public class SettingsRepository {

    /** 服务商池：值是 {@link Setting.LlmProviderConfig} 的 JSON，其中 apiKey 字段加密保存。 */
    public static final String CATEGORY_LLM_PROVIDER = "llm_provider";
    /** 场景绑定：值只存 {"providerKey","modelId"} 引用，不含密钥，因此无需加密。 */
    public static final String CATEGORY_SCENE_BINDING = "scene_binding";

    private final JdbcTemplate jdbc;

    public SettingsRepository(@Qualifier("globalJdbcTemplate") JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public record StoredSetting(
            String category,
            String key,
            String value,
            String metadata,
            String updatedAt
    ) {}

    public Optional<StoredSetting> find(String category, String key) {
        return jdbc.query(
                """
                SELECT category, key, value, metadata, updated_at FROM settings
                WHERE category = ? AND key = ?
                """,
                (rs, row) -> new StoredSetting(
                        rs.getString("category"),
                        rs.getString("key"),
                        rs.getString("value"),
                        rs.getString("metadata"),
                        rs.getString("updated_at")),
                category, key).stream().findFirst();
    }

    /** 按写入顺序返回某个分区下的全部条目（rowid 即插入顺序，没有单独的排序列）。 */
    public List<StoredSetting> list(String category) {
        return jdbc.query(
                """
                SELECT category, key, value, metadata, updated_at FROM settings
                WHERE category = ?
                ORDER BY rowid
                """,
                (rs, row) -> new StoredSetting(
                        rs.getString("category"),
                        rs.getString("key"),
                        rs.getString("value"),
                        rs.getString("metadata"),
                        rs.getString("updated_at")),
                category);
    }

    public void upsert(String category, String key, String value, String metadata) {
        jdbc.update(
                """
                INSERT INTO settings (category, key, value, metadata, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(category, key) DO UPDATE SET
                    value = excluded.value,
                    metadata = excluded.metadata,
                    updated_at = excluded.updated_at
                """,
                category, key, value, metadata, Instant.now().toString());
    }

    /** @return 是否真的删掉了条目 */
    public boolean delete(String category, String key) {
        return jdbc.update(
                "DELETE FROM settings WHERE category = ? AND key = ?",
                category, key) > 0;
    }
}
