/**
 * CandidateProfile —— 唯一事实来源（PRD §3.1 / §6）。
 *
 * 「招聘网站的 PDF 解析结果不能作为事实来源。」
 * PDF 简历只是一个附件、一个输出版本、一个展示材料；
 * 真正的个人信息以结构化形式存在这里。
 *
 * 本文件负责三件事：
 * 1. 聚合各子模块 Schema
 * 2. 引用完整性校验（attachments/assetId/experienceId 指向的东西必须存在）
 * 3. toLLMSafeProfile() —— 送给 LLM 前的数据最小化（PRD §42）
 */

import { z } from 'zod';
import { AssetSchema, ResumeVersionSchema } from './asset.js';
import { AwardSchema } from './award.js';
import { BasicInfoSchema, toSafeBasicInfo } from './basic-info.js';
import { EducationSchema } from './education.js';
import { ExperienceSchema } from './experience.js';
import { ProfileLinkSchema } from './links.js';
import { ProjectSchema } from './project.js';
import { QuestionSchema, ReferralCodeSchema } from './question.js';
import { SkillSchema } from './skill.js';

/** Schema 版本。结构变更时递增，Import 时据此决定是否需要迁移。 */
export const PROFILE_SCHEMA_VERSION = 1;

export const CandidateProfileSchema = z.object({
  schemaVersion: z.number().int().positive().default(PROFILE_SCHEMA_VERSION),
  updatedAt: z.string().datetime().optional(),

  basicInfo: BasicInfoSchema,
  educations: z.array(EducationSchema).default([]),
  experiences: z.array(ExperienceSchema).default([]),
  projects: z.array(ProjectSchema).default([]),
  awards: z.array(AwardSchema).default([]),
  skills: z.array(SkillSchema).default([]),
  links: z.array(ProfileLinkSchema).default([]),
  assets: z.array(AssetSchema).default([]),
  resumeVersions: z.array(ResumeVersionSchema).default([]),
  questions: z.array(QuestionSchema).default([]),
  referralCodes: z.array(ReferralCodeSchema).default([]),
});

export type CandidateProfile = z.infer<typeof CandidateProfileSchema>;

export interface IntegrityIssue {
  readonly path: string;
  readonly message: string;
}

/**
 * 引用完整性校验。
 *
 * Zod 只能校验单条记录内部，跨集合的引用（附件 id、经历 id）得单独查。
 * 这些错误在填表时才暴露的话，代价是一次失败的投递，所以提前查出来。
 */
export function checkProfileIntegrity(profile: CandidateProfile): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const assetIds = new Set(profile.assets.map((a) => a.id));
  const experienceIds = new Set(profile.experiences.map((e) => e.id));

  const checkAttachments = (owner: string, path: string, attachments: readonly string[]): void => {
    for (const assetId of attachments) {
      if (!assetIds.has(assetId)) {
        issues.push({ path, message: `${owner} 引用了不存在的附件 ${assetId}` });
      }
    }
  };

  profile.experiences.forEach((experience, index) => {
    checkAttachments(
      `经历「${experience.name}」`,
      `experiences[${index}].attachments`,
      experience.attachments,
    );
  });

  profile.projects.forEach((project, index) => {
    checkAttachments(
      `项目「${project.name}」`,
      `projects[${index}].attachments`,
      project.attachments,
    );
    if (project.experienceId !== undefined && !experienceIds.has(project.experienceId)) {
      issues.push({
        path: `projects[${index}].experienceId`,
        message: `项目「${project.name}」关联了不存在的经历 ${project.experienceId}`,
      });
    }
  });

  profile.awards.forEach((award, index) => {
    if (award.certificateAsset !== undefined && !assetIds.has(award.certificateAsset)) {
      issues.push({
        path: `awards[${index}].certificateAsset`,
        message: `奖项「${award.name}」引用了不存在的证书附件 ${award.certificateAsset}`,
      });
    }
  });

  profile.resumeVersions.forEach((version, index) => {
    if (!assetIds.has(version.assetId)) {
      issues.push({
        path: `resumeVersions[${index}].assetId`,
        message: `简历版本「${version.name}」引用了不存在的附件 ${version.assetId}`,
      });
    }
  });

  // id 唯一性
  const collections: ReadonlyArray<readonly [string, ReadonlyArray<{ id: string }>]> = [
    ['experiences', profile.experiences],
    ['projects', profile.projects],
    ['awards', profile.awards],
    ['skills', profile.skills],
    ['assets', profile.assets],
    ['educations', profile.educations],
  ];
  for (const [name, items] of collections) {
    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.id))
        issues.push({ path: name, message: `${name} 中存在重复 id：${item.id}` });
      seen.add(item.id);
    }
  }

  return issues;
}

/**
 * 送给 LLM 的安全副本 —— PRD §42 数据最小化。
 *
 * 剔除：身份证、手机号、邮箱、微信、生日、住址、内推码。
 * 保留：经历、项目、技能、奖项等**职业信息** —— 这些正是 LLM 做语义理解和岗位匹配需要的。
 *
 * 关键认知：LLM 只需要知道「网页上这一栏是 PHONE」，不需要知道手机号是多少。
 * 真实值由本地程序读取后直接用 Playwright 填写。
 */
export type LLMSafeProfile = Omit<CandidateProfile, 'basicInfo' | 'referralCodes' | 'questions'> & {
  basicInfo: ReturnType<typeof toSafeBasicInfo>;
};

export function toLLMSafeProfile(profile: CandidateProfile): LLMSafeProfile {
  const { referralCodes: _referralCodes, questions: _questions, ...rest } = profile;
  return {
    ...rest,
    basicInfo: toSafeBasicInfo(profile.basicInfo),
  };
}

/** 空白 Profile，供首次使用时初始化。 */
export function createEmptyProfile(name: string): CandidateProfile {
  return CandidateProfileSchema.parse({
    schemaVersion: PROFILE_SCHEMA_VERSION,
    basicInfo: { name },
  });
}
