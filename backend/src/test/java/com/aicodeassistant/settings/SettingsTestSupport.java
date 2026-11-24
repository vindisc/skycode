package com.aicodeassistant.settings;

import com.aicodeassistant.config.database.V028_CreateSettings;
import com.aicodeassistant.mcp.TokenEncryptionService;
import org.springframework.jdbc.core.JdbcTemplate;
import org.sqlite.SQLiteDataSource;

import java.nio.file.Path;
import java.util.Base64;

/**
 * 设置相关测试的公共夹具：一个跑过 V028 迁移的临时全局库，和一把固定的加密密钥。
 * 密钥走 Spring 配置这条来源，不会去读写用户 HOME 下的密钥文件。
 */
public final class SettingsTestSupport {

    /** 32 字节固定密钥的 Base64，只用于测试。 */
    public static final String ENCRYPTION_KEY =
            Base64.getEncoder().encodeToString(new byte[32]);

    private SettingsTestSupport() {}

    public static JdbcTemplate globalDb(Path tempDir) {
        SQLiteDataSource source = new SQLiteDataSource();
        source.setUrl("jdbc:sqlite:" + tempDir.resolve("global.db"));
        JdbcTemplate jdbc = new JdbcTemplate(source);
        V028_CreateSettings migration = new V028_CreateSettings(jdbc);
        migration.execute();
        migration.validate();
        return jdbc;
    }

    public static TokenEncryptionService encryption() {
        return new TokenEncryptionService(ENCRYPTION_KEY);
    }
}
