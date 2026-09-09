/**
 * autojob jobs / match —— PRD Phase 5 / 6。
 *
 * ## 这两个命令**只读**
 *
 * PRD §56 明确要求：「注意：这个阶段不要投递。」
 *
 * 它们只打开列表页、解析岗位、打分排序，**绝不进入申请页**。
 * 真正要投时用 `autojob apply <岗位申请页 URL>`，那是另一条明确的动作。
 * 把「看看有什么岗位」和「投这个岗位」分成两个命令，
 * 就不会出现「本来只想看看，结果投出去了」。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { importProfile, type CandidateProfile } from '@autojob/candidate-profile';
import { AutoJobError, ErrorCode, createLogger, createRunId } from '@autojob/core';
import { launchSession } from '@autojob/browser';
import {
  CLICK_LOAD_MORE_SCRIPT,
  EXTRACT_JOB_LIST_SCRIPT,
  parseJobList,
  type Job,
} from '@autojob/job-discovery';
import {
  DEFAULT_PREFERENCE,
  JobPreferenceSchema,
  matchJobs,
  summarizeMatches,
  type JobPreference,
  type MatchResult,
} from '@autojob/job-matcher';
import { ApplicationRepository, openDatabase } from '@autojob/database';
import type { Command } from 'commander';

interface JobsOptions {
  readonly company?: string;
  readonly headless?: boolean;
  readonly preference?: string;
  readonly profile?: string;
  readonly db?: string;
  readonly limit?: string;
  readonly all?: boolean;
}

const write = (text: string): void => void process.stdout.write(`${text}\n`);

function loadJson<T>(path: string, what: string): T {
  try {
    return JSON.parse(readFileSync(resolve(path), 'utf-8')) as T;
  } catch (cause) {
    throw new AutoJobError(ErrorCode.CONFIG_INVALID, `无法读取${what}：${path}`, { cause });
  }
}

function guessCompanyName(url: string): string {
  try {
    const host = new URL(url).hostname;
    const parts = host
      .split('.')
      .filter((part) => !['www', 'com', 'cn', 'net', 'org'].includes(part));
    return parts[0] ?? host;
  } catch {
    return 'unknown';
  }
}

/**
 * 抓取岗位列表。
 *
 * 懒加载处理：反复点「加载更多」直到按钮消失或链接数不再增长。
 * 设上限是必要的 —— 万一某个站的按钮点了不消失，不能无限循环下去。
 */
async function fetchJobs(
  url: string,
  options: { company: string; headless: boolean },
): Promise<{ jobs: readonly Job[]; signature: string; score: number; discardedGroups: number }> {
  const runId = createRunId();
  const log = createLogger('jobs', { runId });
  const session = await launchSession({ headless: options.headless, logger: log });

  const extract = async (): Promise<ReturnType<typeof parseJobList>> =>
    parseJobList(await session.page.evaluate(EXTRACT_JOB_LIST_SCRIPT), {
      company: options.company,
      baseUrl: url,
    });

  try {
    await session.page.goto(url, { waitUntil: 'domcontentloaded' });

    /*
     * 先等内容渲染出来再判断。
     *
     * 现代招聘站几乎都是 SPA：domcontentloaded 时页面上只有导航和页脚，
     * 职位要等异步请求回来才渲染。早期版本 goto 完就提取，结果在真实的
     * Moka 站上抓到了页脚的三个外链 —— 那时职位根本还没出现在 DOM 里。
     *
     * 用轮询而非固定等待：静态页第一轮就拿到结果，只有 SPA 才付等待成本。
     */
    const MAX_SETTLE_ROUNDS = 8;
    let best = await extract();

    for (let round = 0; round < MAX_SETTLE_ROUNDS && best.jobs.length < 5; round += 1) {
      await session.page.waitForTimeout(1_000);
      const next = await extract();
      // 内容只会越渲染越多，取更优的一次
      if (next.score > best.score || next.jobs.length > best.jobs.length) best = next;
    }

    // 懒加载：反复点「加载更多」直到按钮消失或链接数不再增长
    const MAX_CLICKS = 20;
    let previousLinkCount = 0;

    for (let round = 0; round < MAX_CLICKS; round += 1) {
      const result = await session.page.evaluate(CLICK_LOAD_MORE_SCRIPT);
      if (!result.clicked) break;

      await session.page.waitForTimeout(500);
      const after = await session.page.evaluate(CLICK_LOAD_MORE_SCRIPT);

      // 点了但内容没增加，说明到底了（或按钮失效），不再纠缠
      if (after.linkCount <= previousLinkCount) break;
      previousLinkCount = after.linkCount;

      const expanded = await extract();
      if (expanded.jobs.length > best.jobs.length) best = expanded;
    }

    return best;
  } finally {
    await session.close();
  }
}

function renderJobTable(jobs: readonly Job[]): void {
  write('');
  write(`共 ${jobs.length} 个岗位`);
  write('');

  for (const job of jobs) {
    const meta = [job.department, job.location, job.degreeRequirement, job.jobType]
      .filter((part) => part.length > 0 && part !== 'unknown')
      .join(' · ');
    write(`  ${job.title}`);
    if (meta.length > 0) write(`    ${meta}`);
    write(`    ${job.url}`);
    write('');
  }
}

function renderMatches(results: readonly MatchResult[], limit: number, showAll: boolean): void {
  const summary = summarizeMatches(results);

  write('');
  write(
    `共 ${summary.total} 个岗位：通过筛选 ${summary.passed}，被过滤 ${summary.rejected}` +
      (summary.alreadyApplied > 0 ? `，已投递 ${summary.alreadyApplied}` : ''),
  );

  const passed = results.filter((item) => item.passed);
  const shown = showAll ? passed : passed.slice(0, limit);

  write('');
  write(`── 推荐岗位${showAll ? '' : `（前 ${shown.length} 个）`}`);
  write('');

  for (const result of shown) {
    const applied = result.alreadyApplied === true ? '  [已投递]' : '';
    write(`  ${String(result.score).padStart(3)}  ${result.job.title}${applied}`);

    const meta = [result.job.department, result.job.location]
      .filter((part) => part.length > 0)
      .join(' · ');
    if (meta.length > 0) write(`       ${meta}`);
    write(`       ${result.summary}`);
    write(`       ${result.job.url}`);
    write('');
  }

  // 被过滤的只给统计，不逐条列 —— 用户关心的是推荐，不是垃圾
  if (summary.rejected > 0) {
    write(`── 已过滤 ${summary.rejected} 个`);
    for (const [reason, count] of Object.entries(summary.rejectionsByReason)) {
      write(`   ${reason}: ${count}`);
    }
    write('');
  }

  write('提示：本命令只做浏览与匹配，不会投递。要投递请用 autojob apply <岗位申请页 URL>');
}

export function registerJobsCommand(program: Command): void {
  program
    .command('jobs')
    .description('抓取企业招聘页的岗位列表（只读，不投递）')
    .argument('<url>', '招聘列表页 URL')
    .option('-c, --company <name>', '公司名称（默认从 URL 推断）')
    .option('--headless', '无头模式（仅用于测试）')
    .action(async (url: string, options: JobsOptions) => {
      const company = options.company ?? guessCompanyName(url);
      const result = await fetchJobs(url, { company, headless: options.headless === true });

      if (result.jobs.length === 0) {
        write('未能在该页面识别出岗位列表。');
        write('可能原因：页面需要登录、岗位由 JS 异步加载、或页面结构特殊。');
        process.exitCode = 1;
        return;
      }

      write(`识别到岗位列表（结构 ${result.signature}，置信分 ${result.score}）`);
      renderJobTable(result.jobs);
      write('提示：本命令只做浏览，不会投递。');
    });

  program
    .command('match')
    .description('抓取岗位并按你的偏好打分排序（只读，不投递）')
    .argument('<url>', '招聘列表页 URL')
    .requiredOption('-p, --profile <path>', 'Candidate Profile JSON 路径')
    .option('-c, --company <name>', '公司名称（默认从 URL 推断）')
    .option('--preference <path>', '岗位偏好 JSON（默认用内置的机器人/具身智能方向）')
    .option('--db <path>', '数据库路径，用于标记已投递岗位')
    .option('--limit <n>', '展示前 N 个推荐', '10')
    .option('--all', '展示全部通过筛选的岗位')
    .option('--headless', '无头模式（仅用于测试）')
    .action(async (url: string, options: JobsOptions) => {
      const profile: CandidateProfile = importProfile(
        readFileSync(resolve(options.profile ?? ''), 'utf-8'),
      );

      const preference: JobPreference =
        options.preference === undefined
          ? DEFAULT_PREFERENCE
          : JobPreferenceSchema.parse(loadJson(options.preference, '岗位偏好'));

      const company = options.company ?? guessCompanyName(url);
      const { jobs } = await fetchJobs(url, { company, headless: options.headless === true });

      if (jobs.length === 0) {
        write('未能在该页面识别出岗位列表。');
        process.exitCode = 1;
        return;
      }

      // 已投递的岗位标出来，避免重复投递（PRD §30）
      let appliedJobIds = new Set<string>();
      if (options.db !== undefined) {
        const db = openDatabase({ path: options.db });
        const repo = new ApplicationRepository(db);
        appliedJobIds = new Set(
          repo.listApplications().map((row) => `${company}:${row.job.externalJobId ?? ''}`),
        );
        db.close();
      }

      const results = matchJobs(jobs, { preference, profile, appliedJobIds });
      renderMatches(results, Number(options.limit ?? '10'), options.all === true);
    });
}
