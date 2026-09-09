#!/usr/bin/env node
/**
 * 把 Worker 打包成单个可执行文件。
 *
 * PRD §63 要求：「安装后用户不需要 Python / Node.js / Claude Code / Codex，
 * 系统所有依赖必须打包。」
 *
 * ## 两步走
 *
 * 1. **esbuild 打成单个 JS**：把整个 monorepo 的 TS 源码连同依赖打成一个文件。
 *    原生模块（better-sqlite3）与 Playwright 保持 external —— 它们不能被打包，
 *    需要随附二进制。
 *
 * 2. **Node SEA 封成可执行文件**：Node 22 内置的 Single Executable Application
 *    能把 JS 注入 Node 二进制，产出一个不依赖外部 Node 的可执行文件。
 *
 * ## 交叉构建
 *
 * `--target win-x64` 可以在 Linux 上产出 Windows 版 Worker。能这么做是因为
 * 两个前提刚好成立：
 *
 * - **SEA blob 与平台无关**（前提是 `useSnapshot` 与 `useCodeCache` 都为 false，
 *   本文件正是这么配的）。开了它们 blob 会内嵌 V8 的机器码，就只能同架构使用。
 * - **better-sqlite3 v13 把各平台预编译产物都装在 npm 包里**（`prebuilds/*.node`），
 *   运行时按平台选择。所以不需要在 Windows 上重新编译原生模块。
 *
 * 缺的只是一个 Windows 版 Node 二进制，从 nodejs.org 下载即可。
 *
 * ## 诚实的限制
 *
 * **Playwright 的 Chromium（约 150MB）不打进安装包**，首次运行时下载。
 * 把它塞进安装包会让体积从几十 MB 涨到两百多 MB，而多数用户机器上
 * 装个浏览器内核是可接受的一次性成本。这是对 PRD「所有依赖必须打包」的
 * 一处有意偏离，已在 README 与首次运行提示中说明。
 */

import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** 发布目录：只放最终要随安装包分发的东西 */
const outDir = join(root, 'dist-worker');
/** 中间产物目录。与发布目录分开，避免把 blob / cjs 一起塞进安装包 */
const workDir = join(root, '.worker-build');
/** 下载的 Node 二进制缓存。重复构建不必重新下载 */
const cacheDir = join(workDir, '..', '.worker-cache');

const HOST_TARGET = process.platform === 'win32' ? 'win-x64' : 'host';
const target = (() => {
  const flag = process.argv.indexOf('--target');
  if (flag === -1) return HOST_TARGET;
  const value = process.argv[flag + 1];
  if (value !== 'win-x64' && value !== 'host') {
    console.error(`未知目标平台：${value ?? '(空)'}。可选：host、win-x64`);
    process.exit(1);
  }
  return value;
})();

const isWindowsTarget = target === 'win-x64';
const exeName = isWindowsTarget ? 'autojob-worker.exe' : 'autojob-worker';

/** 必须随可执行文件分发的模块。见 packages/core/src/native-require.ts 的说明 */
const EXTERNAL_MODULES = ['better-sqlite3', 'playwright', 'playwright-core'];

const run = (command, args, options = {}) =>
  execFileSync(command, args, { cwd: root, stdio: 'inherit', ...options });

/**
 * 为某个模块生成专属垫片。
 *
 * 每个模块一个文件而不是共用一个：esbuild 的 alias 是模块级的，
 * 共用会让所有被 alias 的模块解析到同一个名字。
 */
function shimFor(moduleName) {
  const template = readFileSync(join(root, 'scripts', 'sea-shims', 'native-module.cjs'), 'utf-8');
  const shimPath = join(workDir, `shim-${moduleName.replace(/[^a-z0-9]/gi, '-')}.cjs`);
  writeFileSync(shimPath, template.replace('__AUTOJOB_SHIM_MODULE__', JSON.stringify(moduleName)));
  return shimPath;
}

/**
 * 从 `from` 开始逐级向上找 `node_modules/<name>`。
 *
 * 不用 `require.resolve`：pnpm 的包很多没在 `exports` 里暴露 package.json，
 * 而我们需要的恰恰是 package.json（要读它的 dependencies）。
 * 返回真实路径 —— pnpm 的 node_modules 全是指向 `.pnpm` 的符号链接。
 */
function findPackage(name, from) {
  let dir = from;
  for (;;) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate);
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * 收集模块及其全部传递依赖，拷进发布目录。
 *
 * 为什么不能直接 `cp -rL node_modules/better-sqlite3`：pnpm 用隔离式布局，
 * better-sqlite3 的依赖（bindings 等）不在它目录内部，而是并列在
 * `.pnpm/better-sqlite3@x/node_modules/` 下。只拷一个包，运行时必然
 * MODULE_NOT_FOUND。所以按 package.json 的 dependencies 递归展开。
 */
function copyModuleClosure(names, destRoot) {
  const done = new Set();
  const unresolved = new Set();
  const queue = names.map((name) => ({ name, from: root }));

  while (queue.length > 0) {
    const { name, from } = queue.shift();
    if (done.has(name)) continue;

    const pkgDir = findPackage(name, from);
    if (pkgDir === undefined) {
      unresolved.add(name);
      continue;
    }
    done.add(name);

    // dereference：把符号链接展开成真实文件，否则安装包里全是断链
    cpSync(pkgDir, join(destRoot, name), { recursive: true, dereference: true });

    const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf-8'));
    for (const dep of Object.keys(manifest.dependencies ?? {})) {
      queue.push({ name: dep, from: pkgDir });
    }
  }

  /*
   * pnpm 不把间接依赖提升到顶层 node_modules，所以 playwright-core 这种
   * 「既是显式目标、又是别人的依赖」的包，从根目录查一定落空 ——
   * 但它早已随 playwright 一起拷进去了。真正缺失的只有从未被拷贝的。
   */
  return { copied: [...done], missing: [...unresolved].filter((name) => !done.has(name)) };
}

/**
 * 取得要被注入的 Node 二进制。
 *
 * 目标就是本机时直接用当前的 `node`；交叉构建时从 nodejs.org 下载**同版本**的
 * Windows 版。版本必须一致：SEA blob 里带着生成它的 Node 版本号，
 * 版本对不上运行时会直接拒绝加载。
 */
function resolveBaseBinary() {
  if (!isWindowsTarget) return process.execPath;

  const version = process.version; // 形如 v22.23.0
  const name = `node-${version}-win-x64`;
  const cached = join(cacheDir, name, 'node.exe');
  if (existsSync(cached)) {
    console.log(`  复用已下载的 ${name}/node.exe`);
    return cached;
  }

  mkdirSync(cacheDir, { recursive: true });
  const zipPath = join(cacheDir, `${name}.zip`);
  const url = `https://nodejs.org/dist/${version}/${name}.zip`;
  console.log(`  下载 ${url}`);
  run('curl', ['-fL', '--retry', '3', '-o', zipPath, url]);
  run('unzip', ['-oq', zipPath, `${name}/node.exe`, '-d', cacheDir]);

  if (!existsSync(cached)) throw new Error(`下载的压缩包里没有 ${name}/node.exe`);
  return cached;
}

console.log(`[1/5] 清理输出目录（目标平台：${target}）`);
rmSync(outDir, { recursive: true, force: true });
rmSync(workDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
mkdirSync(workDir, { recursive: true });

console.log('[2/5] esbuild 打包 Worker');
// 走 pnpm exec：pnpm 的隔离式 node_modules 不保证顶层有 esbuild 的可执行文件
run('pnpm', [
  'exec',
  'esbuild',
  'apps/worker/src/main.ts',
  '--bundle',
  '--platform=node',
  '--target=node22',
  '--format=cjs',
  /*
   * 原生模块与浏览器驱动不打包，但也不能简单 external ——
   * 单文件可执行程序的 require 只认内置模块，第三方库（如 drizzle 的驱动）
   * 在顶层 require 它们时会直接失败。所以指向运行时解析的垫片。
   */
  `--alias:better-sqlite3=${shimFor('better-sqlite3')}`,
  `--alias:playwright=${shimFor('playwright')}`,
  '--external:playwright-core',
  '--external:electron',
  `--outfile=${join(workDir, 'worker.cjs')}`,
  // tsconfig paths 需要显式告知 esbuild
  `--tsconfig=${join(root, 'tsconfig.json')}`,
]);

console.log('[3/5] 生成 SEA 配置与 blob');
const seaConfig = join(workDir, 'sea-config.json');
writeFileSync(
  seaConfig,
  JSON.stringify(
    {
      main: join(workDir, 'worker.cjs'),
      output: join(workDir, 'worker.blob'),
      disableExperimentalSEAWarning: true,
      // 允许运行时 require 原生模块，SEA 默认会拦下
      useSnapshot: false,
      useCodeCache: false,
    },
    null,
    2,
  ),
);
run(process.execPath, ['--experimental-sea-config', seaConfig]);

console.log('[4/5] 注入到 Node 二进制');
const exePath = join(outDir, exeName);
copyFileSync(resolveBaseBinary(), exePath);

run('pnpm', [
  'exec',
  'postject',
  exePath,
  'NODE_SEA_BLOB',
  join(workDir, 'worker.blob'),
  '--sentinel-fuse',
  'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
]);

/*
 * 官方 node.exe 带 Authenticode 签名，注入资源后签名自然失效 ——
 * 程序照常运行，只是 SmartScreen 会提示来源未知。要消除提示得用自己的
 * 证书重新签名，那是发布环节的事，不在构建脚本的职责范围内。
 */

if (!existsSync(exePath)) {
  console.error('未能生成可执行文件');
  process.exit(1);
}

/*
 * 记下这份产物是给哪个平台的。dist-worker/ 是固定路径，Linux 包与 Windows 包
 * 都从这里取 Worker —— 没有这个标记，交叉构建时忘了重跑本脚本就会把上一次的
 * Worker 静默打进安装包。src-tauri/build.rs 会读它并在不匹配时中断构建。
 */
writeFileSync(
  join(outDir, 'TARGET'),
  isWindowsTarget ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
);

console.log('[5/5] 随附原生模块与浏览器驱动');
const { copied, missing } = copyModuleClosure(EXTERNAL_MODULES, join(outDir, 'node_modules'));
console.log(`  已随附 ${copied.length} 个包：${copied.sort().join(', ')}`);

/*
 * 缺包不能只打一行 warning 就放过 —— 运行时才发现 MODULE_NOT_FOUND，
 * 那时用户已经装完包了，而 Worker 根本起不来。构建期直接失败。
 */
if (missing.length > 0) {
  console.error(`\n✗ 以下模块未能解析，安装包会缺依赖：${missing.join(', ')}`);
  console.error('  先跑 pnpm install，确认它们在 node_modules 里。');
  process.exit(1);
}

console.log(`\n✓ 发布目录：${outDir}`);
console.log('  Tauri 会把整个目录作为 resources 打进安装包，见 tauri.conf.json。');
console.log('  Playwright 的 Chromium 内核不在其中，首次运行时下载（见本文件头部说明）。');
