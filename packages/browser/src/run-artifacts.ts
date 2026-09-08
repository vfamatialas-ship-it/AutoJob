/**
 * Run 产物目录 —— PRD §73 Observability。
 *
 * 每次投递生成一个 Run ID，对应磁盘上一个目录：
 *
 *   ~/.autojob/runs/run_20260909T012345_a1b2c3/
 *     01-opened.png          打开页面时
 *     02-parsed.png          解析完成
 *     03-filled.png          填写完成
 *     04-validated.png       校验后
 *     plan.json              映射计划（含 warning 与溯源）
 *     transitions.json       状态机转移历史
 *
 * ## 这些文件含个人信息
 *
 * 截图上有真实姓名手机号，plan.json 里有完整填写内容。
 * 所以 `runs/` 与 `.autojob/` 都已写进 .gitignore，**永远不进仓库**。
 * 文件名里也只放 Run ID，不放公司名或岗位名。
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Page } from 'playwright';
import type { Logger } from '@autojob/core';

export const DEFAULT_RUNS_DIR = join(homedir(), '.autojob', 'runs');

export interface RunArtifacts {
  readonly runId: string;
  readonly dir: string;
  /** 截图并按顺序编号 */
  screenshot(page: Page, name: string): Promise<string>;
  /** 写入 JSON 产物 */
  writeJson(name: string, data: unknown): Promise<string>;
  /** 已产生的文件列表 */
  readonly files: readonly string[];
}

export async function createRunArtifacts(
  runId: string,
  options: { baseDir?: string; logger?: Logger } = {},
): Promise<RunArtifacts> {
  const dir = join(options.baseDir ?? DEFAULT_RUNS_DIR, runId);
  await mkdir(dir, { recursive: true });

  const files: string[] = [];
  let step = 0;

  return {
    runId,
    dir,
    files,

    async screenshot(page: Page, name: string): Promise<string> {
      step += 1;
      const fileName = `${String(step).padStart(2, '0')}-${name}.png`;
      const path = join(dir, fileName);

      // fullPage 才能拍到长表单的全部内容，只拍视口会漏掉下半截
      await page.screenshot({ path, fullPage: true });
      files.push(fileName);
      options.logger?.debug('已保存截图', { file: fileName });
      return path;
    },

    async writeJson(name: string, data: unknown): Promise<string> {
      const fileName = name.endsWith('.json') ? name : `${name}.json`;
      const path = join(dir, fileName);
      await writeFile(path, JSON.stringify(data, null, 2), 'utf-8');
      files.push(fileName);
      return path;
    },
  };
}
