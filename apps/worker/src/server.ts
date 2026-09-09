/**
 * 本地 Worker —— PRD §46 / §47。
 *
 * 「不要将整个自动化系统写进前端。」
 *
 * ## 为什么需要它
 *
 * Playwright、SQLite、ATS Adapter 都是 Node 侧的东西，跑不进 Tauri 的 WebView。
 * 所以桌面端只做界面，真正干活的是这个进程。两者通过本地 HTTP 通信。
 *
 * ## 安全边界
 *
 * - **只监听 127.0.0.1**，不接受外部连接
 * - **启动时生成一次性令牌**，前端必须带上才能调用 —— 防止本机其他程序
 *   （比如浏览器里的恶意网页）通过 localhost 访问你的简历数据
 * - 所有个人数据留在本地，Worker 不向任何外部服务发送
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { createLogger, maskText, toAutoJobError, type Logger } from '@autojob/core';
import type { RouteTable } from './routes.js';

export interface WorkerOptions {
  readonly port?: number;
  readonly logger?: Logger;
  /** 传入固定令牌便于测试；生产环境应让它随机生成 */
  readonly token?: string;
}

export interface WorkerHandle {
  readonly port: number;
  readonly token: string;
  readonly baseUrl: string;
  close(): Promise<void>;
}

const readBody = async (request: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
  } catch {
    return {};
  }
};

/**
 * 允许调用 Worker 的来源。
 *
 * 桌面端的 WebView 与 Worker 虽然同机，但**不同源**：各平台给 WebView 的
 * origin 不一样，而 `http://127.0.0.1:<port>` 又是第三个源。所以必须显式放行，
 * 否则浏览器内核会拦下响应，界面只能看到一句 "Failed to fetch"。
 *
 * 允许列表之外的来源一律回 `null` —— 网页仍然探测不到这个端口。
 */
export const ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  'tauri://localhost', // Linux / macOS 打包后
  'http://tauri.localhost', // Windows 打包后
  'https://tauri.localhost',
  'http://localhost:5183', // 开发时的 Vite
]);

const allowOriginFor = (origin: string | undefined): string =>
  origin !== undefined && ALLOWED_ORIGINS.has(origin) ? origin : 'null';

const sendJson = (
  response: ServerResponse,
  status: number,
  body: unknown,
  allowOrigin = 'null',
): void => {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'access-control-allow-origin': allowOrigin,
    // 放行列表随请求变化，缓存必须按 Origin 分桶
    vary: 'Origin',
  });
  response.end(payload);
};

export function createWorkerServer(routes: RouteTable, options: WorkerOptions = {}): Server {
  const token = options.token ?? randomBytes(24).toString('hex');
  const log = options.logger ?? createLogger('worker');

  return createServer((request, response) => {
    void (async (): Promise<void> => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const path = url.pathname;
      const allowOrigin = allowOriginFor(request.headers.origin);

      /*
       * 预检必须在鉴权之前放行。
       *
       * `x-autojob-token` 是自定义请求头，浏览器会先发一个 OPTIONS 探路，
       * 而**预检请求本身不带任何自定义头** —— 若按普通请求校验令牌，
       * 它必然 401，真正的 POST 根本发不出去。放行预检不泄露任何数据：
       * 响应里只有允许的方法与头名，数据仍然由令牌把守。
       */
      if (request.method === 'OPTIONS') {
        response.writeHead(204, {
          'access-control-allow-origin': allowOrigin,
          'access-control-allow-methods': 'POST, GET, OPTIONS',
          'access-control-allow-headers': 'content-type, x-autojob-token',
          'access-control-max-age': '600',
          vary: 'Origin',
        });
        response.end();
        return;
      }

      // 健康检查不需要令牌：桌面端要靠它确认 Worker 起来了
      if (path === '/health') {
        sendJson(response, 200, { ok: true, version: '0.0.1' }, allowOrigin);
        return;
      }

      if (request.headers['x-autojob-token'] !== token) {
        log.warn('拒绝无令牌的请求', { path });
        sendJson(response, 401, { error: '缺少或错误的访问令牌' }, allowOrigin);
        return;
      }

      const handler = routes[path];
      if (handler === undefined) {
        sendJson(response, 404, { error: `未知接口：${path}` }, allowOrigin);
        return;
      }

      try {
        const body = await readBody(request);
        const result = await handler(body);
        sendJson(response, 200, result, allowOrigin);
      } catch (thrown) {
        const error = toAutoJobError(thrown);
        // 错误信息可能含个人数据，脱敏后再记录与返回
        log.error(maskText(error.message), { path, code: error.code });
        sendJson(
          response,
          500,
          {
            error: maskText(error.message),
            code: error.code,
            hint: error.hint,
          },
          allowOrigin,
        );
      }
    })();
  });
}

export async function startWorker(
  routes: RouteTable,
  options: WorkerOptions = {},
): Promise<WorkerHandle> {
  const token = options.token ?? randomBytes(24).toString('hex');
  const server = createWorkerServer(routes, { ...options, token });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    // 只绑定回环地址：外部网络无论如何都连不上
    server.listen(options.port ?? 0, '127.0.0.1', resolve);
  });

  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('无法确定 Worker 端口');

  return {
    port: address.port,
    token,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
