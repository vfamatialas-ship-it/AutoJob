/**
 * Asset Library —— PRD §16 / §17。
 *
 * 附件是投递中最容易出错的环节：中文岗位传了英文简历、要成绩单传了作品集、
 * 文件超过网站大小限制、格式不被接受。
 *
 * 所以 Asset 不只是「一个文件路径」，还要带上足以做自动选择的元信息：
 * 类型、语言、标签、大小、格式。AssetSelector（M5）据此挑文件。
 */

import { z } from 'zod';
import { IdSchema, LanguageSchema, NonEmptyString } from './common.js';

export const AssetTypeSchema = z.enum([
  'resume',
  'portfolio',
  'transcript',
  'paper',
  'patent',
  'certificate',
  'award_certificate',
  'student_id',
  'publication',
  'cover_letter',
  'photo',
  'other',
]);
export type AssetType = z.infer<typeof AssetTypeSchema>;

export const AssetSchema = z.object({
  id: IdSchema,
  name: NonEmptyString,
  type: AssetTypeSchema,
  /** 本地路径。PRD §41：附件一律存本地，不上传开发者服务器 */
  path: NonEmptyString,
  language: LanguageSchema.default('zh'),
  tags: z.array(NonEmptyString).default([]),
  mimeType: z.string().trim().default(''),
  /** 字节数。网站常限制 10MB 以内 */
  fileSize: z.number().int().nonnegative().default(0),
  version: z.string().trim().default('v1'),
  updatedAt: z.string().datetime().optional(),
});

export type Asset = z.infer<typeof AssetSchema>;

/** 从文件名推断扩展名（小写，不含点） */
export function assetExtension(asset: Asset): string {
  const match = /\.([a-z0-9]+)$/i.exec(asset.path);
  return match?.[1]?.toLowerCase() ?? '';
}

export interface AssetRequirement {
  readonly type: AssetType;
  readonly language?: 'zh' | 'en';
  /** 网站允许的扩展名，例如 ['pdf', 'doc', 'docx'] */
  readonly allowedExtensions?: readonly string[];
  /** 网站的大小上限（字节） */
  readonly maxFileSize?: number;
  /** 期望命中的标签，例如岗位方向 'robotics' */
  readonly preferredTags?: readonly string[];
}

export interface AssetSelection {
  readonly asset: Asset | undefined;
  /** 被排除的候选及原因，供 Application Diff 展示 */
  readonly rejected: ReadonlyArray<{ asset: Asset; reason: string }>;
  readonly reason: string;
}

/**
 * 按网站要求挑选附件。
 *
 * 硬条件（类型/格式/大小）不满足直接排除；
 * 软条件（语言、标签）用于在多个合格候选中排序。
 * 没有合格候选时返回 undefined —— **不做降级凑合**，交给用户处理。
 */
export function selectAsset(
  assets: readonly Asset[],
  requirement: AssetRequirement,
): AssetSelection {
  const rejected: Array<{ asset: Asset; reason: string }> = [];
  const candidates: Asset[] = [];

  for (const asset of assets) {
    if (asset.type !== requirement.type) continue;

    const extension = assetExtension(asset);
    if (requirement.allowedExtensions && !requirement.allowedExtensions.includes(extension)) {
      rejected.push({
        asset,
        reason: `格式 .${extension} 不在网站允许列表 [${requirement.allowedExtensions.join(', ')}] 中`,
      });
      continue;
    }

    if (requirement.maxFileSize !== undefined && asset.fileSize > requirement.maxFileSize) {
      rejected.push({
        asset,
        reason: `文件 ${(asset.fileSize / 1024 / 1024).toFixed(1)}MB 超过网站上限 ${(requirement.maxFileSize / 1024 / 1024).toFixed(1)}MB`,
      });
      continue;
    }

    candidates.push(asset);
  }

  if (candidates.length === 0) {
    return { asset: undefined, rejected, reason: `没有符合要求的 ${requirement.type} 附件` };
  }

  const score = (asset: Asset): number => {
    let value = 0;
    if (requirement.language !== undefined && asset.language === requirement.language) value += 100;
    if (requirement.preferredTags) {
      value += asset.tags.filter((tag) => requirement.preferredTags?.includes(tag)).length * 10;
    }
    return value;
  };

  const best = candidates.reduce((a, b) => (score(b) > score(a) ? b : a));
  return {
    asset: best,
    rejected,
    reason:
      candidates.length === 1
        ? `唯一符合要求的 ${requirement.type}`
        : `在 ${candidates.length} 个候选中按语言与标签匹配度选出`,
  };
}

/**
 * ResumeVersion —— PRD §17。
 * 多个简历版本对应不同岗位方向，Application 必须记录用了哪一版。
 */
export const ResumeVersionSchema = z.object({
  id: IdSchema,
  name: NonEmptyString,
  /** 面向的岗位方向，例如 ['机器人算法', '具身智能'] */
  targetRoles: z.array(NonEmptyString).default([]),
  assetId: IdSchema,
  /** 内容偏好说明，供内容生成时参考侧重点 */
  contentPreference: z.string().default(''),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

export type ResumeVersion = z.infer<typeof ResumeVersionSchema>;

/**
 * 按岗位名挑简历版本。
 * 匹配不上时返回 undefined，由调用方决定用默认版还是问用户 —— 这里不做隐式兜底。
 */
export function pickResumeVersion(
  versions: readonly ResumeVersion[],
  jobTitle: string,
): ResumeVersion | undefined {
  const title = jobTitle.toLowerCase();
  let best: { version: ResumeVersion; hits: number } | undefined;

  for (const version of versions) {
    const hits = version.targetRoles.filter((role) => title.includes(role.toLowerCase())).length;
    if (hits > 0 && (best === undefined || hits > best.hits)) best = { version, hits };
  }
  return best?.version;
}
