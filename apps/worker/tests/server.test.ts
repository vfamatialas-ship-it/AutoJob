import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startWorker, type WorkerHandle } from '../src/server.js';
import type { RouteTable } from '../src/routes.js';

const routes: RouteTable = {
  '/echo': (body) => ({ received: body }),
  '/boom': () => {
    throw new Error('联系方式 13812341234 出错了');
  },
};

let worker: WorkerHandle;

beforeAll(async () => {
  worker = await startWorker(routes, { token: 'test-token' });
});

afterAll(async () => {
  await worker?.close();
});

const call = (path: string, init: RequestInit = {}): Promise<Response> =>
  fetch(`${worker.baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    ...init,
  });

describe('访问令牌', () => {
  it('健康检查不需要令牌 —— 桌面端要靠它确认 Worker 起来了', async () => {
    const response = await fetch(`${worker.baseUrl}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
  });

  it('无令牌的请求被拒绝', async () => {
    const response = await call('/echo', { body: '{}' });
    expect(response.status).toBe(401);
  });

  it('错误令牌被拒绝', async () => {
    const response = await call('/echo', {
      headers: { 'x-autojob-token': 'wrong' },
      body: '{}',
    });
    expect(response.status).toBe(401);
  });

  it('正确令牌放行', async () => {
    const response = await call('/echo', {
      headers: { 'x-autojob-token': 'test-token' },
      body: JSON.stringify({ hello: 'world' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: { hello: 'world' } });
  });
});

describe('只监听回环地址', () => {
  it('baseUrl 指向 127.0.0.1，外部网络无法连接', () => {
    expect(worker.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });
});

describe('错误处理', () => {
  it('未知接口返回 404 而不是崩溃', async () => {
    const response = await call('/nope', {
      headers: { 'x-autojob-token': 'test-token' },
      body: '{}',
    });
    expect(response.status).toBe(404);
  });

  it('异常信息经过脱敏后才返回 —— 界面可能被截图', async () => {
    const response = await call('/boom', {
      headers: { 'x-autojob-token': 'test-token' },
      body: '{}',
    });

    expect(response.status).toBe(500);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toContain('138****1234');
    expect(payload.error).not.toContain('13812341234');
  });

  it('非法 JSON 请求体不会让服务崩溃', async () => {
    const response = await call('/echo', {
      headers: { 'x-autojob-token': 'test-token' },
      body: '{ 坏掉的',
    });
    expect(response.status).toBe(200);
  });
});

describe('跨源访问', () => {
  it('预检请求不带令牌也要放行 —— 否则真正的 POST 根本发不出去', async () => {
    const response = await fetch(`${worker.baseUrl}/echo`, {
      method: 'OPTIONS',
      headers: {
        origin: 'tauri://localhost',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'x-autojob-token',
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('tauri://localhost');
    expect(response.headers.get('access-control-allow-headers')).toContain('x-autojob-token');
  });

  it('桌面端 WebView 的来源被放行', async () => {
    const response = await call('/echo', {
      headers: { 'x-autojob-token': 'test-token', origin: 'tauri://localhost' },
      body: '{}',
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('tauri://localhost');
  });

  it('其他来源拿不到放行头 —— 网页借 localhost 探测会被浏览器拦下', async () => {
    const response = await call('/echo', {
      headers: { 'x-autojob-token': 'test-token', origin: 'https://evil.example.com' },
      body: '{}',
    });

    // 令牌对了所以服务端会响应，但浏览器读不到：allow-origin 不匹配
    expect(response.headers.get('access-control-allow-origin')).toBe('null');
  });

  it('放行响应带 Vary: Origin —— 允许列表随来源变化，不能被缓存串了', async () => {
    const response = await fetch(`${worker.baseUrl}/health`, { headers: { origin: 'tauri://localhost' } });
    expect(response.headers.get('vary')).toBe('Origin');
  });
});
