/**
 * 字段语义类型 —— PRD §19。
 *
 * 网页字段的叫法千变万化（工作经历/工作履历/任职经历），但语义只有有限几种。
 * 分类器的职责就是把任意 label 归到这里的某一个上，
 * 之后 Mapping Engine 只跟 semanticType 打交道，不关心网站怎么措辞。
 */

import { z } from 'zod';

export const SemanticTypeSchema = z.enum([
  // —— 基本信息 ——
  'PERSON_NAME',
  'GENDER',
  'BIRTHDAY',
  'PHONE',
  'EMAIL',
  'WECHAT',
  'ID_NUMBER',
  'LOCATION',
  'HOMETOWN',
  'ETHNICITY',
  'POLITICAL_STATUS',

  // —— 教育 ——
  'UNIVERSITY',
  'COLLEGE',
  'DEGREE',
  'MAJOR',
  'MINOR',
  'GPA',
  'RANKING',
  'ENROLLMENT_DATE',
  'GRADUATION_DATE',
  'COURSEWORK',

  // —— 经历（与 ExperienceTarget 一一对应）——
  'WORK_EXPERIENCE',
  'INTERNSHIP',
  'RESEARCH_EXPERIENCE',
  'PROJECT_EXPERIENCE',
  'COMPETITION_EXPERIENCE',
  'CAMPUS_ACTIVITY',
  'VOLUNTEER_EXPERIENCE',
  'ENTREPRENEURIAL_EXPERIENCE',
  /** 「社会实践」「实践经历」—— 语义天然模糊，PRD §3.6 的典型例子 */
  'SOCIAL_PRACTICE',

  // —— 奖项（与 AwardTarget 一一对应）——
  'SCHOLARSHIP',
  'COMPETITION_AWARD',
  'ACADEMIC_AWARD',
  'HONOR_TITLE',
  /** 合并的「荣誉奖励」栏 */
  'AWARD',

  // —— 技能与链接 ——
  'SKILL',
  'LANGUAGE_SKILL',
  'GITHUB',
  'PERSONAL_HOMEPAGE',
  'PORTFOLIO',
  'BLOG',

  // —— 附件 ——
  'RESUME_ATTACHMENT',
  'TRANSCRIPT_ATTACHMENT',
  'PORTFOLIO_ATTACHMENT',
  'CERTIFICATE_ATTACHMENT',
  'PHOTO_ATTACHMENT',

  // —— 求职意向与问答 ——
  'REFERRAL_CODE',
  'EXPECTED_LOCATION',
  'EXPECTED_SALARY',
  'AVAILABLE_DATE',
  'SOURCE_CHANNEL',
  /** 归入 Question Bank 处理的问题 */
  'QUESTION',

  // —— 协议与其他 ——
  'AGREEMENT',
  'OTHER',
]);

export type SemanticType = z.infer<typeof SemanticTypeSchema>;

/** 敏感字段 —— 其值禁止出现在 LLM prompt 与日志中（PRD §42 / §44） */
const SENSITIVE_TYPES: ReadonlySet<SemanticType> = new Set<SemanticType>([
  'ID_NUMBER',
  'PHONE',
  'EMAIL',
  'WECHAT',
  'BIRTHDAY',
  'LOCATION',
  'HOMETOWN',
]);

export const isSensitiveType = (type: SemanticType): boolean => SENSITIVE_TYPES.has(type);

/** 经历类语义 —— 需要走 Experience 的 canMapTo / shouldNotMapTo 检查 */
const EXPERIENCE_TYPES: ReadonlySet<SemanticType> = new Set<SemanticType>([
  'WORK_EXPERIENCE',
  'INTERNSHIP',
  'RESEARCH_EXPERIENCE',
  'PROJECT_EXPERIENCE',
  'COMPETITION_EXPERIENCE',
  'CAMPUS_ACTIVITY',
  'VOLUNTEER_EXPERIENCE',
  'ENTREPRENEURIAL_EXPERIENCE',
  'SOCIAL_PRACTICE',
]);

export const isExperienceType = (type: SemanticType): boolean => EXPERIENCE_TYPES.has(type);

/** 奖项类语义 —— 需要走 Award 的 canMapTo / shouldNotMapTo 检查 */
const AWARD_TYPES: ReadonlySet<SemanticType> = new Set<SemanticType>([
  'SCHOLARSHIP',
  'COMPETITION_AWARD',
  'ACADEMIC_AWARD',
  'HONOR_TITLE',
  'AWARD',
]);

export const isAwardType = (type: SemanticType): boolean => AWARD_TYPES.has(type);

/** 附件类语义 —— 需要走 AssetSelector */
const ATTACHMENT_TYPES: ReadonlySet<SemanticType> = new Set<SemanticType>([
  'RESUME_ATTACHMENT',
  'TRANSCRIPT_ATTACHMENT',
  'PORTFOLIO_ATTACHMENT',
  'CERTIFICATE_ATTACHMENT',
  'PHOTO_ATTACHMENT',
]);

export const isAttachmentType = (type: SemanticType): boolean => ATTACHMENT_TYPES.has(type);

/** semanticType → ExperienceTarget（M4 用它衔接 Profile 查询层） */
export const SEMANTIC_TO_EXPERIENCE_TARGET: Readonly<Partial<Record<SemanticType, string>>> = {
  WORK_EXPERIENCE: 'full_time_work',
  INTERNSHIP: 'internship',
  RESEARCH_EXPERIENCE: 'research_experience',
  PROJECT_EXPERIENCE: 'project_experience',
  COMPETITION_EXPERIENCE: 'competition_experience',
  CAMPUS_ACTIVITY: 'campus_activity',
  VOLUNTEER_EXPERIENCE: 'volunteer_experience',
  ENTREPRENEURIAL_EXPERIENCE: 'entrepreneurial_experience',
  SOCIAL_PRACTICE: 'social_practice',
};

/** semanticType → AwardTarget */
export const SEMANTIC_TO_AWARD_TARGET: Readonly<Partial<Record<SemanticType, string>>> = {
  SCHOLARSHIP: 'scholarship',
  COMPETITION_AWARD: 'competition_award',
  ACADEMIC_AWARD: 'academic_award',
  HONOR_TITLE: 'honor_title',
  AWARD: 'combined_honors',
};
