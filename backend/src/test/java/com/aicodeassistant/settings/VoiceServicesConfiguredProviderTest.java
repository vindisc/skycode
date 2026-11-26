package com.aicodeassistant.settings;

import com.aicodeassistant.llm.LlmProvidersProperties;
import com.aicodeassistant.tts.TtsService;
import com.aicodeassistant.asr.AsrService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;

import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;

import static com.aicodeassistant.settings.SettingsTestSupport.encryption;
import static com.aicodeassistant.settings.SettingsTestSupport.globalDb;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * 语音朗读和识别写死用百炼（dashscope）这个服务商。以前它们只读配置文件，
 * 用户在设置页里给百炼填了密钥也不认；现在读的是生效配置。
 */
class VoiceServicesConfiguredProviderTest {

    @TempDir
    Path temp;

    private ConfiguredProviderService configured;

    @BeforeEach
    void setUp() {
        JdbcTemplate jdbc = globalDb(temp);
        var templates = new LinkedHashMap<String, LlmProvidersProperties.ProviderConfig>();
        templates.put("dashscope", new LlmProvidersProperties.ProviderConfig("sk-env-dashscope-key", "https://dashscope.aliyuncs.com/compatible-mode/v1",
                "qwen3.8-max-0902", List.of("qwen3.8-max-0902")));
        configured = new ConfiguredProviderService(new LlmProvidersProperties(templates), new SettingsRepository(jdbc),
                encryption(), new ObjectMapper());
        configured.seedIfNeeded();
    }

    @Test
    void voiceServicesUseTheKeyStoredInTheSettingsStore() {
        ObjectMapper mapper = new ObjectMapper();
        var tts = new TtsService(configured, mapper);
        var asr = new AsrService(configured, mapper);
        // 首次导入把 .env 里的 dashscope 密钥带进来了，语音能力直接可用
        assertThat(tts.isAvailable()).isTrue();
        assertThat(asr.isAvailable()).isTrue();

        // 在设置页上换了密钥：立即生效
        configured.save("dashscope", new ConfiguredProviderService.ConfiguredProviderInput(
                "sk-page-dashscope-key", null, null, null, null));
        assertThat(configured.effective("dashscope").orElseThrow().apiKey()).isEqualTo("sk-page-dashscope-key");
        assertThat(tts.isAvailable()).isTrue();

        // 删掉这个服务商：语音能力随之下线
        configured.delete("dashscope");
        assertThat(tts.isAvailable()).isFalse();
        assertThat(asr.isAvailable()).isFalse();
    }
}
