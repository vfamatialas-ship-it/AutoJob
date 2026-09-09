/**
 * 独立进程入口。CJS 友好：没有顶层 await，没有 import.meta。
 * 打包成单文件可执行程序时以本文件为入口。
 */
import { startStandaloneWorker } from './bootstrap.js';

void startStandaloneWorker().catch((error: unknown) => {
  process.stderr.write(`Worker 启动失败：${String(error)}\n`);
  process.exit(1);
});
