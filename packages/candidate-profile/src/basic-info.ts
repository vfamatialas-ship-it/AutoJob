/**
 * BasicInfo —— PRD §7。
 *
 * 敏感字段策略（PRD §41 / §42 / §43）：
 * - `idNumber` 等字段标记为 SENSITIVE_BASIC_FIELDS，**默认禁止发送给 LLM**。
 * - 真实值由本地程序读取后直接用 Playwright 填写，LLM 只负责判断「这个网页字段是什么语义」。
 * - 数据库层预留 SensitiveFieldEncryption（M9 接系统 Keychain）。
 */

import { z } from 'zod';
import { DateSchema } from './common.js';

export const GenderSchema = z.enum(['male', 'female', 'other', 'undisclosed']);
export type Gender = z.infer<typeof GenderSchema>;

export const PoliticalStatusSchema = z.enum([
  'party_member', // 中共党员
  'probationary_party_member', // 中共预备党员
  'league_member', // 共青团员
  'democratic_party', // 民主党派
  'masses', // 群众
  'other',
]);
export type PoliticalStatus = z.infer<typeof PoliticalStatusSchema>;

export const BasicInfoSchema = z.object({
  name: z.string().trim().min(1, '姓名不能为空'),
  gender: GenderSchema.optional(),
  birthday: DateSchema.optional(),

  phone: z
    .string()
    .trim()
    .regex(/^1[3-9]\d{9}$/, '手机号格式不正确')
    .optional(),
  email: z.string().trim().email('邮箱格式不正确').optional(),
  wechat: z.string().trim().optional(),

  /** 现居地 */
  location: z.string().trim().optional(),
  /** 生源地 / 籍贯 */
  hometown: z.string().trim().optional(),
  nationality: z.string().trim().default('中国'),
  /** 民族 */
  ethnicity: z.string().trim().optional(),
  politicalStatus: PoliticalStatusSchema.optional(),

  /** 身份证号 —— 最高敏感级，绝不进入 LLM、日志、导出的公开副本 */
  idNumber: z.string().trim().optional(),

  expectedGraduationDate: DateSchema.optional(),
  /** 最快到岗时间 */
  availableDate: DateSchema.optional(),
});

export type BasicInfo = z.infer<typeof BasicInfoSchema>;

/**
 * 禁止发送给 LLM 的字段（PRD §42）。
 *
 * 注意 phone / email / idNumber 都在列：LLM 只需要知道「网页上这一栏是 PHONE」，
 * 不需要知道手机号本身是多少。
 */
export const SENSITIVE_BASIC_FIELDS = [
  'idNumber',
  'phone',
  'email',
  'wechat',
  'birthday',
  'location',
  'hometown',
] as const satisfies readonly (keyof BasicInfo)[];

export type SensitiveBasicField = (typeof SENSITIVE_BASIC_FIELDS)[number];

/** 剔除敏感字段后的 BasicInfo，可安全用于 LLM prompt。 */
export type SafeBasicInfo = Omit<BasicInfo, SensitiveBasicField>;

export function toSafeBasicInfo(info: BasicInfo): SafeBasicInfo {
  const output = { ...info };
  for (const field of SENSITIVE_BASIC_FIELDS) {
    delete output[field];
  }
  return output;
}
