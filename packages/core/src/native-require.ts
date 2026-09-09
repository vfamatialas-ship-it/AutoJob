/**
 * 外部模块加载器 —— 为单文件可执行程序（Node SEA）准备。
 *
 * ## 为什么需要它
 *
 * 打包成单文件可执行程序后，代码运行在 Node 的嵌入式环境里，
 * 那里的 `require` **只认内置模块**。原生扩展（better-sqlite3）与
 * 体积过大不宜打包的库（Playwright）都会报
 * `ERR_UNKNOWN_BUILTIN_MODULE`。
 *
 * 解法是用 `createRequire(process.execPath)` 建一个以可执行文件所在目录
 * 为基准的解析器 —— 这些模块会随安装包放在它旁边。
 *
 * ## 为什么不干脆全部打包进去
 *
 * - **better-sqlite3 是原生扩展**（.node 二进制），根本没法打进 JS bundle，
 *   而且必须按目标平台编译，所以 Windows 包要在 Windows 上构建。
 * - **Playwright 带浏览器内核约 150MB**，塞进安装包会让体积从几十 MB
 *   涨到两百多 MB。
 *
 * 开发环境下走正常的模块解析，行为与打包后一致，不用为此维护两套代码。
 */

import { createRequire } from 'node:module';

/** 是否运行在单文件可执行程序里 */
export const isSingleExecutable = (): boolean =>
  typeof process.execPath === 'string' && process.execPath.includes('autojob-worker');

const cache = new Map<string, unknown>();

/**
 * 加载一个不适合打包的外部模块。
 *
 * 先按可执行文件所在位置找（打包后的情形），失败再按调用方位置找（开发时）。
 * 两条路都走不通时抛出带修复建议的错误，而不是一句 MODULE_NOT_FOUND。
 */
export function requireExternal<T>(moduleName: string, fromUrl?: string): T {
  const cached = cache.get(moduleName);
  if (cached !== undefined) return cached as T;

  const attempts: Array<() => unknown> = [
    () => createRequire(process.execPath)(moduleName),
    ...(fromUrl === undefined ? [] : [() => createRequire(fromUrl)(moduleName)]),
    () => createRequire(`${process.cwd()}/`)(moduleName),
  ];

  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      const loaded = attempt();
      cache.set(moduleName, loaded);
      return loaded as T;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(
    `无法加载模块「${moduleName}」。\n` +
      `打包后它需要与可执行文件放在一起。\n` +
      `尝试过的路径均失败：\n${errors.map((line) => `  · ${line}`).join('\n')}`,
  );
}
