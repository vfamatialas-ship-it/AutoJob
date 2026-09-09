/**
 * JobPreference —— PRD §28。
 *
 * 用户的求职偏好。它同时服务于两件事：
 *   - Hard Filter：不满足的直接 Reject，不浪费后续算力与用户注意力
 *   - Deterministic Score：命中关键词加分
 *
 * 分开这两者很重要：「不接受销售岗」是硬条件，「偏好机器人方向」是软偏好。
 * 把软偏好当硬条件会漏掉边缘但合适的岗位；反过来则会让列表里全是垃圾。
 */

import { z } from 'zod';

export const JobPreferenceSchema = z.object({
  /** 命中即加分的关键词 */
  keywordsInclude: z.array(z.string()).default([]),
  /** 命中即直接淘汰的关键词 —— 硬条件 */
  keywordsExclude: z.array(z.string()).default([]),

  preferredCities: z.array(z.string()).default([]),
  /** 明确不去的城市 —— 硬条件 */
  excludedCities: z.array(z.string()).default([]),

  /** 目标岗位方向，用于 Role Match 打分 */
  targetRoles: z.array(z.string()).default([]),

  /** 本人学历，用于判断是否满足岗位学历要求 */
  degree: z.enum(['associate', 'bachelor', 'master', 'doctor']).default('master'),
  /** 毕业年份 */
  graduationYear: z.number().int().optional(),

  /** 只看校招 / 也看实习。社招通常不适合应届生 */
  acceptJobTypes: z
    .array(z.enum(['campus', 'social', 'intern', 'unknown']))
    .default(['campus', 'intern', 'unknown']),

  companyBlacklist: z.array(z.string()).default([]),
  companyWhitelist: z.array(z.string()).default([]),
});

export type JobPreference = z.infer<typeof JobPreferenceSchema>;

/**
 * 面向机器人 / 具身智能方向的默认偏好。
 *
 * PRD §28 给的示例正是这个方向，直接作为默认值 ——
 * 用户改起来比从零填起来容易得多。
 */
export const DEFAULT_PREFERENCE: JobPreference = JobPreferenceSchema.parse({
  keywordsInclude: [
    '机器人',
    '具身智能',
    'VLA',
    '强化学习',
    '运动规划',
    '自动驾驶',
    '规控',
    '控制算法',
    '大模型',
    '多模态',
    '感知',
    '算法',
  ],
  keywordsExclude: ['销售', 'Java', '前端', '测试', '运营', '客服', '人力资源', '财务'],
  targetRoles: ['算法工程师', '研发工程师', '研究员'],
  degree: 'master',
  acceptJobTypes: ['campus', 'intern', 'unknown'],
});

const DEGREE_RANK: Record<string, number> = {
  associate: 1,
  bachelor: 2,
  master: 3,
  doctor: 4,
  unknown: 0,
};

/** 本人学历是否满足岗位要求 */
export function satisfiesDegree(candidate: string, required: string): boolean {
  if (required === 'unknown') return true;
  return (DEGREE_RANK[candidate] ?? 0) >= (DEGREE_RANK[required] ?? 0);
}
