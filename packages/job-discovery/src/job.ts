/**
 * Job —— PRD §27。
 *
 * 「第一版只抓用户输入企业 URL 对应公司的岗位。不要一开始做全网爬虫。」
 *
 * 这个克制是有道理的：全网爬虫要处理反爬、限流、法律合规一大堆问题，
 * 而实际收益很小 —— 秋招时用户本来就有一份明确的目标企业清单。
 */

import { z } from 'zod';

/** 招聘类型。校招与社招混在同一个列表里是常态，必须能区分 */
export const JobTypeSchema = z.enum(['campus', 'social', 'intern', 'unknown']);
export type JobType = z.infer<typeof JobTypeSchema>;

export const DegreeRequirementSchema = z.enum([
  'associate',
  'bachelor',
  'master',
  'doctor',
  'unknown',
]);
export type DegreeRequirement = z.infer<typeof DegreeRequirementSchema>;

export const JobSchema = z.object({
  /** 内部 id，由指纹生成 */
  id: z.string().min(1),
  company: z.string(),
  /** 网站自己的岗位编号，从 URL 或页面提取。没有则为空 */
  externalJobId: z.string().default(''),
  title: z.string().min(1),
  department: z.string().default(''),
  location: z.string().default(''),
  jobType: JobTypeSchema.default('unknown'),
  degreeRequirement: DegreeRequirementSchema.default('unknown'),
  /** 面向的毕业年份，如 2027。解析不出则为 undefined */
  graduateYear: z.number().int().optional(),
  description: z.string().default(''),
  url: z.string(),
  publishedAt: z.string().default(''),
  /** 数据来源，例如 'generic' / 'moka' */
  source: z.string().default('generic'),
  atsType: z.string().default('unknown'),
});

export type Job = z.infer<typeof JobSchema>;

// ————————————————————————————————————————————————
// 文本 → 结构化字段
// ————————————————————————————————————————————————

const DEGREE_PATTERNS: ReadonlyArray<readonly [RegExp, DegreeRequirement]> = [
  [/博士/, 'doctor'],
  [/硕士|研究生/, 'master'],
  [/本科|学士/, 'bachelor'],
  [/专科|大专/, 'associate'],
];

export function parseDegree(text: string): DegreeRequirement {
  for (const [pattern, degree] of DEGREE_PATTERNS) {
    if (pattern.test(text)) return degree;
  }
  return 'unknown';
}

const JOB_TYPE_PATTERNS: ReadonlyArray<readonly [RegExp, JobType]> = [
  [/实习/, 'intern'],
  [/校园招聘|校招|应届/, 'campus'],
  [/社会招聘|社招/, 'social'],
];

export function parseJobType(text: string): JobType {
  for (const [pattern, type] of JOB_TYPE_PATTERNS) {
    if (pattern.test(text)) return type;
  }
  return 'unknown';
}

/**
 * 常见城市。用固定表而不是「任意两三个字」的模式 ——
 * 后者会把「研究院」「智能中心」这类部门名误判成地点。
 */
const CITIES: readonly string[] = [
  '北京',
  '上海',
  '广州',
  '深圳',
  '杭州',
  '南京',
  '苏州',
  '成都',
  '重庆',
  '武汉',
  '西安',
  '天津',
  '青岛',
  '厦门',
  '长沙',
  '合肥',
  '郑州',
  '济南',
  '宁波',
  '无锡',
  '大连',
  '沈阳',
  '哈尔滨',
  '福州',
  '东莞',
  '珠海',
  '佛山',
  '昆山',
  '常州',
  '烟台',
  '香港',
  '澳门',
  '台北',
  '远程',
];

export function parseLocation(text: string): string {
  const hits = CITIES.filter((city) => text.includes(city));
  return hits.join('、');
}

/** 从文本里找毕业年份，如「2027 届」 */
export function parseGraduateYear(text: string): number | undefined {
  const match = /(20\d{2})\s*届/.exec(text);
  if (match?.[1] === undefined) return undefined;
  return Number(match[1]);
}

/**
 * 从 URL 中提取岗位编号。
 *
 * 查找顺序是**从最可能是岗位标识的位置开始**：
 *
 * 1. **hash 路由**（`#/job/093114fd-...`）—— SPA 型 ATS 把岗位 id 放这儿。
 *    这一条必须最先查：Moka 的页面 URL 形如
 *    `/campus-recruitment/dji/143359#/job/<uuid>`，若先看路径末段会取到
 *    `143359`（那是**页面 id**，全站所有岗位都一样），导致 30 个岗位被
 *    去重成 1 个。这个坑是在真实站点上踩到的。
 * 2. query 参数（`?id=J1001`）
 * 3. 路径末段（`/job/J1001`）
 */
export function parseExternalJobId(url: string): string {
  try {
    const parsed = new URL(url, 'https://placeholder.invalid');

    // 1. hash 路由。`#/job/abc` 取 abc；纯锚点（`#top`）不算
    const hash = parsed.hash.replace(/^#/, '');
    if (hash.includes('/')) {
      const hashPath = hash.split('?')[0] ?? '';
      const segment = hashPath
        .split('/')
        .filter((part) => part.length > 0)
        .at(-1);
      if (segment !== undefined && segment.length >= 3) return segment;
    }

    // 2. query 参数
    for (const key of ['id', 'jid', 'jobId', 'job_id', 'positionId', 'code']) {
      const value = parsed.searchParams.get(key);
      if (value !== null && value.length > 0) return value;
    }

    // 3. 路径末段，形如 /job/J1001 或 /position/12345
    const segments = parsed.pathname.split('/').filter((part) => part.length > 0);
    const last = segments.at(-1) ?? '';
    if (/^[A-Za-z]*\d{3,}$/.test(last)) return last;

    return '';
  } catch {
    return '';
  }
}
