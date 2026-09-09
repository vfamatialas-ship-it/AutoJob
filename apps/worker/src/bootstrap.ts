/**
 * Worker 独立进程的启动逻辑。
 *
 * 被两处使用：
 *   - `pnpm worker`（开发时直接跑源码）
 *   - 打包后的单文件可执行程序（Tauri 作为 sidecar 拉起）
 *
 * 刻意写成普通函数而不是顶层代码：Node SEA 只支持 CJS，
 * 而 CJS 不允许顶层 await。
 */

import { createLogger } from '@autojob/core';
import { startWorker } from './server.js';
import { buildRoutes, DEFAULT_CONFIG } from './routes.js';

/** 与 Rust 外壳约定的握手标记。格式固定，改动需同步改 main.rs */
export const READY_MARKER = 'AUTOJOB_WORKER_READY';

export async function startStandaloneWorker(): Promise<void> {
  const log = createLogger('worker');
  const port = Number(process.env['AUTOJOB_WORKER_PORT'] ?? '0');

  const handle = await startWorker(buildRoutes({ ...DEFAULT_CONFIG }), { port, logger: log });

  // 桌面端靠这一行拿到端口与令牌 —— 令牌全程不落磁盘
  process.stdout.write(`${READY_MARKER} ${handle.port} ${handle.token}\n`);
  log.info('Worker 已启动', { port: handle.port });

  const shutdown = (): void => {
    void handle.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
