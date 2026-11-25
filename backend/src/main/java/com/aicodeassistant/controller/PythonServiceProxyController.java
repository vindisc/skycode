package com.aicodeassistant.controller;

import com.aicodeassistant.service.PythonCapabilityAwareClient;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;

import jakarta.servlet.http.HttpServletRequest;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

import java.io.IOException;
import java.time.Duration;

/**
 * 把前端直接发给 Python 服务的那几类请求转过去。
 * <p>
 * 文件树、代码洞察、复杂度、变更影响这几个面板是前端直接调 Python 服务的 {@code /api/files}、
 * {@code /api/git}、{@code /api/code-quality}、{@code /api/analysis}。开发模式下由 Vite 把这些路径
 * 代理到 Python 的端口；用 Docker 部署时页面由 Java 提供，请求打到 Java 的 8080，以前在这里直接 404，
 * 所以这几块功能在 Docker 里一直是坏的——和 Python 服务起没起来无关。
 * <p>
 * Java 自己在这些前缀下已有的接口（比如 {@code /api/files/pick}）是更精确的映射，仍然优先命中，
 * 不会走到这里。
 */
@RestController
public class PythonServiceProxyController {

    private static final Logger log = LoggerFactory.getLogger(PythonServiceProxyController.class);

    private static final Duration READ_TIMEOUT = Duration.ofMinutes(2);

    private final String baseUrl;
    private final OkHttpClient client;
    private final PythonCapabilityAwareClient pythonClient;

    public PythonServiceProxyController(
            @Value("http://${python.service.host:127.0.0.1}:${python.service.port:8000}") String baseUrl,
            PythonCapabilityAwareClient pythonClient) {
        this.baseUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
        this.pythonClient = pythonClient;
        this.client = new OkHttpClient.Builder()
                .connectTimeout(Duration.ofSeconds(5))
                .readTimeout(READ_TIMEOUT)
                .callTimeout(READ_TIMEOUT)
                .build();
    }

    @RequestMapping(path = {"/api/files/**", "/api/git/**", "/api/code-quality/**", "/api/analysis/**"},
                    method = {RequestMethod.GET, RequestMethod.POST, RequestMethod.PUT, RequestMethod.PATCH,
                            RequestMethod.DELETE})
    public ResponseEntity<byte[]> forward(HttpServletRequest request,
                                          @RequestBody(required = false) byte[] body) throws IOException {
        String query = request.getQueryString();
        String url = baseUrl + request.getRequestURI() + (query == null ? "" : "?" + query);
        // Spring 和 OkHttp 都有一个叫 MediaType 的类，这里要的是 OkHttp 的
        String contentType = request.getHeader(HttpHeaders.CONTENT_TYPE);
        okhttp3.RequestBody outgoingBody = body == null || body.length == 0 ? null
                : okhttp3.RequestBody.create(body, okhttp3.MediaType.parse(
                        contentType == null ? MediaType.APPLICATION_OCTET_STREAM_VALUE : contentType));
        Request.Builder outgoing = new Request.Builder().url(url)
                .method(request.getMethod(), outgoingBody == null && !request.getMethod().equals("GET")
                        ? okhttp3.RequestBody.create(new byte[0], null) : outgoingBody);
        // 只带内容协商相关的头；Python 服务在本机回环地址上，不做鉴权，也不需要 Cookie
        copyHeader(request, outgoing, HttpHeaders.CONTENT_TYPE);
        copyHeader(request, outgoing, HttpHeaders.ACCEPT);
        copyHeader(request, outgoing, "X-Session-Id");

        try (Response response = client.newCall(outgoing.build()).execute()) {
            byte[] bytes = response.body() == null ? new byte[0] : response.body().bytes();
            ResponseEntity.BodyBuilder result = ResponseEntity.status(response.code());
            String responseContentType = response.header(HttpHeaders.CONTENT_TYPE);
            if (responseContentType != null) result.header(HttpHeaders.CONTENT_TYPE, responseContentType);
            String cacheControl = response.header(HttpHeaders.CACHE_CONTROL);
            if (cacheControl != null) result.header(HttpHeaders.CACHE_CONTROL, cacheControl);
            return result.body(bytes);
        } catch (IOException failure) {
            log.warn("Python service unreachable while forwarding {} {}: {}", request.getMethod(),
                    request.getRequestURI(), failure.getMessage());
            return ResponseEntity.status(503).contentType(MediaType.APPLICATION_JSON).body((
                    "{\"error\":{\"code\":\"PYTHON_SERVICE_UNAVAILABLE\",\"message\":\"Python 服务没有在运行，"
                            + "这个功能暂时用不了。可以到「设置 › 运行状态」里看它的状态。\"}}")
                    .getBytes(java.nio.charset.StandardCharsets.UTF_8));
        }
    }

    private static void copyHeader(HttpServletRequest request, Request.Builder outgoing, String name) {
        String value = request.getHeader(name);
        if (value != null) outgoing.header(name, value);
    }
}
