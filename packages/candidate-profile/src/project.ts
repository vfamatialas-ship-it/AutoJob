/**
 * Project —— PRD §12。
 *
 * Project 与 Experience 有重叠但不等价：一段 Experience 里可能包含多个 Project，
 * 而个人项目可以脱离任何组织存在。用 `experienceId` 建立可选关联。
 *
 * GeneratedVariants 是内容自适应的产物（PRD §31）：
 * 招聘网站对项目描述的字数限制五花八门（100/300/500 字），还常按岗位方向要求侧重点不同。
 * 变体统一存这里，且每个变体都记录它由哪些 canonicalFact 支撑，
 * M6 的校验器据此确保「没有凭空多出来的事实」。
 */

import { z } from 'zod';
import { CanonicalFactSchema } from './canonical-fact.js';
import {
  DateSchema,
  EndDateSchema,
  IdSchema,
  LinkSchema,
  NonEmptyString,
  normalizeDate,
} from './common.js';

/** 生成变体的用途标签 */
export const VariantKindSchema = z.enum([
  'short100',
  'short300',
  'short500',
  'full',
  'robotics',
  'vla',
  'control',
  'autonomous_driving',
  'reinforcement_learning',
  'custom',
]);
export type VariantKind = z.infer<typeof VariantKindSchema>;

export const GeneratedVariantSchema = z.object({
  kind: VariantKindSchema,
  /** 自定义变体的名称 */
  label: z.string().trim().default(''),
  content: NonEmptyString,
  /** 支撑该内容的 canonicalFact id 列表 —— 溯源凭证，不允许为空 */
  sourceFactIds: z.array(IdSchema).min(1, '生成内容必须至少溯源到一条 Canonical Fact'),
  /** 生成时间，用于判断 canonical 内容更新后变体是否过期 */
  generatedAt: z.string().datetime().optional(),
});
export type GeneratedVariant = z.infer<typeof GeneratedVariantSchema>;

export const ProjectSchema = z
  .object({
    id: IdSchema,
    name: NonEmptyString,
    role: z.string().trim().default(''),
    organization: z.string().trim().default(''),
    /** 所属经历。个人项目可留空 */
    experienceId: IdSchema.optional(),

    startDate: DateSchema,
    endDate: EndDateSchema,

    descriptionCanonical: z.string().default(''),
    canonicalFacts: z.array(CanonicalFactSchema).default([]),
    responsibilities: z.array(NonEmptyString).default([]),
    achievements: z.array(NonEmptyString).default([]),
    techStack: z.array(NonEmptyString).default([]),
    keywords: z.array(NonEmptyString).default([]),
    links: z.array(LinkSchema).default([]),
    attachments: z.array(IdSchema).default([]),

    generatedVariants: z.array(GeneratedVariantSchema).default([]),
  })
  .refine(
    ({ startDate, endDate }) =>
      endDate === 'present' || normalizeDate(startDate) <= normalizeDate(endDate),
    {
      message: '开始日期不能晚于结束日期',
      path: ['endDate'],
    },
  )
  .refine(
    (project) => {
      const factIds = new Set(project.canonicalFacts.map((f) => f.id));
      return project.generatedVariants.every((v) => v.sourceFactIds.every((id) => factIds.has(id)));
    },
    { message: '生成变体引用了不存在的 Canonical Fact', path: ['generatedVariants'] },
  );

export type Project = z.infer<typeof ProjectSchema>;

/**
 * 按字数上限挑选最合适的变体。
 *
 * 策略：优先取字数不超限且最长的变体（信息量最大），
 * 全都超限时返回 undefined，交给 M6 现场生成，**不做截断** ——
 * 截断会把句子切一半，比重新生成更糟。
 */
export function pickVariantForLimit(
  project: Project,
  maxLength: number,
  preferredKind?: VariantKind,
): GeneratedVariant | undefined {
  const fitting = project.generatedVariants.filter((v) => v.content.length <= maxLength);
  if (fitting.length === 0) return undefined;

  if (preferredKind !== undefined) {
    const preferred = fitting.find((v) => v.kind === preferredKind);
    if (preferred) return preferred;
  }
  return fitting.reduce((best, current) =>
    current.content.length > best.content.length ? current : best,
  );
}
