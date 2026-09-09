/**
 * Job Matching —— PRD §29。
 *
 * 「不要完全使用 LLM。采用三层结构。」
 *
 *   第一层 Hard Filter        不满足硬条件直接 Reject
 *   第二层 Deterministic Score  技能 / 关键词 / 岗位 / 地点 匹配
 *   第三层 LLM Semantic Score   语义理解
 *
 * ## 为什么第三层暂时不做
 *
 * M3 的经验：规则层在 50 个字段上实测未识别率为 0，LLM 未必需要。
 * 这里同理 —— 先把前两层做扎实，看它能不能把「Java 后端」和
 * 「具身智能算法」区分开。能，就不必为了架构完整性去接 LLM。
 *
 * 接口已经留好（`SemanticScorer`），要接的时候不用改调用方。
 *
 * ## 为什么打分要可解释
 *
 * 「这个岗位 87 分」本身没有意义，用户没法据此决定投不投。
 * 有意义的是「技能命中 VLA / 强化学习，地点是你的首选城市，
 * 但要求博士而你是硕士」—— 所以每一项得分都带 reason。
 */

import type { Job } from '@autojob/job-discovery';
import type { CandidateProfile } from '@autojob/candidate-profile';
import { satisfiesDegree, type JobPreference } from './preference.js';

// ————————————————————————————————————————————————
// 第一层：Hard Filter
// ————————————————————————————————————————————————

export const RejectReason = {
  EXCLUDED_KEYWORD: 'EXCLUDED_KEYWORD',
  EXCLUDED_CITY: 'EXCLUDED_CITY',
  DEGREE_NOT_MET: 'DEGREE_NOT_MET',
  JOB_TYPE_NOT_ACCEPTED: 'JOB_TYPE_NOT_ACCEPTED',
  COMPANY_BLACKLISTED: 'COMPANY_BLACKLISTED',
} as const;

export type RejectReason = (typeof RejectReason)[keyof typeof RejectReason];

export interface HardFilterResult {
  readonly passed: boolean;
  readonly reason?: RejectReason;
  readonly detail?: string;
}

export function hardFilter(job: Job, preference: JobPreference): HardFilterResult {
  const haystack = `${job.title} ${job.department} ${job.description}`.toLowerCase();

  if (preference.companyBlacklist.some((name) => job.company.includes(name))) {
    return {
      passed: false,
      reason: RejectReason.COMPANY_BLACKLISTED,
      detail: `${job.company} 在黑名单中`,
    };
  }

  const excluded = preference.keywordsExclude.find((keyword) =>
    haystack.includes(keyword.toLowerCase()),
  );
  if (excluded !== undefined) {
    return {
      passed: false,
      reason: RejectReason.EXCLUDED_KEYWORD,
      detail: `命中排除关键词「${excluded}」`,
    };
  }

  if (job.location.length > 0) {
    const bannedCity = preference.excludedCities.find((city) => job.location.includes(city));
    if (bannedCity !== undefined) {
      return {
        passed: false,
        reason: RejectReason.EXCLUDED_CITY,
        detail: `工作地点 ${bannedCity} 在排除列表中`,
      };
    }
  }

  if (!satisfiesDegree(preference.degree, job.degreeRequirement)) {
    return {
      passed: false,
      reason: RejectReason.DEGREE_NOT_MET,
      detail: `岗位要求 ${job.degreeRequirement}，本人 ${preference.degree}`,
    };
  }

  if (!preference.acceptJobTypes.includes(job.jobType)) {
    return {
      passed: false,
      reason: RejectReason.JOB_TYPE_NOT_ACCEPTED,
      detail: `岗位类型 ${job.jobType} 不在接受范围内`,
    };
  }

  return { passed: true };
}

// ————————————————————————————————————————————————
// 第二层：确定性打分
// ————————————————————————————————————————————————

export interface ScoreComponent {
  readonly name: string;
  /** 该维度得分 */
  readonly score: number;
  /** 该维度满分 */
  readonly max: number;
  /** 为什么是这个分，直接展示给用户 */
  readonly reason: string;
}

const normalize = (value: string): string => value.toLowerCase().replace(/[\s\-_]/g, '');

/**
 * 技能名的限定词后缀。
 *
 * 用户常把技能写成「VLA 模型」「强化学习算法」，而岗位描述里只写「VLA」。
 * 不剥掉这层限定词就会漏匹配 —— 这是实测中发现的真实问题，不是假想的边界情况。
 */
const SKILL_QUALIFIER = /(模型|算法|技术|框架|开发|工程|系统)$/;

/** 技能的全部可匹配形态：原名、剥掉限定词的名、以及登记的同义词 */
function skillTerms(skill: { name: string; keywords: readonly string[] }): string[] {
  const stripped = skill.name.trim().replace(SKILL_QUALIFIER, '').trim();
  const terms = [skill.name, ...skill.keywords];

  // 剥完至少还得剩 2 个字符才有区分度，否则「算法」这类会满页命中
  if (stripped.length >= 2 && stripped !== skill.name) terms.push(stripped);

  return terms.filter((term) => term.length >= 2);
}

/** 技能匹配：Profile 里的技能（含同义词与去限定词形态）出现在岗位描述中 */
function scoreSkills(job: Job, profile: CandidateProfile): ScoreComponent {
  const haystack = normalize(`${job.title} ${job.description}`);

  const matched = profile.skills.filter((skill) =>
    skillTerms(skill).some((term) => haystack.includes(normalize(term))),
  );

  const max = 35;
  // 命中 4 项即满分。要求全中不现实，也没必要
  const score = Math.min(matched.length / 4, 1) * max;

  return {
    name: '技能匹配',
    score: Math.round(score * 10) / 10,
    max,
    reason:
      matched.length > 0
        ? `命中 ${matched.map((skill) => skill.name).join('、')}`
        : '岗位描述中未命中任何已登记技能',
  };
}

/** 关键词匹配：偏好里的方向词 */
function scoreKeywords(job: Job, preference: JobPreference): ScoreComponent {
  const haystack = normalize(`${job.title} ${job.department} ${job.description}`);
  const matched = preference.keywordsInclude.filter((keyword) =>
    haystack.includes(normalize(keyword)),
  );

  const max = 30;
  const score = Math.min(matched.length / 3, 1) * max;

  return {
    name: '方向匹配',
    score: Math.round(score * 10) / 10,
    max,
    reason: matched.length > 0 ? `命中 ${matched.join('、')}` : '未命中任何偏好方向',
  };
}

/** 岗位角色匹配：标题里是否是目标角色 */
function scoreRole(job: Job, preference: JobPreference): ScoreComponent {
  const title = normalize(job.title);
  const matched = preference.targetRoles.filter((role) => title.includes(normalize(role)));

  const max = 15;
  return {
    name: '岗位类型',
    score: matched.length > 0 ? max : 0,
    max,
    reason: matched.length > 0 ? `标题匹配「${matched[0]}」` : '标题不是目标岗位类型',
  };
}

/** 地点匹配 */
function scoreLocation(job: Job, preference: JobPreference): ScoreComponent {
  const max = 20;

  if (preference.preferredCities.length === 0) {
    return { name: '工作地点', score: max * 0.6, max, reason: '未设置城市偏好，按中性计分' };
  }
  if (job.location.length === 0) {
    return { name: '工作地点', score: max * 0.5, max, reason: '岗位未标注地点' };
  }

  const hit = preference.preferredCities.find((city) => job.location.includes(city));
  return {
    name: '工作地点',
    score: hit === undefined ? 0 : max,
    max,
    reason: hit === undefined ? `${job.location} 不在偏好城市中` : `${hit} 是你的偏好城市`,
  };
}

// ————————————————————————————————————————————————
// 第三层接口（尚未实现）
// ————————————————————————————————————————————————

/**
 * 语义打分器。接入 LLM 时实现它即可，调用方无需改动。
 *
 * 刻意只传 job 与 Profile 的**安全副本** —— 真实联系方式不进 LLM（PRD §42）。
 */
export interface SemanticScorer {
  score(input: {
    job: Job;
    candidateSummary: string;
  }): Promise<{ score: number; reason: string; matchedSkills: string[]; risks: string[] }>;
}

// ————————————————————————————————————————————————
// 汇总
// ————————————————————————————————————————————————

export interface MatchResult {
  readonly job: Job;
  /** 0–100 */
  readonly score: number;
  readonly passed: boolean;
  readonly rejectReason?: RejectReason;
  readonly rejectDetail?: string;
  readonly components: readonly ScoreComponent[];
  /** 一句话结论，直接给用户看 */
  readonly summary: string;
  /** 该岗位是否已投递过（由调用方填入） */
  readonly alreadyApplied?: boolean;
}

export interface MatchOptions {
  readonly preference: JobPreference;
  readonly profile: CandidateProfile;
  /** 已投递过的岗位指纹集合，用于标记（PRD §30） */
  readonly appliedJobIds?: ReadonlySet<string>;
}

export function matchJob(job: Job, options: MatchOptions): MatchResult {
  const alreadyApplied = options.appliedJobIds?.has(job.id) ?? false;
  const filter = hardFilter(job, options.preference);

  if (!filter.passed) {
    return {
      job,
      score: 0,
      passed: false,
      ...(filter.reason === undefined ? {} : { rejectReason: filter.reason }),
      ...(filter.detail === undefined ? {} : { rejectDetail: filter.detail }),
      components: [],
      summary: filter.detail ?? '未通过硬性筛选',
      alreadyApplied,
    };
  }

  const components = [
    scoreSkills(job, options.profile),
    scoreKeywords(job, options.preference),
    scoreRole(job, options.preference),
    scoreLocation(job, options.preference),
  ];

  const total = components.reduce((sum, item) => sum + item.score, 0);
  const maxTotal = components.reduce((sum, item) => sum + item.max, 0);
  const score = Math.round((total / maxTotal) * 100);

  // 摘要只挑得分最高的两项说 —— 全列出来用户不会看
  const highlights = [...components]
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score / b.max - a.score / a.max)
    .slice(0, 2)
    .map((item) => item.reason);

  return {
    job,
    score,
    passed: true,
    components,
    summary: highlights.length > 0 ? highlights.join('；') : '各维度均无明显匹配',
    alreadyApplied,
  };
}

/** 批量匹配并按分数倒序。被硬过滤的排在最后。 */
export function matchJobs(jobs: readonly Job[], options: MatchOptions): MatchResult[] {
  return jobs
    .map((job) => matchJob(job, options))
    .sort((a, b) => {
      if (a.passed !== b.passed) return a.passed ? -1 : 1;
      return b.score - a.score;
    });
}

export interface MatchSummary {
  readonly total: number;
  readonly passed: number;
  readonly rejected: number;
  readonly alreadyApplied: number;
  readonly rejectionsByReason: Record<string, number>;
}

export function summarizeMatches(results: readonly MatchResult[]): MatchSummary {
  const rejectionsByReason: Record<string, number> = {};
  for (const result of results) {
    if (result.rejectReason === undefined) continue;
    rejectionsByReason[result.rejectReason] = (rejectionsByReason[result.rejectReason] ?? 0) + 1;
  }

  return {
    total: results.length,
    passed: results.filter((item) => item.passed).length,
    rejected: results.filter((item) => !item.passed).length,
    alreadyApplied: results.filter((item) => item.alreadyApplied === true).length,
    rejectionsByReason,
  };
}
