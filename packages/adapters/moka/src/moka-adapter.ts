/**
 * Moka Adapter —— PRD §58 的第一个真实 ATS Adapter。
 *
 * ## 为什么第一个做 Moka（而不是最初计划的飞书）
 *
 * M7 末的实测反转了判断：
 * - Moka 的岗位列表**公开可见**，通用解析器修完就能直接跑通（大疆 30 个岗位全对）
 * - 飞书招聘的岗位列表**必须登录**才看得到（智元站首屏正文只有「登录」二字）
 *
 * 建 fixture、CI 离线测试这两件事上，前者成本低得多。飞书虽然覆盖企业更多，
 * 但放到有了登录态复用机制之后再做更划算。
 *
 * ## 这个 Adapter 补了什么
 *
 * 岗位列表复用通用解析器 —— 它已经在真实 Moka 站上验证过了，重写一遍没意义。
 * Adapter 真正补的是 Moka **特有**的三件事：
 *
 *   1. hash 路由：岗位与申请页都在 `#/` 后面，导航方式与普通站点不同
 *   2. 渲染时序：SPA 首屏无内容，实测第 3 秒才出职位
 *   3. 申请入口：从岗位详情进申请表的按钮文案与位置
 */

import {
  AtsType,
  detectAts,
  type ATSAdapter,
  type AdapterJob,
  type DetectionResult,
  type ListJobsOptions,
  type SubmitResult,
} from '@autojob/ats-detector';
import {
  CLICK_LOAD_MORE_SCRIPT,
  EXTRACT_JOB_LIST_SCRIPT,
  parseJobList,
} from '@autojob/job-discovery';
import type { Page } from 'playwright';

/** 页面上加载过的资源 URL —— 检测 ATS 的最强信号 */
const COLLECT_RESOURCE_HOSTS = (): string[] =>
  Array.from(document.querySelectorAll('script[src], link[href]'))
    .map((element) => element.getAttribute('src') ?? element.getAttribute('href') ?? '')
    .filter((url) => url.length > 0);

/**
 * 等待 SPA 内容渲染。
 *
 * 实测 Moka 站的职位在第 3 秒才出现在 DOM 里。固定等待要么太短要么浪费时间，
 * 所以用轮询：给定的判据一满足就返回。
 */
async function waitForContent(
  page: Page,
  isReady: () => Promise<boolean>,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<boolean> {
  const deadline = Date.now() + (options.timeoutMs ?? 15_000);
  const interval = options.intervalMs ?? 700;

  while (Date.now() < deadline) {
    if (await isReady()) return true;
    await page.waitForTimeout(interval);
  }
  return false;
}

export class MokaAdapter implements ATSAdapter {
  readonly ats = AtsType.MOKA;
  readonly label = 'Moka';

  async detect(page: Page, url: string): Promise<DetectionResult> {
    const resourceUrls = await page.evaluate(COLLECT_RESOURCE_HOSTS).catch(() => []);
    return detectAts({ url, resourceUrls });
  }

  async listJobs(
    page: Page,
    url: string,
    options: ListJobsOptions = {},
  ): Promise<readonly AdapterJob[]> {
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    const extract = async (): Promise<ReturnType<typeof parseJobList>> =>
      parseJobList(await page.evaluate(EXTRACT_JOB_LIST_SCRIPT), {
        company: '',
        baseUrl: url,
        atsType: AtsType.MOKA,
        source: 'moka',
      });

    // SPA 渲染时序：等到抓出像样的列表为止
    let best = await extract();
    await waitForContent(page, async () => {
      const next = await extract();
      if (next.jobs.length > best.jobs.length) best = next;
      return best.jobs.length >= 5;
    });

    // Moka 的长列表用「加载更多」翻页
    for (let round = 0; round < 20; round += 1) {
      const clicked = await page.evaluate(CLICK_LOAD_MORE_SCRIPT);
      if (!clicked.clicked) break;
      await page.waitForTimeout(600);

      const expanded = await extract();
      if (expanded.jobs.length <= best.jobs.length) break;
      best = expanded;

      if (options.limit !== undefined && best.jobs.length >= options.limit) break;
    }

    const jobs = best.jobs.map((job): AdapterJob => ({
      externalJobId: job.externalJobId,
      title: job.title,
      url: job.url,
      location: job.location,
      department: job.department,
      description: job.description,
    }));

    return options.limit === undefined ? jobs : jobs.slice(0, options.limit);
  }

  /**
   * 进入申请表。
   *
   * Moka 的岗位详情页有「申请职位」按钮，点击后跳到 `#/candidateHome/...`。
   * 未登录时会先弹登录框 —— 此时返回 false，由上层转 WAITING_USER（PRD §74）。
   */
  async openApplication(page: Page, jobUrl: string): Promise<boolean> {
    await page.goto(jobUrl, { waitUntil: 'domcontentloaded' });

    const applyButton = page
      .locator('button, a')
      .filter({ hasText: /申请职位|立即申请|投递简历|申请该职位|apply/i })
      .first();

    const appeared = await waitForContent(page, async () => (await applyButton.count()) > 0, {
      timeoutMs: 12_000,
    });
    if (!appeared) return false;

    await applyButton.click();
    await page.waitForTimeout(1_500);

    // 弹出登录框说明需要用户介入
    const needsLogin = await page
      .locator('input[type="password"], [class*="login" i]')
      .count()
      .then((count) => count > 0)
      .catch(() => false);

    return !needsLogin;
  }

  /** 等申请表字段渲染出来。不等的话会解析到空表单 */
  async waitForForm(page: Page): Promise<boolean> {
    return waitForContent(
      page,
      async () => (await page.locator('input, textarea, select').count()) >= 3,
      { timeoutMs: 15_000 },
    );
  }

  /**
   * 验证提交结果 —— PRD §60「不能仅因为点击了 Submit 就认为成功」。
   *
   * 三个独立证据，任一成立即认为成功：成功文案、URL 变化、页面出现投递记录。
   * 三个都没有就判失败，哪怕按钮确实被点了。
   */
  async verifySubmission(page: Page): Promise<SubmitResult> {
    const SUCCESS_PATTERN =
      /投递成功|提交成功|申请成功|已提交|感谢您的申请|submitted successfully/i;

    const found = await waitForContent(
      page,
      async () => {
        const text = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
        return SUCCESS_PATTERN.test(text);
      },
      { timeoutMs: 10_000 },
    );

    if (found) {
      const text = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '');
      const line = text.split('\n').find((part) => SUCCESS_PATTERN.test(part)) ?? '提交成功';
      return { submitted: true, confirmationText: line.trim(), detail: '页面出现成功提示' };
    }

    if (/candidateHome\/(applications|resume)/.test(page.url())) {
      return {
        submitted: true,
        confirmationText: '',
        detail: 'URL 跳转到投递记录页，但未找到明确的成功提示，请人工确认',
      };
    }

    return { submitted: false, confirmationText: '', detail: '未检测到任何提交成功的证据' };
  }
}

export const mokaAdapter = new MokaAdapter();
