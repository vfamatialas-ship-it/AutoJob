/**
 * form-schema 与 candidate-profile 之间的类型桥接。
 *
 * 两个包各自独立（form-schema 不依赖 Profile，Profile 也不知道网页长什么样），
 * 衔接的活儿由 form-mapper 干。本文件把需要的类型集中转出，
 * 避免 mapper.ts 里散落一堆跨包 import。
 */

export {
  SEMANTIC_TO_AWARD_TARGET,
  SEMANTIC_TO_EXPERIENCE_TARGET,
  confidenceAction,
  isAttachmentType,
  isAwardType,
  isExperienceType,
  isSensitiveType,
} from '@autojob/form-schema';

export type { FormField, SemanticType, ParsedForm } from '@autojob/form-schema';

/** Asset 类型的字符串形态，避免把整个 AssetType 枚举拖进来 */
export type AssetTypeHint =
  | 'resume'
  | 'portfolio'
  | 'transcript'
  | 'paper'
  | 'patent'
  | 'certificate'
  | 'award_certificate'
  | 'student_id'
  | 'publication'
  | 'cover_letter'
  | 'photo'
  | 'other';
