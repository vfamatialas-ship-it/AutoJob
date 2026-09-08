/**
 * Profile 各模块共用的基础类型。
 *
 * 日期是重灾区（PRD §1「日期解析错误」）：内部统一存 `YYYY-MM` 或 `YYYY-MM-DD`，
 * 结束时间额外允许 `present`（至今）。招聘网站要什么格式，由 M4 的 Mapping 层转换，
 * **Profile 内部只保留一种规范形式**。
 */

import { z } from 'zod';

/** 稳定标识符。用于 Application 引用具体经历、Diff 溯源、Mapping Memory 记录。 */
export const IdSchema = z.string().min(1, 'id 不能为空');
export type Id = z.infer<typeof IdSchema>;

export const NonEmptyString = z.string().trim().min(1);

/** 规范日期：YYYY-MM 或 YYYY-MM-DD */
export const DateSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/, '日期须为 YYYY-MM 或 YYYY-MM-DD');
export type DateString = z.infer<typeof DateSchema>;

/** 结束日期：规范日期，或 present（至今） */
export const EndDateSchema = z.union([DateSchema, z.literal('present')]);
export type EndDate = z.infer<typeof EndDateSchema>;

/** 时间区间。校验 start <= end，避免把倒挂的日期填进网站被拒。 */
export const DateRangeSchema = z
  .object({
    startDate: DateSchema,
    endDate: EndDateSchema,
  })
  .refine(
    ({ startDate, endDate }) =>
      endDate === 'present' || normalizeDate(startDate) <= normalizeDate(endDate),
    { message: '开始日期不能晚于结束日期', path: ['endDate'] },
  );

/** 补齐到 YYYY-MM-DD 以便字符串比较 */
export function normalizeDate(value: DateString): string {
  return value.length === 7 ? `${value}-01` : value;
}

export const LanguageSchema = z.enum(['zh', 'en']);
export type Language = z.infer<typeof LanguageSchema>;

/** 外部链接。semanticType 让 Mapping 层能把「个人主页 / GitHub / 作品集」对上号（PRD §15）。 */
export const LinkSchema = z.object({
  label: NonEmptyString,
  url: z.string().url('必须是合法 URL'),
});
export type Link = z.infer<typeof LinkSchema>;
