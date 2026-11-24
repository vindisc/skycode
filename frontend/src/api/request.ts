/**
 * REST 请求的小封装：补 JSON 请求头，把后端统一的错误格式
 * { error: { code, message } } 还原成带 message 的 Error，供界面直接展示。
 * 走同源的 fetch，沿用 RemoteAccessSecurityFilter 签发的会话 Cookie。
 */

export class ApiError extends Error {
    readonly code: string;
    readonly status: number;

    constructor(code: string, message: string, status: number) {
        super(message);
        this.name = 'ApiError';
        this.code = code;
        this.status = status;
    }
}

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, {
        ...init,
        headers: init?.body != null
            ? { 'Content-Type': 'application/json', ...(init.headers ?? {}) }
            : init?.headers,
    });
    if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
        throw new ApiError(
            body?.error?.code ?? 'REQUEST_FAILED',
            body?.error?.message || `请求失败（HTTP ${response.status}）`,
            response.status,
        );
    }
    // 204 没有 body
    return response.status === 204 ? (undefined as T) : response.json() as Promise<T>;
}
