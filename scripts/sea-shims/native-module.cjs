/**
 * 原生/大体积模块的运行时解析垫片。
 *
 * ## 为什么需要它
 *
 * 打包成单文件可执行程序后，Node 嵌入环境的 `require` 只认内置模块。
 * 我们自己的代码可以改成 `requireExternal` 懒加载，但**第三方库不能改** ——
 * 比如 drizzle-orm 的 better-sqlite3 驱动就在模块顶层直接 require 它。
 *
 * 所以打包时用 esbuild 的 alias 把这些模块指到本文件，
 * 由它在运行时从可执行文件旁边解析。
 *
 * 模块名通过环境变量注入（打包时 --define），避免 esbuild 把它当成
 * 静态依赖再次解析，形成死循环。
 */

const { createRequire } = require('node:module');

/** 打包时由 esbuild --define 替换成具体模块名 */
const moduleName = __AUTOJOB_SHIM_MODULE__;

const candidates = [process.execPath, `${process.cwd()}/`];

let loaded;
const errors = [];

for (const base of candidates) {
  try {
    loaded = createRequire(base)(moduleName);
    break;
  } catch (error) {
    errors.push(`${base}: ${error.message}`);
  }
}

if (loaded === undefined) {
  throw new Error(
    `无法加载「${moduleName}」。它需要与可执行文件放在一起。\n` +
      errors.map((line) => `  · ${line}`).join('\n'),
  );
}

module.exports = loaded;
