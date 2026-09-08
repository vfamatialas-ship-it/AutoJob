/**
 * Profile 查询层。
 *
 * M4 的 Mapping Engine 只跟这一层打交道：
 * 「给我所有能填进『科研经历』栏的经历」，而不是自己遍历数组判断 type。
 * 把过滤逻辑收在这里，红线规则才有唯一的执行点。
 */

import { canMapAwardTo, sortAwardsByWeight, type Award, type AwardTarget } from './award.js';
import { canMapExperienceTo, type Experience, type ExperienceTarget } from './experience.js';
import { normalizeDate } from './common.js';
import type { CandidateProfile } from './profile.js';

export interface QueryOptions {
  /** 最多返回几条（网站常限制条数） */
  readonly limit?: number;
}

/** 结束时间越晚越靠前，present 视为最新 */
function byRecency(a: { endDate: string }, b: { endDate: string }): number {
  const value = (end: string): string => (end === 'present' ? '9999-99-99' : normalizeDate(end));
  return value(b.endDate).localeCompare(value(a.endDate));
}

export interface ExperienceQueryResult {
  readonly matched: readonly Experience[];
  /** 被拒绝的经历及原因 —— 供 Application Diff 展示「为什么没填这条」 */
  readonly rejected: ReadonlyArray<{ experience: Experience; reason: string }>;
}

/**
 * 查询能填入指定网站栏目的经历。
 *
 * 这是防串档的**唯一执行点**：shouldNotMapTo 在此生效，
 * 任何绕过本函数直接读 profile.experiences 的代码都是 bug。
 */
export function queryExperiences(
  profile: CandidateProfile,
  target: ExperienceTarget,
  options: QueryOptions = {},
): ExperienceQueryResult {
  const matched: Experience[] = [];
  const rejected: Array<{ experience: Experience; reason: string }> = [];

  for (const experience of profile.experiences) {
    const verdict = canMapExperienceTo(experience, target);
    if (verdict.allowed) matched.push(experience);
    else rejected.push({ experience, reason: verdict.reason });
  }

  matched.sort(byRecency);
  return {
    matched: options.limit === undefined ? matched : matched.slice(0, options.limit),
    rejected,
  };
}

export interface AwardQueryResult {
  readonly matched: readonly Award[];
  readonly rejected: ReadonlyArray<{ award: Award; reason: string }>;
}

/**
 * 查询能填入指定奖项栏目的奖项。
 * 按含金量排序，网站限制条数时自动取最重要的几项。
 */
export function queryAwards(
  profile: CandidateProfile,
  target: AwardTarget,
  options: QueryOptions = {},
): AwardQueryResult {
  const matched: Award[] = [];
  const rejected: Array<{ award: Award; reason: string }> = [];

  for (const award of profile.awards) {
    const verdict = canMapAwardTo(award, target);
    if (verdict.allowed) matched.push(award);
    else rejected.push({ award, reason: verdict.reason });
  }

  const sorted = sortAwardsByWeight(matched);
  return {
    matched: options.limit === undefined ? sorted : sorted.slice(0, options.limit),
    rejected,
  };
}

/**
 * 网站没有独立科研栏时，科研经历会被并入项目经历。
 * 这个函数识别出「发生了降级」的经历，M6 据此生成 warning（PRD §35）。
 */
export function findDowngradedExperiences(
  profile: CandidateProfile,
  availableTargets: readonly ExperienceTarget[],
): ReadonlyArray<{
  experience: Experience;
  preferred: ExperienceTarget;
  actual: ExperienceTarget;
}> {
  if (availableTargets.includes('research_experience')) return [];

  const fallback = availableTargets.find((target) => target === 'project_experience');
  if (fallback === undefined) return [];

  return profile.experiences
    .filter((experience) => ['research', 'research_project'].includes(experience.experienceType))
    .filter((experience) => canMapExperienceTo(experience, fallback).allowed)
    .map((experience) => ({
      experience,
      preferred: 'research_experience' as const,
      actual: fallback,
    }));
}
