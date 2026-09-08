/**
 * 映射警告 —— PRD §35「任何非直接映射必须 warning」。
 *
 * 警告不是错误，而是**「系统做了一个判断，你最好看一眼」**。
 * 它们最终会出现在 Application Diff 里，让用户明确知道系统做了哪些转换。
 *
 * 设计原则：宁可多报，不可漏报。用户扫一眼就能忽略无关的，
 * 但漏报一次「科研被塞进工作经历」就是一次失败的投递。
 */

export const WarningCode = {
  /** 网站没有对应栏目，内容被降级填入更宽泛的栏目 */
  DOWNGRADED_TO_BROADER_FIELD: 'DOWNGRADED_TO_BROADER_FIELD',
  /** 多个类别被合并进同一个栏目（如奖学金与竞赛都进「荣誉奖励」） */
  MERGED_INTO_COMBINED_FIELD: 'MERGED_INTO_COMBINED_FIELD',
  /** 记录数超过网站限制，只填了前 N 条 */
  ITEMS_TRUNCATED: 'ITEMS_TRUNCATED',
  /** 内容超出字数限制，需要生成压缩变体 */
  CONTENT_TOO_LONG: 'CONTENT_TOO_LONG',
  /** Profile 里没有匹配的记录，该字段留空 */
  NO_MATCHING_DATA: 'NO_MATCHING_DATA',
  /** 必填字段没有数据可填 */
  REQUIRED_FIELD_EMPTY: 'REQUIRED_FIELD_EMPTY',
  /** 字段语义置信度不足，转人工 */
  LOW_CONFIDENCE: 'LOW_CONFIDENCE',
  /** 有记录被规则阻断，未填入 */
  BLOCKED_BY_RULE: 'BLOCKED_BY_RULE',
  /** 找不到符合要求的附件 */
  NO_SUITABLE_ASSET: 'NO_SUITABLE_ASSET',
  /** 该公司没有可用内推码 */
  NO_REFERRAL_CODE: 'NO_REFERRAL_CODE',
  /** 问题在 Question Bank 里没有匹配答案 */
  UNANSWERED_QUESTION: 'UNANSWERED_QUESTION',
} as const;

export type WarningCode = (typeof WarningCode)[keyof typeof WarningCode];

/** 严重程度决定 Diff 里的展示方式与是否阻断提交 */
export type WarningSeverity =
  /** 提示，用户通常可以忽略 */
  | 'info'
  /** 需要用户看一眼 */
  | 'warn'
  /** 必须用户处理，否则不该提交 */
  | 'blocker';

export interface MappingWarning {
  readonly code: WarningCode;
  readonly severity: WarningSeverity;
  /** 面向用户的说明，要能直接展示在界面上 */
  readonly message: string;
  /** 涉及的字段 selector */
  readonly fieldSelector?: string;
  /** 涉及的 Profile 记录 id，供 Diff 溯源 */
  readonly recordIds?: readonly string[];
}

const SEVERITY: Record<WarningCode, WarningSeverity> = {
  DOWNGRADED_TO_BROADER_FIELD: 'warn',
  MERGED_INTO_COMBINED_FIELD: 'info',
  ITEMS_TRUNCATED: 'warn',
  CONTENT_TOO_LONG: 'blocker',
  NO_MATCHING_DATA: 'info',
  REQUIRED_FIELD_EMPTY: 'blocker',
  LOW_CONFIDENCE: 'blocker',
  BLOCKED_BY_RULE: 'info',
  NO_SUITABLE_ASSET: 'blocker',
  NO_REFERRAL_CODE: 'info',
  UNANSWERED_QUESTION: 'blocker',
};

export function warn(
  code: WarningCode,
  message: string,
  extra: { fieldSelector?: string; recordIds?: readonly string[] } = {},
): MappingWarning {
  return {
    code,
    severity: SEVERITY[code],
    message,
    ...(extra.fieldSelector === undefined ? {} : { fieldSelector: extra.fieldSelector }),
    ...(extra.recordIds === undefined ? {} : { recordIds: extra.recordIds }),
  };
}

/** 是否存在阻断级警告 —— 有则不应进入提交流程 */
export const hasBlockers = (warnings: readonly MappingWarning[]): boolean =>
  warnings.some((item) => item.severity === 'blocker');

export const countBySeverity = (
  warnings: readonly MappingWarning[],
): Record<WarningSeverity, number> => {
  const counts: Record<WarningSeverity, number> = { info: 0, warn: 0, blocker: 0 };
  for (const item of warnings) counts[item.severity] += 1;
  return counts;
};
