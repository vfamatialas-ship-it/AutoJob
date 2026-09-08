/**
 * Question Bank —— PRD §18。
 * Referral Code —— PRD §32。
 *
 * 校招里同样的问题反复出现（是否接受调剂、期望城市、最快到岗时间……），
 * 但每个网站措辞都不一样。用 canonicalQuestion + semanticType 归一，
 * 匹配到就自动回答，匹配不到或置信度不足就问用户，并把答案存回来。
 */

import { z } from 'zod';
import { DateSchema, IdSchema, NonEmptyString } from './common.js';

/** 常见校招问题的语义类型 */
export const QuestionSemanticTypeSchema = z.enum([
  'accept_position_transfer', // 是否接受岗位调剂
  'accept_location_transfer', // 是否接受工作地点调剂
  'expected_city', // 期望城市
  'expected_salary', // 期望薪资
  'accept_overtime', // 是否接受加班
  'available_date', // 最快到岗时间
  'non_compete', // 是否签署竞业协议
  'relatives_in_company', // 是否有亲属在本公司
  'english_level', // 英语等级
  'accept_business_trip', // 是否接受出差
  'has_criminal_record', // 是否有犯罪记录
  'source_channel', // 获知招聘信息的渠道
  'other',
]);
export type QuestionSemanticType = z.infer<typeof QuestionSemanticTypeSchema>;

export const AnswerTypeSchema = z.enum([
  'boolean',
  'text',
  'number',
  'date',
  'single_choice',
  'multi_choice',
]);
export type AnswerType = z.infer<typeof AnswerTypeSchema>;

export const QuestionSchema = z.object({
  id: IdSchema,
  /** 归一后的标准问法 */
  canonicalQuestion: NonEmptyString,
  semanticType: QuestionSemanticTypeSchema,
  answerType: AnswerTypeSchema,
  /** 答案。boolean 存 'true'/'false'，multi_choice 用 \n 分隔 */
  answer: z.string(),
  /**
   * 该答案适用的场景限制，例如 ['国企'] 表示只在国企投递时使用。
   * 留空表示全局适用。
   */
  allowedContexts: z.array(NonEmptyString).default([]),
  /** 用户确认过的答案置信度为 1；由 LLM 推断的低于 1 */
  confidence: z.number().min(0).max(1).default(1),
  /** 网站上见过的原始问法，用于改进匹配 */
  observedPhrasings: z.array(NonEmptyString).default([]),
});

export type Question = z.infer<typeof QuestionSchema>;

/** 置信度阈值 —— PRD §53 */
export const CONFIDENCE_AUTO = 0.9;
export const CONFIDENCE_MIN = 0.7;

export type ConfidenceAction = 'auto' | 'auto_with_warning' | 'ask_user';

/**
 * 按置信度决定处理方式（PRD §53）：
 *   >= 0.9      自动
 *   0.7 – 0.9   自动，但在 Diff 中标注
 *   < 0.7       进入 WAITING_USER，绝不猜测
 */
export function confidenceAction(confidence: number): ConfidenceAction {
  if (confidence >= CONFIDENCE_AUTO) return 'auto';
  if (confidence >= CONFIDENCE_MIN) return 'auto_with_warning';
  return 'ask_user';
}

/** 该问题在给定场景下是否可用 */
export function isQuestionApplicable(question: Question, context: readonly string[]): boolean {
  if (question.allowedContexts.length === 0) return true;
  return question.allowedContexts.some((allowed) => context.includes(allowed));
}

/**
 * Referral Code —— PRD §32。
 * 内推码按公司维护，带有效期；过期的不填，避免投递被判无效。
 */
export const ReferralCodeSchema = z
  .object({
    id: IdSchema,
    companyId: NonEmptyString,
    companyName: NonEmptyString,
    code: NonEmptyString,
    /** 来源，例如「学长内推」「宣讲会」 */
    source: z.string().trim().default(''),
    note: z.string().default(''),
    validFrom: DateSchema.optional(),
    expireAt: DateSchema.optional(),
  })
  .refine(
    ({ validFrom, expireAt }) =>
      validFrom === undefined || expireAt === undefined || validFrom <= expireAt,
    { message: '生效时间不能晚于过期时间', path: ['expireAt'] },
  );

export type ReferralCode = z.infer<typeof ReferralCodeSchema>;

/** 内推码在指定日期是否有效 */
export function isReferralCodeValid(code: ReferralCode, on: string): boolean {
  if (code.validFrom !== undefined && on < code.validFrom) return false;
  if (code.expireAt !== undefined && on > code.expireAt) return false;
  return true;
}

/** 查询某公司当前有效的内推码 */
export function findReferralCode(
  codes: readonly ReferralCode[],
  companyId: string,
  on: string,
): ReferralCode | undefined {
  return codes.find((code) => code.companyId === companyId && isReferralCodeValid(code, on));
}
