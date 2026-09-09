/**
 * GenericAdapter —— PRD §24，未知 ATS 的兜底。
 *
 * ## 它的定位在 M7 之后变了
 *
 * PRD 原本把 GenericAdapter 设想成「大部分情况都能兜住」。
 * M7 的实测给了更清醒的认识：
 *
 * - 对**服务端渲染**的传统招聘页，它工作良好
 * - 对 **SPA 型 ATS**（飞书、Moka），它需要额外的等待与路由知识才能工作
 *
 * 所以现在的定位是「先试试看，不行就明确告诉用户需要专用 Adapter」，
 * 而不是「万能方案」。诚实地承认覆盖边界，比让用户以为抓全了要好。
 */

import {
  AtsType,
  detectAts,
  type ATSAdapter,
  type AdapterJob,
  type DetectionResult,
  type ListJobsOptions,
} from '@autojob/ats-detector';
import {
  CLICK_LOAD_MORE_SCRIPT,
  EXTRACT_JOB_LIST_SCRIPT,
  parseJobList,
} from '@autojob/job-discovery';
import type { Page } from 'playwright';

const COLLECT_RESOURCES = (): string[] =>
  Array.from(document.querySelectorAll('script[src], link[href]'))
    .map((el) => el.getAttribute('src') ?? el.getAttribute('href') ?? '')
    .filter((u) => u.length > 0);

export class GenericAdapter implements ATSAdapter {
  readonly ats = AtsType.UNKNOWN;
  readonly label = '通用解析';

  async detect(page: Page, url: string): Promise<DetectionResult> {
    const resourceUrls = await page.evaluate(COLLECT_RESOURCES).catch(() => []);
    return detectAts({ url, resourceUrls });
  }

  async listJobs(
    page: Page,
    url: string,
    options: ListJobsOptions = {},
  ): Promise<readonly AdapterJob[]> {
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    const extract = async (): Promise<ReturnType<typeof parseJobList>> =>
      parseJobList(await page.evaluate(EXTRACT_JOB_LIST_SCRIPT), { company: '', baseUrl: url });

    // 轮询等待 SPA 渲染；静态页第一轮就返回
    let best = await extract();
    for (let round = 0; round < 8 && best.jobs.length < 5; round += 1) {
      await page.waitForTimeout(1_000);
      const next = await extract();
      if (next.jobs.length > best.jobs.length || next.score > best.score) best = next;
    }

    for (let round = 0; round < 20; round += 1) {
      const clicked = await page.evaluate(CLICK_LOAD_MORE_SCRIPT);
      if (!clicked.clicked) break;
      await page.waitForTimeout(500);
      const expanded = await extract();
      if (expanded.jobs.length <= best.jobs.length) break;
      best = expanded;
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

  /** 通用兜底：找「申请」类按钮点一下 */
  async openApplication(page: Page, jobUrl: string): Promise<boolean> {
    await page.goto(jobUrl, { waitUntil: 'domcontentloaded' });

    const button = page
      .locator('button, a')
      .filter({ hasText: /申请|投递|应聘|apply/i })
      .first();

    if ((await button.count()) === 0) return false;
    await button.click().catch(() => undefined);
    await page.waitForTimeout(1_200);

    const needsLogin = await page.locator('input[type="password"]').count();
    return needsLogin === 0;
  }

  async waitForForm(page: Page): Promise<boolean> {
    for (let round = 0; round < 12; round += 1) {
      if ((await page.locator('input, textarea, select').count()) >= 3) return true;
      await page.waitForTimeout(700);
    }
    return false;
  }
}

export const genericAdapter = new GenericAdapter();
