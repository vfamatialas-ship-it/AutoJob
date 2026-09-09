/**
 * Worker 包的公开入口。
 *
 * 这里**只导出**，不做任何启动动作 —— 独立进程的入口在 bootstrap.ts。
 * 分开的原因很实际：Node SEA（打单文件可执行程序）只支持 CJS，
 * 而 CJS 不支持顶层 await 与 import.meta。把启动逻辑收进一个函数，
 * 两种形态就都能用。
 */

export * from './server.js';
export * from './routes.js';
export * from './bootstrap.js';
