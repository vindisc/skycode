package com.aicodeassistant.config.database;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.annotation.Order;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * 在全局库里建 settings 键值表，给设置页用（服务商池、场景绑定），按 category 分区。
 * 服务商池的值里只有 API Key 字段是加密的；场景绑定只存引用，不含密钥。
 */
@Component
@Order(28)
public final class V028_CreateSettings implements Migration {

    private static final String CHECKSUM =
            MigrationChecksums.sha256("v028-create-global-settings-v1");

    private final JdbcTemplate jdbc;

    public V028_CreateSettings(
            @Qualifier("globalJdbcTemplate") JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public Scope scope() {
        return Scope.GLOBAL;
    }

    @Override
    public String checksum() {
        return CHECKSUM;
    }

    @Override
    public void execute() {
        jdbc.execute("""
                CREATE TABLE settings (
                    category   TEXT NOT NULL,
                    key        TEXT NOT NULL,
                    value      TEXT NOT NULL,
                    metadata   TEXT,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (category, key)
                )
                """);
    }

    @Override
    public void validate() {
        Integer tableCount = jdbc.queryForObject("""
                SELECT COUNT(*) FROM sqlite_master
                WHERE type = 'table' AND name = 'settings'
                """, Integer.class);
        List<ColumnDefinition> columns = jdbc.query(
                "PRAGMA table_info('settings')",
                (rs, row) -> new ColumnDefinition(
                        rs.getString("name"),
                        rs.getString("type"),
                        rs.getInt("notnull") != 0,
                        rs.getInt("pk")));

        boolean columnsValid = columns.size() == 5
                && column(columns, "category", "TEXT", true, 1)
                && column(columns, "key", "TEXT", true, 2)
                && column(columns, "value", "TEXT", true, 0)
                && column(columns, "metadata", "TEXT", false, 0)
                && column(columns, "updated_at", "TEXT", true, 0);

        if (tableCount == null || tableCount != 1 || !columnsValid) {
            throw new IllegalStateException("V028 settings schema postcondition failed");
        }
    }

    private boolean column(
            List<ColumnDefinition> columns,
            String name,
            String type,
            boolean notNull,
            int primaryKeyPosition) {
        return columns.stream().anyMatch(column ->
                name.equals(column.name)
                        && type.equalsIgnoreCase(column.type)
                        && column.notNull == notNull
                        && column.primaryKeyPosition == primaryKeyPosition);
    }

    private record ColumnDefinition(
            String name,
            String type,
            boolean notNull,
            int primaryKeyPosition
    ) {}
}
