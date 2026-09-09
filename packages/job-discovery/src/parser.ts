/**
 * RawJobItem[] → Job[]。
 *
 * 纯函数，不碰 DOM，可完整单元测试。
 * 浏览器侧只负责「找出重复结构」，语义解析（哪个片段是地点、哪个是学历）都在这里。
 */

import { createHash } from 'node:crypto';
import {
  JobSchema,
  parseDegree,
  parseExternalJobId,
  parseGraduateYear,
  parseJobType,
  parseLocation,
  type Job,
} from './job.js';
import type { RawJobItem, RawJobList } from './extract-script.js';

export interface ParseOptions {
  readonly company: string;
  /** 页面 URL，用于把相对链接补全成绝对链接 */
  readonly baseUrl: string;
  readonly atsType?: string;
  readonly source?: string;
}

/** 岗位指纹 —— 与 database 包的去重口径保持一致（PRD §30） */
function jobId(company: string, externalId: string, title: string, location: string): string {
  if (externalId.length > 0) return `${company}:${externalId}`;
  const material = [company, title, location].map((part) => part.trim().toLowerCase()).join('|');
  return `hash:${createHash('sha256').update(material).digest('hex').slice(0, 16)}`;
}

/** 编号不可用时的兜底 id：按公司+标题+地点做 hash */
function fallbackId(job: Job): string {
  return jobId(job.company, '', job.title, job.location);
}

function absoluteUrl(url: string, baseUrl: string): string {
  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return url;
  }
}

/**
 * 部门名的识别。
 *
 * 没有可靠特征可用，只能靠后缀词。宁可留空也不要乱猜 ——
 * 部门填错不影响投递成败，但会让 Diff 里出现莫名其妙的内容。
 */
const DEPARTMENT_SUFFIX = /(研究院|研究所|事业部|中心|部门|部|组|团队|Lab|实验室)$/;

function parseDepartment(fields: readonly string[]): string {
  return fields.find((field) => DEPARTMENT_SUFFIX.test(field) && field.length <= 12) ?? '';
}

/** 日期片段，如 2026-09-01 */
function parsePublishedAt(fields: readonly string[]): string {
  return fields.find((field) => /^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(field)) ?? '';
}

export function parseJobItem(item: RawJobItem, options: ParseOptions): Job | undefined {
  const title = item.title.trim();

  // 太短的多半是「详情」「申请」这类操作链接，太长的多半是正文段落
  if (title.length < 2 || title.length > 60) return undefined;

  const url = absoluteUrl(item.url, options.baseUrl);
  const externalJobId = parseExternalJobId(url);
  const location = parseLocation(item.text);
  const graduateYear = parseGraduateYear(item.text);

  return JobSchema.parse({
    id: jobId(options.company, externalJobId, title, location),
    company: options.company,
    externalJobId,
    title,
    department: parseDepartment(item.fields),
    location,
    jobType: parseJobType(item.text),
    degreeRequirement: parseDegree(item.text),
    ...(graduateYear === undefined ? {} : { graduateYear }),
    description: item.text,
    url,
    publishedAt: parsePublishedAt(item.fields),
    source: options.source ?? 'generic',
    atsType: options.atsType ?? 'unknown',
  });
}

export interface ParsedJobList {
  readonly jobs: readonly Job[];
  /** 选中的那组结构签名，便于排查「为什么抓到的是导航栏」 */
  readonly signature: string;
  readonly score: number;
  /** 被跳过的候选组数量 */
  readonly discardedGroups: number;
}

/**
 * 从候选组中选出职位列表并解析。
 *
 * 只取得分最高的一组。取多组合并听起来更全，实际会把导航栏、
 * 推荐位混进来 —— 一份混着「关于我们」「隐私政策」的岗位列表毫无用处。
 */
export function parseJobList(
  candidates: readonly RawJobList[],
  options: ParseOptions,
): ParsedJobList {
  const best = candidates[0];
  if (best === undefined) {
    return { jobs: [], signature: '', score: 0, discardedGroups: 0 };
  }

  const parsed = best.items
    .map((item) => parseJobItem(item, options))
    .filter((job): job is Job => job !== undefined);

  /*
   * 防线：如果整组岗位解析出的编号**完全一样**，那它就不是岗位编号 ——
   * 更可能是页面 id 或租户 id。拿它做去重会把整页岗位压成一条。
   *
   * 这不是假想的情况：真实站点的 URL 形如
   * `/campus-recruitment/dji/143359#/job/<uuid>`，早期版本从路径末段取到
   * `143359`，30 个岗位于是共用同一个 id，最终只剩 1 条。
   * 编号提取本身已修好，这里再兜一层，防止别的站点用别的方式重蹈覆辙。
   */
  const distinctExternalIds = new Set(
    parsed.map((job) => job.externalJobId).filter((id) => id.length > 0),
  );
  const externalIdIsUseless = parsed.length > 1 && distinctExternalIds.size === 1;

  const jobs: Job[] = [];
  const seen = new Set<string>();

  for (const job of parsed) {
    const effective = externalIdIsUseless
      ? { ...job, externalJobId: '', id: fallbackId(job) }
      : job;
    if (seen.has(effective.id)) continue; // 同一岗位在页面上出现多次是常见的
    seen.add(effective.id);
    jobs.push(effective);
  }

  return {
    jobs,
    signature: best.signature,
    score: best.score,
    discardedGroups: candidates.length - 1,
  };
}
