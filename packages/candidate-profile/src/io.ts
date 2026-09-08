/**
 * Profile 导入 / 导出（PRD §52）。
 *
 * 导出带 schemaVersion，未来结构变更时可以据此迁移旧数据。
 * `exportProfile` 提供 `redactSensitive` 选项：导出用于分享或提 issue 的副本时，
 * 敏感字段替换为占位符 —— 避免把身份证发到公开渠道。
 */

import { AutoJobError, ErrorCode } from '@autojob/core';
import { SENSITIVE_BASIC_FIELDS } from './basic-info.js';
import {
  CandidateProfileSchema,
  PROFILE_SCHEMA_VERSION,
  type CandidateProfile,
} from './profile.js';

export interface ExportOptions {
  /** 是否把敏感字段替换为占位符。默认 false（本地备份需要完整数据） */
  readonly redactSensitive?: boolean;
  /** 缩进，便于人工阅读与 diff */
  readonly indent?: number;
}

const PLACEHOLDER = '<REDACTED>';

export function exportProfile(profile: CandidateProfile, options: ExportOptions = {}): string {
  const payload: CandidateProfile = { ...profile, schemaVersion: PROFILE_SCHEMA_VERSION };

  if (options.redactSensitive === true) {
    const basicInfo = { ...payload.basicInfo };
    for (const field of SENSITIVE_BASIC_FIELDS) {
      if (basicInfo[field] !== undefined) {
        // 保留字段存在性（便于对方知道有这项数据），但抹掉值
        Object.assign(basicInfo, { [field]: PLACEHOLDER });
      }
    }
    return JSON.stringify({ ...payload, basicInfo, referralCodes: [] }, null, options.indent ?? 2);
  }

  return JSON.stringify(payload, null, options.indent ?? 2);
}

/**
 * 从 JSON 导入。
 *
 * 失败一律抛结构化错误（PRD §71），并把 Zod 的字段路径带上 ——
 * 「第 3 段经历的 endDate 格式不对」远比「解析失败」有用。
 */
export function importProfile(json: string): CandidateProfile {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (cause) {
    throw new AutoJobError(ErrorCode.SCHEMA_INVALID, 'Profile JSON 无法解析', {
      hint: '请检查文件是否为合法 JSON',
      cause,
    });
  }

  const version = (raw as { schemaVersion?: unknown }).schemaVersion;
  if (typeof version === 'number' && version > PROFILE_SCHEMA_VERSION) {
    throw new AutoJobError(
      ErrorCode.SCHEMA_INVALID,
      `Profile 版本 ${version} 高于当前支持的 ${PROFILE_SCHEMA_VERSION}`,
      { hint: '请升级 AutoJob 后重试' },
    );
  }

  const parsed = CandidateProfileSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.') || '(根)'}: ${issue.message}`)
      .join('；');
    throw new AutoJobError(ErrorCode.SCHEMA_INVALID, `Profile 校验失败 —— ${details}`, {
      context: { issueCount: parsed.error.issues.length },
      hint: '请修正上述字段后重新导入',
    });
  }

  return parsed.data;
}
