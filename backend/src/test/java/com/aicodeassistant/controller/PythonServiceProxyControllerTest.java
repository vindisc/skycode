package com.aicodeassistant.controller;

import com.aicodeassistant.service.PythonCapabilityAwareClient;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

/**
 * 前端直接发给 Python 服务的请求由 Java 转发：方法、路径、查询串、请求体、内容类型都要原样过去。
 */
class PythonServiceProxyControllerTest {

    private MockWebServer python;
    private PythonServiceProxyController controller;

    @BeforeEach
    void setUp() throws IOException {
        python = new MockWebServer();
        python.start();
        controller = new PythonServiceProxyController(python.url("").toString(), mock(PythonCapabilityAwareClient.class));
    }

    @AfterEach
    void tearDown() throws IOException {
        python.shutdown();
    }

    @Test
    void forwardsJsonPostsWithPathQueryAndContentType() throws Exception {
        python.enqueue(new MockResponse().setHeader("Content-Type", "application/json").setBody("{\"tree\":[]}"));

        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/files/tree");
        request.setQueryString("depth=2&hidden=true");
        request.setContentType("application/json");
        request.addHeader("Accept", "application/json");
        ResponseEntity<byte[]> response = controller.forward(request, "{\"path\":\"/app/workspace\"}".getBytes(StandardCharsets.UTF_8));

        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getHeaders().getContentType()).isEqualTo(MediaType.APPLICATION_JSON);
        assertThat(new String(response.getBody(), StandardCharsets.UTF_8)).isEqualTo("{\"tree\":[]}");
        RecordedRequest recorded = python.takeRequest();
        assertThat(recorded.getMethod()).isEqualTo("POST");
        assertThat(recorded.getPath()).isEqualTo("/api/files/tree?depth=2&hidden=true");
        assertThat(recorded.getHeader("Content-Type")).isEqualTo("application/json");
        assertThat(recorded.getHeader("Accept")).isEqualTo("application/json");
        assertThat(recorded.getBody().readUtf8()).isEqualTo("{\"path\":\"/app/workspace\"}");
    }

    @Test
    void forwardsGetRequestsAndPassesUpstreamErrorsThrough() throws Exception {
        python.enqueue(new MockResponse().setResponseCode(422).setHeader("Content-Type", "application/json")
                .setBody("{\"detail\":\"bad\"}"));

        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/git/status");
        ResponseEntity<byte[]> response = controller.forward(request, null);

        assertThat(response.getStatusCode().value()).isEqualTo(422);
        assertThat(new String(response.getBody(), StandardCharsets.UTF_8)).isEqualTo("{\"detail\":\"bad\"}");
        RecordedRequest recorded = python.takeRequest();
        assertThat(recorded.getMethod()).isEqualTo("GET");
        assertThat(recorded.getPath()).isEqualTo("/api/git/status");
        assertThat(recorded.getHeader("Authorization")).isNull();
    }

    @Test
    void answers503WithAReadableMessageWhenThePythonServiceIsDown() throws Exception {
        // 一个没人监听的端口
        var down = new PythonServiceProxyController("http://127.0.0.1:1", mock(PythonCapabilityAwareClient.class));

        ResponseEntity<byte[]> response = down.forward(new MockHttpServletRequest("GET", "/api/analysis/x"), null);

        assertThat(response.getStatusCode().value()).isEqualTo(503);
        assertThat(response.getHeaders().getContentType()).isEqualTo(MediaType.APPLICATION_JSON);
        assertThat(new String(response.getBody(), StandardCharsets.UTF_8)).contains("PYTHON_SERVICE_UNAVAILABLE");
    }

}
