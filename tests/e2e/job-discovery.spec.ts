/**
 * M7 验收 —— 在真实浏览器上验证岗位列表解析与匹配。
 *
 * **本文件的所有操作都是只读的**：打开列表页、解析、打分。
 * 绝不点击申请按钮，绝不进入申请页（PRD §56）。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { importProfile } from '../../packages/candidate-profile/src/io.js';
import {
  CLICK_LOAD_MORE_SCRIPT,
  EXTRACT_JOB_LIST_SCRIPT,
} from '../../packages/job-discovery/src/extract-script.js';
import { parseJobList } from '../../packages/job-discovery/src/parser.js';
import { DEFAULT_PREFERENCE } from '../../packages/job-matcher/src/preference.js';
import { matchJobs, summarizeMatches } from '../../packages/job-matcher/src/matcher.js';
import type { CandidateProfile } from '../../packages/candidate-profile/src/profile.js';
import type { Job } from '../../packages/job-discovery/src/job.js';
import type { Page } from '@playwright/test';

const profile: CandidateProfile = importProfile(
  readFileSync(
    fileURLToPath(
      new URL(
        '../../packages/candidate-profile/tests/fixtures/profile.sample.json',
        import.meta.url,
      ),
    ),
    'utf-8',
  ),
);

async function discover(
  page: Page,
  path: string,
  company: string,
): Promise<{ jobs: readonly Job[]; signature: string; score: number }> {
  await page.goto(path);

  // 处理懒加载
  for (let round = 0; round < 10; round += 1) {
    const result = await page.evaluate(CLICK_LOAD_MORE_SCRIPT);
    if (!result.clicked) break;
    await page.waitForTimeout(200);
  }

  const candidates = await page.evaluate(EXTRACT_JOB_LIST_SCRIPT);
  return parseJobList(candidates, { company, baseUrl: page.url() });
}

test.describe('I 公司 · 表格式列表', () => {
  test('抓到全部 12 个岗位', async ({ page }) => {
    const result = await discover(page, '/mock_joblist_table/jobs.html', 'I公司');
    expect(result.jobs).toHaveLength(12);
  });

  test('识别出的条目是行而不是单元格', async ({ page }) => {
    /*
     * 回归防线：早期版本把 <td> 当成了条目 —— 一行里 6 个 td 确实是同签名兄弟。
     * 结果只抓到职位名，部门/地点/学历全丢。
     * 正确的条目是 <tr>：它的兄弟每一个都含职位链接。
     */
    const result = await discover(page, '/mock_joblist_table/jobs.html', 'I公司');

    expect(result.signature).toContain('tr');
    expect(result.jobs[0]?.department).toBe('机器人研究院');
    expect(result.jobs[0]?.location).toBe('北京');
  });

  test('结构化字段被正确解析', async ({ page }) => {
    const result = await discover(page, '/mock_joblist_table/jobs.html', 'I公司');
    const first = result.jobs[0];

    expect(first?.title).toBe('具身智能算法工程师');
    expect(first?.externalJobId).toBe('J1001');
    expect(first?.degreeRequirement).toBe('master');
    expect(first?.jobType).toBe('campus');
    expect(first?.publishedAt).toBe('2026-09-01');
    expect(first?.url).toContain('id=J1001');
  });

  test('社招岗位被正确识别为 social', async ({ page }) => {
    const result = await discover(page, '/mock_joblist_table/jobs.html', 'I公司');
    const social = result.jobs.find((job) => job.title === '具身智能算法专家');

    expect(social?.jobType).toBe('social');
  });

  test('筛选下拉没有被误认成岗位', async ({ page }) => {
    const result = await discover(page, '/mock_joblist_table/jobs.html', 'I公司');
    const titles = result.jobs.map((job) => job.title);

    expect(titles).not.toContain('全部城市');
    expect(titles).not.toContain('全部类型');
  });
});

test.describe('J 公司 · 卡片式列表（懒加载）', () => {
  test('触发加载更多后抓到全部 6 个岗位', async ({ page }) => {
    const result = await discover(page, '/mock_joblist_cards/jobs.html', 'J公司');
    expect(result.jobs).toHaveLength(6);
  });

  test('不触发加载时只有首屏 3 个 —— 证明懒加载确实存在', async ({ page }) => {
    await page.goto('/mock_joblist_cards/jobs.html');

    const candidates = await page.evaluate(EXTRACT_JOB_LIST_SCRIPT);
    const result = parseJobList(candidates, { company: 'J公司', baseUrl: page.url() });

    expect(result.jobs).toHaveLength(3);
  });

  test('顶部宣讲会推广区没有被误认成岗位列表', async ({ page }) => {
    const result = await discover(page, '/mock_joblist_cards/jobs.html', 'J公司');
    const titles = result.jobs.map((job) => job.title);

    expect(titles).not.toContain('查看宣讲会日程');
    expect(titles).not.toContain('内推通道');
    expect(result.signature).toContain('job-card');
  });

  test('字段缺失是常态，缺部门的卡片照常解析', async ({ page }) => {
    const result = await discover(page, '/mock_joblist_cards/jobs.html', 'J公司');
    const noDept = result.jobs.find((job) => job.title === '视觉感知算法工程师');

    expect(noDept).toBeDefined();
    expect(noDept?.department).toBe('');
    expect(noDept?.location).toBe('上海');
  });
});

test.describe('匹配与筛选（PRD §57 验收）', () => {
  test('明显不匹配的岗位被过滤掉', async ({ page }) => {
    const { jobs } = await discover(page, '/mock_joblist_table/jobs.html', 'I公司');
    const results = matchJobs(jobs, { preference: DEFAULT_PREFERENCE, profile });

    const rejectedTitles = results.filter((item) => !item.passed).map((item) => item.job.title);

    expect(rejectedTitles).toContain('Java 后端开发工程师');
    expect(rejectedTitles).toContain('前端开发工程师');
    expect(rejectedTitles).toContain('销售管理培训生');
    expect(rejectedTitles).toContain('软件测试工程师');
  });

  test('学历不达标的博士岗被过滤', async ({ page }) => {
    const { jobs } = await discover(page, '/mock_joblist_table/jobs.html', 'I公司');
    const results = matchJobs(jobs, { preference: DEFAULT_PREFERENCE, profile });

    const doctorJob = results.find((item) => item.job.title === '强化学习算法工程师');
    expect(doctorJob?.passed).toBe(false);
    expect(doctorJob?.rejectReason).toBe('DEGREE_NOT_MET');
  });

  test('相关岗位排在最前，且给出可读的匹配理由', async ({ page }) => {
    const { jobs } = await discover(page, '/mock_joblist_table/jobs.html', 'I公司');
    const results = matchJobs(jobs, { preference: DEFAULT_PREFERENCE, profile });

    expect(results[0]?.job.title).toMatch(/具身智能|VLA/);
    expect(results[0]?.summary.length).toBeGreaterThan(0);
    expect(results[0]?.score).toBeGreaterThan(50);
  });

  test('过滤统计给出原因分布', async ({ page }) => {
    const { jobs } = await discover(page, '/mock_joblist_table/jobs.html', 'I公司');
    const summary = summarizeMatches(matchJobs(jobs, { preference: DEFAULT_PREFERENCE, profile }));

    expect(summary.total).toBe(12);
    expect(summary.rejectionsByReason['EXCLUDED_KEYWORD']).toBe(4);
    expect(summary.rejectionsByReason['DEGREE_NOT_MET']).toBeGreaterThan(0);
  });
});

test.describe('只读保证（PRD §56）', () => {
  test('全过程停留在列表页，从未进入申请页', async ({ page }) => {
    await discover(page, '/mock_joblist_table/jobs.html', 'I公司');

    // 仍在列表页，没有任何导航发生
    expect(page.url()).toContain('/mock_joblist_table/jobs.html');
  });

  test('申请表类页面上跑列表解析不会误抓出岗位', async ({ page }) => {
    // 申请表页没有重复的职位链接结构，应当识别不出列表
    const result = await discover(page, '/mock_company_a/apply.html', 'A公司');
    expect(result.jobs).toHaveLength(0);
  });
});
