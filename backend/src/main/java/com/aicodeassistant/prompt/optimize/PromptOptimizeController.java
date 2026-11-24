package com.aicodeassistant.prompt.optimize;

import com.aicodeassistant.exception.RequestValidationException;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Optional;

/**
 * 「优化提示词」接口：把输入框里的草稿交给一个独立的小模型改写，结果由前端决定替换还是插入草稿。
 * <p>
 * 没有任何服务端配置时接口返回 400 {@code PROMPT_OPTIMIZE_DISABLED}，前端据此提示去设置页配置。
 */
@RestController
@RequestMapping("/api/prompt")
public class PromptOptimizeController {

    /** 草稿长度上限（字符）。再长的草稿优化后的收益很低，却要占用旁路模型的大部分输出预算。 */
    public static final int MAX_PROMPT_LENGTH = 20_000;
    static final int MAX_OUTPUT_TOKENS = 8192;

    static final String SYSTEM_PROMPT = """
            你是提示词优化助手。把用户给出的原始提示词改写得更清晰、更具体、更易于 AI 编码助手执行：
            补全缺失的上下文与约束，理顺结构与步骤，去掉歧义和冗余。
            必须遵守：
            1. 保持用户的原意和原语言（中文就写中文），不要添加用户没有提出的要求，不要替用户做决定。
            2. 原始提示词里的代码、路径、命令、报错信息原样保留，不要改写或省略。
            3. 只输出改写后的提示词正文，不要解释、不要前言和结语、不要 Markdown 代码围栏。
            4. 如果原始提示词已经足够清晰，只做最小必要的润色。
            """;

    public record OptimizeRequest(String prompt) {}

    public record OptimizeResponse(String optimized, String model, String providerName, String source) {}

    /** source 为 {@code scene_binding}（设置页的场景绑定）或 {@code env}（环境变量）；enabled=false 时其余字段为 null。 */
    public record StatusResponse(boolean enabled, String model, String providerName, String source) {}

    private final ExternalLlmClient client;

    public PromptOptimizeController(ExternalLlmClient client) {
        this.client = client;
    }

    @GetMapping("/optimize/status")
    public StatusResponse status() {
        Optional<ExternalLlmClient.Endpoint> endpoint = client.resolveEndpoint();
        if (endpoint.isEmpty()) return new StatusResponse(false, null, null, null);
        ExternalLlmClient.Endpoint e = endpoint.get();
        return new StatusResponse(true, e.model(), e.providerName(), e.source());
    }

    @PostMapping("/optimize")
    public OptimizeResponse optimize(@RequestBody OptimizeRequest request) {
        String prompt = request == null || request.prompt() == null ? "" : request.prompt().strip();
        if (prompt.isEmpty()) {
            throw new RequestValidationException("EMPTY_PROMPT", "提示词不能为空");
        }
        if (prompt.length() > MAX_PROMPT_LENGTH) {
            throw new RequestValidationException("PROMPT_TOO_LONG",
                    "提示词太长了（" + prompt.length() + " 字符），最多 " + MAX_PROMPT_LENGTH + " 字符");
        }
        Optional<ExternalLlmClient.Endpoint> endpoint = client.resolveEndpoint();
        if (endpoint.isEmpty()) {
            throw new RequestValidationException("PROMPT_OPTIMIZE_DISABLED",
                    "还没有配置优化提示词用的模型：请在设置的「场景分派」里给「提示词优化」选一个模型");
        }
        ExternalLlmClient.Endpoint e = endpoint.get();
        ExternalLlmClient.Completion completion =
                client.chat(e, SYSTEM_PROMPT, prompt, MAX_OUTPUT_TOKENS);
        return new OptimizeResponse(completion.text(), e.model(), e.providerName(), e.source());
    }
}
