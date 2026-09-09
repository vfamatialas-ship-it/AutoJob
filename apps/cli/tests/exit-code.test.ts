/**
 * CLI 退出码回归测试。
 *
 * 曾经的 bug：main() 在 parseAsync 之后无条件 `return 0`，
 * 把子命令通过 process.exitCode 设置的非零结果抹掉了。
 * 后果是 `autojob doctor && 下一步` 在环境检查失败时仍会继续执行。
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main } from '../src/index.js';

const originalExitCode = process.exitCode;

afterEach(() => {
  process.exitCode = originalExitCode;
});

describe('main 的退出码', () => {
  it('子命令设置的非零退出码被保留', async () => {
    process.exitCode = 0;

    // doctor 在检查未通过时会设置 process.exitCode = 1
    const code = await main(['node', 'autojob', 'doctor']);

    // 环境是否通过取决于运行机器，但两者必须一致 —— 不能出现「报错却返回 0」
    expect(code).toBe(process.exitCode ?? 0);
  });

  it('未实现的子命令返回非零', async () => {
    process.exitCode = 0;
    // app 计划在 M9 交付，当前应显式报错而非假装成功
    const code = await main(['node', 'autojob', 'app']);
    expect(code).not.toBe(0);
  });

  it('成功完成的命令返回 0', async () => {
    // 用一份最小但完全合法的 Profile 走通 profile check —— 全部检查通过时应返回 0。
    // 不用 --version 做样本：commander 内部会调 process.exit，在测试进程里不可控。
    const dir = await mkdtemp(join(tmpdir(), 'autojob-cli-'));
    const path = join(dir, 'profile.json');
    await writeFile(
      path,
      JSON.stringify({ schemaVersion: 1, basicInfo: { name: '测试用户' } }),
      'utf-8',
    );

    process.exitCode = 0;
    const code = await main(['node', 'autojob', 'profile', 'check', path]);

    expect(code).toBe(0);
  });
});
