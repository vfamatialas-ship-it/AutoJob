/**
 * Skill —— PRD §14。
 *
 * `evidence[]` 是关键：每项技能都要能指回具体的经历或项目。
 * 这既服务于 Job Matching（M7 算技能匹配度），
 * 也是「LLM 不得编造技能」的落地方式 —— 无 evidence 的技能不参与生成。
 */

import { z } from 'zod';
import { IdSchema, NonEmptyString } from './common.js';

export const SkillCategorySchema = z.enum([
  'programming',
  'robotics',
  'machine_learning',
  'control',
  'simulation',
  'tool',
  'language',
  'hardware',
  'other',
]);
export type SkillCategory = z.infer<typeof SkillCategorySchema>;

export const SkillLevelSchema = z.enum(['familiar', 'proficient', 'expert']);
export type SkillLevel = z.infer<typeof SkillLevelSchema>;

export const SkillSchema = z.object({
  id: IdSchema,
  name: NonEmptyString,
  category: SkillCategorySchema,
  level: SkillLevelSchema,
  /** 使用年限 */
  years: z.number().nonnegative().optional(),
  /** 佐证：关联的 experienceId / projectId，或论文、仓库链接 */
  evidence: z.array(NonEmptyString).default([]),
  /** 同义词，用于岗位 JD 关键词匹配（例如 PyTorch ↔ torch） */
  keywords: z.array(NonEmptyString).default([]),
});

export type Skill = z.infer<typeof SkillSchema>;

/** 该技能是否有佐证。无佐证的技能不得进入生成内容。 */
export const hasEvidence = (skill: Skill): boolean => skill.evidence.length > 0;

/**
 * 技能名匹配（含同义词，大小写与空格不敏感）。
 * 供 M7 的 Skill Match 打分使用。
 */
export function skillMatches(skill: Skill, keyword: string): boolean {
  const normalize = (value: string): string => value.toLowerCase().replace(/[\s_-]/g, '');
  const target = normalize(keyword);
  return [skill.name, ...skill.keywords].some((candidate) => normalize(candidate) === target);
}
