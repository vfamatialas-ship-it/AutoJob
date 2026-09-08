/**
 * Mock 站点静态服务器 —— 零依赖，用 Node 原生 http。
 *
 * 之所以不引 express：这只是给测试提供几个静态页面，
 * 多一个依赖就多一份维护成本，也多一份供应链风险。
 *
 * 用法：
 *   pnpm mock:serve            # 手动启动，浏览器里看页面
 *   startMockServer()          # 测试里以随机端口启动
 */

import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOCK_SITES } from './sites/manifest.js';

const SITES_ROOT = fileURLToPath(new URL('./sites', import.meta.url));

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
};

export interface MockServer {
  readonly baseUrl: string;
  readonly port: number;
  close(): Promise<void>;
}

/** 目录穿越防护：解析后的路径必须仍在 SITES_ROOT 内 */
function resolveSafePath(urlPath: string): string | undefined {
  const decoded = decodeURIComponent(urlPath.split('?')[0] ?? '/');
  const relative = normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const resolved = join(SITES_ROOT, relative);
  return resolved.startsWith(SITES_ROOT) ? resolved : undefined;
}

function createMockServer(): Server {
  return createServer((request, response) => {
    void (async (): Promise<void> => {
      const urlPath = request.url ?? '/';

      if (urlPath === '/' || urlPath === '/index.html') {
        response.writeHead(200, { 'content-type': MIME_TYPES['.html'] as string });
        response.end(renderIndex());
        return;
      }

      const filePath = resolveSafePath(urlPath);
      if (filePath === undefined) {
        response.writeHead(403).end('Forbidden');
        return;
      }

      try {
        const body = await readFile(filePath);
        const mime = MIME_TYPES[extname(filePath)] ?? 'application/octet-stream';
        response.writeHead(200, { 'content-type': mime, 'cache-control': 'no-store' });
        response.end(body);
      } catch {
        response.writeHead(404, { 'content-type': MIME_TYPES['.html'] as string });
        response.end('<h1>404</h1><p>Mock 站点中没有这个页面</p>');
      }
    })();
  });
}

function renderIndex(): string {
  const items = MOCK_SITES.map(
    (site) =>
      `  <li><a href="${site.applyPath}">${site.name}</a>\n    <ul>${site.quirks
        .map((quirk) => `<li>${quirk}</li>`)
        .join('')}</ul></li>`,
  ).join('\n');

  return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>AutoJob Mock 招聘站</title>
<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:48px auto;padding:0 16px;line-height:1.7}
a{color:#0b62d0;font-weight:600}li{margin:6px 0}ul ul li{font-size:13px;color:#666;font-weight:400}</style>
</head><body>
<h1>AutoJob Mock 招聘站</h1>
<p>这些页面专门制造真实招聘网站中的各类困难，用于测试字段解析与语义映射。</p>
<ul>
${items}
</ul>
</body></html>`;
}

/** 以随机可用端口启动，返回 baseUrl。测试结束记得 close()。 */
export async function startMockServer(port = 0): Promise<MockServer> {
  const server = createMockServer();

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('无法确定 Mock 服务器端口');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

// 直接运行时以固定端口启动，方便手工查看页面
if (
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(new URL(`file://${process.argv[1]}`).pathname)
) {
  const server = await startMockServer(4173);
  process.stdout.write(`Mock 招聘站已启动：${server.baseUrl}\n按 Ctrl+C 退出\n`);
}
