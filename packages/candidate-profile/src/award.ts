/**
 * Award —— PRD §13。
 *
 * 「绝对不要将所有奖项存成一个数组。」
 *
 * 现实中招聘网站分两派：
 *   A. 只有一个「荣誉奖励」栏  → 所有奖项合并进去
 *   B. 分别要求「奖学金」和「竞赛获奖」 → 必须正确拆开
 *
 * 单一数组无法同时满足两者，所以每个奖项带 category，
 * 再由 DEFAULT_AWARD_MAPPING 决定它能进哪些栏目、绝不能进哪些。
 *
 * 红线：奖学金不得进竞赛栏，竞赛奖项不得进奖学金栏（PRD §76）。
 */

import { z } from 'zod';
import { DateSchema, IdSchema, NonEmptyString } from './common.js';

export const AwardCategorySchema = z.enum([
  'scholarship', // 奖学金
  'competition_award', // 竞赛获奖
  'academic_award', // 学术奖励（论文奖等）
  'honor', // 荣誉称号
  'research_award', // 科研奖励
  'sports_award', // 体育奖励
  'other',
]);
export type AwardCategory = z.infer<typeof AwardCategorySchema>;

/** 奖项级别。用于排序与筛选（网站常限制「只填最重要的 3 项」）。 */
export const AwardLevelSchema = z.enum([
  'international', // 国际级
  'national', // 国家级
  'provincial', // 省部级
  'municipal', // 市级
  'university', // 校级
  'college', // 院系级
  'other',
]);
export type AwardLevel = z.infer<typeof AwardLevelSchema>;

/** 网站的奖项栏目类别 —— 映射目标端 */
export const AwardTargetSchema = z.enum([
  'scholarship', // 奖学金
  'competition_award', // 竞赛获奖
  'academic_award', // 学术/科研奖励
  'honor_title', // 荣誉称号
  'combined_honors', // 合并的「荣誉奖励」栏
]);
export type AwardTarget = z.infer<typeof AwardTargetSchema>;

export interface AwardMappingPolicy {
  readonly canMapTo: readonly AwardTarget[];
  readonly shouldNotMapTo: readonly AwardTarget[];
}

/**
 * category → 默认映射策略。
 *
 * 所有类别都能进 combined_honors（网站只有一栏时全部合并），
 * 但 scholarship 与 competition_award 互相硬阻断 —— 这是 PRD §13 的直接要求。
 */
export const DEFAULT_AWARD_MAPPING: Readonly<Record<AwardCategory, AwardMappingPolicy>> = {
  scholarship: {
    canMapTo: ['scholarship', 'combined_honors'],
    shouldNotMapTo: ['competition_award', 'academic_award'],
  },
  competition_award: {
    canMapTo: ['competition_award', 'combined_honors'],
    shouldNotMapTo: ['scholarship', 'honor_title'],
  },
  academic_award: {
    canMapTo: ['academic_award', 'combined_honors'],
    shouldNotMapTo: ['scholarship', 'competition_award'],
  },
  honor: {
    canMapTo: ['honor_title', 'combined_honors'],
    shouldNotMapTo: ['scholarship', 'competition_award'],
  },
  research_award: {
    canMapTo: ['academic_award', 'combined_honors'],
    shouldNotMapTo: ['scholarship', 'competition_award'],
  },
  sports_award: {
    canMapTo: ['competition_award', 'honor_title', 'combined_honors'],
    shouldNotMapTo: ['scholarship', 'academic_award'],
  },
  other: {
    canMapTo: ['combined_honors'],
    shouldNotMapTo: ['scholarship', 'competition_award'],
  },
};

export const AwardSchema = z
  .object({
    id: IdSchema,
    name: NonEmptyString,
    category: AwardCategorySchema,
    level: AwardLevelSchema,
    issuer: z.string().trim().default(''),
    date: DateSchema,
    /** 名次，例如「一等奖」「第 2 名」「Top 1%」 */
    rank: z.string().trim().default(''),
    /**
     * 奖项说明。很多网站要求「阐述竞赛内容与个人工作」，
     * 这里存完整版本，字数受限时由 M6 的 ContentAdapter 压缩。
     */
    description: z.string().default(''),
    /** 证书附件 assetId */
    certificateAsset: IdSchema.optional(),

    canMapTo: z.array(AwardTargetSchema).optional(),
    shouldNotMapTo: z.array(AwardTargetSchema).optional(),
  })
  .refine(
    (award) => {
      const can = award.canMapTo ?? [];
      const blocked = new Set(award.shouldNotMapTo ?? []);
      return !can.some((target) => blocked.has(target));
    },
    { message: 'canMapTo 与 shouldNotMapTo 存在冲突项', path: ['canMapTo'] },
  );

export type Award = z.infer<typeof AwardSchema>;

export function resolveAwardMappingPolicy(award: Award): AwardMappingPolicy {
  const fallback = DEFAULT_AWARD_MAPPING[award.category];
  return {
    canMapTo: award.canMapTo ?? fallback.canMapTo,
    shouldNotMapTo: award.shouldNotMapTo ?? fallback.shouldNotMapTo,
  };
}

export function canMapAwardTo(
  award: Award,
  target: AwardTarget,
): { allowed: boolean; reason: string } {
  const policy = resolveAwardMappingPolicy(award);

  if (policy.shouldNotMapTo.includes(target)) {
    return {
      allowed: false,
      reason: `「${award.name}」是 ${award.category}，明确禁止映射到 ${target}`,
    };
  }
  if (policy.canMapTo.includes(target)) {
    return { allowed: true, reason: `${award.category} 允许映射到 ${target}` };
  }
  return { allowed: false, reason: `${award.category} 未声明可映射到 ${target}` };
}

const LEVEL_WEIGHT: Record<AwardLevel, number> = {
  international: 60,
  national: 50,
  provincial: 40,
  municipal: 30,
  university: 20,
  college: 10,
  other: 0,
};

/**
 * 按含金量排序（级别优先，同级按时间倒序）。
 * 网站限制「最多填 3 项」时，用它挑出最有分量的。
 */
export function sortAwardsByWeight(awards: readonly Award[]): Award[] {
  return [...awards].sort((a, b) => {
    const diff = LEVEL_WEIGHT[b.level] - LEVEL_WEIGHT[a.level];
    return diff !== 0 ? diff : b.date.localeCompare(a.date);
  });
}
