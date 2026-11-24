package com.aicodeassistant.config.database;

import com.aicodeassistant.settings.SettingsRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.sqlite.SQLiteDataSource;

import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * V028：全局库的 settings 键值表。主键必须是 (category, key)，同分区同键只能有一行。
 */
class V028CreateSettingsTest {

    @TempDir
    Path temp;

    @Test
    void createsGlobalScopedTableWithCompositePrimaryKey() {
        JdbcTemplate jdbc = db("global.db");
        V028_CreateSettings migration = new V028_CreateSettings(jdbc);

        assertThat(migration.scope()).isEqualTo(Migration.Scope.GLOBAL);
        migration.execute();
        migration.validate();

        jdbc.update("""
                INSERT INTO settings(category, key, value, metadata, updated_at)
                VALUES (?, ?, ?, ?, ?)
                """, "llm_provider", "zhipu", "{}", null, "2026-11-25T00:00:00Z");
        // 同分区同键违反主键
        assertThatThrownBy(() -> jdbc.update("""
                INSERT INTO settings(category, key, value, metadata, updated_at)
                VALUES (?, ?, ?, ?, ?)
                """, "llm_provider", "zhipu", "{}", null, "2026-11-25T00:00:01Z"))
                .isInstanceOf(DataAccessException.class);
        // 不同分区可以同名
        jdbc.update("""
                INSERT INTO settings(category, key, value, metadata, updated_at)
                VALUES (?, ?, ?, ?, ?)
                """, "scene_binding", "zhipu", "{}", null, "2026-11-25T00:00:02Z");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM settings", Integer.class)).isEqualTo(2);
    }

    @Test
    void repositoryRoundTripsAgainstTheMigratedTable() {
        JdbcTemplate jdbc = db("repo.db");
        new V028_CreateSettings(jdbc).execute();
        SettingsRepository repository = new SettingsRepository(jdbc);

        assertThat(repository.find("llm_provider", "zhipu")).isEmpty();
        repository.upsert("llm_provider", "zhipu", "first", null);
        repository.upsert("llm_provider", "zhipu", "second", "meta");
        repository.upsert("llm_provider", "other", "x", null);

        var stored = repository.find("llm_provider", "zhipu").orElseThrow();
        assertThat(stored.value()).isEqualTo("second");
        assertThat(stored.metadata()).isEqualTo("meta");
        assertThat(stored.updatedAt()).isNotBlank();
        assertThat(repository.list("llm_provider")).extracting(SettingsRepository.StoredSetting::key)
                .containsExactly("zhipu", "other");

        assertThat(repository.delete("llm_provider", "zhipu")).isTrue();
        assertThat(repository.delete("llm_provider", "zhipu")).isFalse();
        assertThat(repository.find("llm_provider", "zhipu")).isEmpty();
    }

    @Test
    void validationRejectsAMissingTableAndANameOnlyMatch() {
        JdbcTemplate empty = db("empty.db");
        assertThatThrownBy(() -> new V028_CreateSettings(empty).validate())
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("settings schema postcondition failed");

        JdbcTemplate weak = db("weak.db");
        weak.execute("CREATE TABLE settings (category TEXT, key TEXT, value TEXT)");
        assertThatThrownBy(() -> new V028_CreateSettings(weak).validate())
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("settings schema postcondition failed");
    }

    private JdbcTemplate db(String fileName) {
        SQLiteDataSource source = new SQLiteDataSource();
        source.setUrl("jdbc:sqlite:" + temp.resolve(fileName));
        return new JdbcTemplate(source);
    }
}
