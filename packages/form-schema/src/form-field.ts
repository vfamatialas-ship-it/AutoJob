/**
 * FormField —— PRD §19，网页字段的统一抽象。
 *
 * 这是 M3 交给 M4/M5 的产物：业务层只看 FormField，不接触 DOM。
 */

import { z } from 'zod';
import { SemanticTypeSchema } from './semantic-type.js';

export const FieldKindSchema = z.enum([
  'text',
  'textarea',
  'select',
  'radio',
  'checkbox',
  'date',
  'number',
  'file',
  'url',
  'email',
  'tel',
  'unknown',
]);
export type FieldKind = z.infer<typeof FieldKindSchema>;

/** 置信度处置策略 —— PRD §53 */
export const ConfidenceActionSchema = z.enum(['auto', 'auto_with_warning', 'ask_user']);
export type ConfidenceAction = z.infer<typeof ConfidenceActionSchema>;

export const CONFIDENCE_AUTO_THRESHOLD = 0.9;
export const CONFIDENCE_ASK_THRESHOLD = 0.7;

/**
 * 置信度 → 处置方式。
 *   >= 0.9      自动填写
 *   0.7 – 0.9   自动填写，但在 Application Diff 中标注供用户复核
 *   < 0.7       进入 WAITING_USER，绝不猜测
 */
export function confidenceAction(confidence: number): ConfidenceAction {
  if (confidence >= CONFIDENCE_AUTO_THRESHOLD) return 'auto';
  if (confidence >= CONFIDENCE_ASK_THRESHOLD) return 'auto_with_warning';
  return 'ask_user';
}

export const FormFieldSchema = z.object({
  /** 页面内唯一标识，取自 selector */
  id: z.string().min(1),
  selector: z.string().min(1),
  /** 归因后的字段名 */
  label: z.string(),
  /** label 从哪儿来的，供排查用 */
  labelSource: z.string(),
  kind: FieldKindSchema,
  semanticType: SemanticTypeSchema,
  /** 最终置信度 = 规则置信度 × label 来源可信度 */
  confidence: z.number().min(0).max(1),
  /** 判定依据，出现在 Diff 与日志中 */
  reason: z.string(),

  required: z.boolean(),
  disabled: z.boolean(),
  visible: z.boolean(),
  /** 所属区块，例如「教育背景」 */
  section: z.string(),
  options: z.array(z.string()),
  maxLength: z.number().int().positive().optional(),
  /** file input 的 accept */
  accept: z.string().optional(),
  /** radio / checkbox 组名 */
  groupName: z.string().optional(),
  /** 该字段是否属于可重复区块（M5 需要动态添加条目） */
  repeatable: z.boolean().default(false),
});

export type FormField = z.infer<typeof FormFieldSchema>;

/** 该字段能否自动填写 */
export const canAutoFill = (field: FormField): boolean =>
  confidenceAction(field.confidence) !== 'ask_user' && !field.disabled;

/** 需要用户确认的字段 —— UI 据此生成待办 */
export const needsUserInput = (fields: readonly FormField[]): FormField[] =>
  fields.filter((field) => confidenceAction(field.confidence) === 'ask_user');

/** 表单解析结果 */
export interface ParsedForm {
  readonly url: string;
  readonly fields: readonly FormField[];
  /** 页面指纹，用于 GenericAdapter 的 selector 缓存复用（PRD §24） */
  readonly pageSignature: string;
}

/**
 * 页面指纹：按字段的语义构成而非具体 selector 生成。
 * 这样同一 ATS 下不同企业的同类页面能命中同一份缓存。
 */
export function computePageSignature(fields: readonly FormField[]): string {
  const parts = fields
    .map((field) => `${field.semanticType}:${field.kind}`)
    .sort()
    .join('|');

  // 轻量 hash，够用即可 —— 这里不需要密码学强度
  let hash = 0;
  for (let index = 0; index < parts.length; index += 1) {
    hash = (hash * 31 + parts.charCodeAt(index)) | 0;
  }
  return `sig_${(hash >>> 0).toString(16)}_${fields.length}`;
}
