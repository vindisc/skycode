import { afterEach, describe, expect, it, vi } from 'vitest';
import { request, ApiError } from './request';

afterEach(() => vi.unstubAllGlobals());

function respond(status: number, body: unknown) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
    } as Response;
}

describe('request', () => {
    it('adds the JSON header only when there is a body', async () => {
        const fetchMock = vi.fn().mockResolvedValue(respond(200, { ok: true }));
        vi.stubGlobal('fetch', fetchMock);

        await request('/api/x');
        await request('/api/x', { method: 'POST', body: JSON.stringify({ a: 1 }) });

        expect(fetchMock.mock.calls[0][1].headers).toBeUndefined();
        expect(fetchMock.mock.calls[1][1].headers).toEqual({ 'Content-Type': 'application/json' });
    });

    it('turns the unified error body into an ApiError with code and message', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(400, {
            error: { code: 'INVALID_PROVIDER', message: '至少要填写一个模型' },
        })));

        const failure = await request('/api/x').catch(error => error);

        expect(failure).toBeInstanceOf(ApiError);
        expect(failure).toMatchObject({ code: 'INVALID_PROVIDER', message: '至少要填写一个模型', status: 400 });
    });

    it('falls back to the status code when the error body is not the expected shape', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: false,
            status: 502,
            json: async () => { throw new Error('not json'); },
        }));

        await expect(request('/api/x')).rejects.toMatchObject({ message: '请求失败（HTTP 502）', code: 'REQUEST_FAILED' });
    });

    it('returns undefined for 204', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 204, json: async () => { throw new Error('no body'); } }));
        await expect(request('/api/x')).resolves.toBeUndefined();
    });
});
