/**
 * autojob doctor —— 环境自检。
 *
 * PRD §80 第一条要求「检查当前操作系统、Node、Playwright 环境」。
 * 把它做成常驻命令，后续每个里程碑新增依赖时在这里补一项检查，
 * 用户装不上东西时能自己定位，不用来问。
 */

import { existsSync } from 'node:fs';
import { homedir, platform, release } from 'node:os';
import { join } from 'node:path';
import type { Command } from 'commander';

export interface CheckResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
  /** 未通过时的修复建议 */
  readonly fix?: string;
}

const MIN_NODE_MAJOR = 20;

export function checkNodeVersion(version: string = process.version): CheckResult {
  const major = Number.parseInt(version.replace(/^v/, '').split('.')[0] ?? '0', 10);
  const ok = major >= MIN_NODE_MAJOR;
  return {
    name: 'Node.js',
    ok,
    detail: `${version}（要求 >= ${MIN_NODE_MAJOR}）`,
    ...(ok ? {} : { fix: `请升级 Node 至 ${MIN_NODE_MAJOR} 以上` }),
  };
}

export function checkPlaywrightBrowsers(
  cacheDir: string = join(homedir(), '.cache', 'ms-playwright'),
): CheckResult {
  const ok = existsSync(cacheDir);
  return {
    name: 'Playwright 浏览器',
    ok,
    detail: ok ? `已安装于 ${cacheDir}` : '未安装',
    ...(ok ? {} : { fix: 'pnpm exec playwright install chromium --with-deps' }),
  };
}

export function checkPlatform(): CheckResult {
  return {
    name: '操作系统',
    ok: true,
    detail: `${platform()} ${release()}`,
  };
}

export function runChecks(): CheckResult[] {
  return [checkPlatform(), checkNodeVersion(), checkPlaywrightBrowsers()];
}

export function formatChecks(results: readonly CheckResult[]): string {
  const lines = results.map((r) => {
    const mark = r.ok ? '✓' : '✗';
    const fix = r.ok || !r.fix ? '' : `\n      修复：${r.fix}`;
    return `  ${mark} ${r.name.padEnd(18)} ${r.detail}${fix}`;
  });

  const failed = results.filter((r) => !r.ok).length;
  const summary =
    failed === 0 ? '\n全部检查通过。' : `\n${failed} 项未通过，请按上面的「修复」执行。`;

  return `AutoJob 环境自检\n\n${lines.join('\n')}\n${summary}`;
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('检查开发与运行环境是否就绪')
    .action(() => {
      const results = runChecks();
      process.stdout.write(`${formatChecks(results)}\n`);
      if (results.some((r) => !r.ok)) process.exitCode = 1;
    });
}
