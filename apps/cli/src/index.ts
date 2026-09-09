#!/usr/bin/env node
/**
 * AutoJob CLI 入口。
 *
 * 当前处于 M0：只有骨架与 doctor 命令。
 * 后续里程碑逐步接入 profile / apply / jobs / match / app 等子命令，
 * 每个子命令在真正实现前一律显式报「未实现」，不做假装可用的桩。
 */

import { Command } from 'commander';
import { AutoJobError, ErrorCode, createLogger, createRunId, toAutoJobError } from '@autojob/core';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerProfileCommand } from './commands/profile.js';
import { registerApplyCommand } from './commands/apply.js';
import { registerJobsCommand } from './commands/jobs.js';

const VERSION = '0.0.1';

export function buildProgram(): Command {
  const program = new Command();

  program
    .name('autojob')
    .description('面向异构企业 ATS 的语义驱动校园招聘自动投递系统')
    .version(VERSION, '-v, --version', '显示版本号')
    .helpOption('-h, --help', '显示帮助');

  registerDoctorCommand(program);
  registerProfileCommand(program);
  registerApplyCommand(program);
  registerJobsCommand(program);

  // 占位子命令：明确告知尚未实现，避免误以为可用（PRD §71 禁止含糊失败）
  const planned: ReadonlyArray<readonly [string, string, string]> = [
    ['asset', '管理附件库（简历 / 作品集 / 成绩单 / 证书）', 'M5'],
    ['app', '查看与更新投递记录（Dashboard）', 'M9'],
  ];

  for (const [name, description, milestone] of planned) {
    program
      .command(name)
      .description(`${description} [${milestone} 实现]`)
      .allowUnknownOption()
      .action(() => {
        throw new AutoJobError(
          ErrorCode.CONFIG_INVALID,
          `子命令 "${name}" 尚未实现，计划在 ${milestone} 交付。`,
          { hint: '当前可用命令：autojob doctor' },
        );
      });
  }

  return program;
}

export async function main(argv: readonly string[]): Promise<number> {
  const runId = createRunId();
  const log = createLogger('cli', { runId });

  try {
    await buildProgram().parseAsync([...argv]);

    /*
     * 子命令通过 process.exitCode 表达非零结果（doctor 检查未通过、apply 遇到
     * 重复投递等）。这里必须把它读回来 —— 早期版本无条件 return 0，
     * 把子命令设置的退出码悄悄抹掉了，脚本里 `autojob doctor && ...` 会误判成功。
     */
    return typeof process.exitCode === 'number' ? process.exitCode : 0;
  } catch (thrown) {
    const error = toAutoJobError(thrown);
    log.error(error.message, { code: error.code, ...error.context });
    if (error.hint) {
      process.stderr.write(`\n提示：${error.hint}\n`);
    }
    return error.userActionable ? 2 : 1;
  }
}

// 仅在被直接执行时运行，被 import（测试）时不触发
if (
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(new URL(`file://${process.argv[1]}`).pathname)
) {
  process.exitCode = await main(process.argv);
}
