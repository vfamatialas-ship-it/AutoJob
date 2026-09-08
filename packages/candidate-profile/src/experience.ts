/**
 * Experience —— PRD §9 / §10。
 *
 * ## 为什么不能用单一 type
 *
 * 招聘网站解析 PDF 时最常见的错误是「把课题组项目识别成实习」「把科研经历识别成工作经历」。
 * 根因是用一个 type 字段同时承载了三种正交的语义：
 *
 *   - 这段经历**在做什么**      → experienceType
 *   - 发生在**什么性质的组织**  → organizationType
 *   - 你和该组织是**什么关系**  → employmentRelation
 *
 * 「西安交通大学某课题组的研究项目」= research_project + university_lab + student。
 * 三个维度都对上，才能确定它可以进「科研经历 / 项目经历」，绝不能进「工作经历 / 实习」。
 *
 * ## canMapTo / shouldNotMapTo
 *
 * 每条经历显式声明它**能进**哪些网站栏目、**绝不能进**哪些。
 * 默认值由 experienceType 推导（见 DEFAULT_EXPERIENCE_MAPPING），用户可逐条覆盖。
 * shouldNotMapTo 是硬阻断：M4 的 Mapping Engine 无论规则还是 LLM 给出什么建议，
 * 命中 shouldNotMapTo 一律拒绝。这是 PRD §76 两条红线之一的实现位置。
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

/** 这段经历在做什么（PRD §9） */
export const ExperienceTypeSchema = z.enum([
  'full_time', // 正式工作
  'internship', // 实习
  'research', // 科研经历（泛指）
  'research_project', // 课题 / 研究项目
  'engineering_project', // 工程项目
  'competition_project', // 竞赛项目
  'academic_project', // 课程 / 学术项目
  'personal_project', // 个人项目
  'campus_activity', // 校园活动 / 学生组织
  'volunteer', // 志愿服务
  'entrepreneurial', // 创业
]);
export type ExperienceType = z.infer<typeof ExperienceTypeSchema>;

/** 发生在什么性质的组织（PRD §9） */
export const OrganizationTypeSchema = z.enum([
  'company',
  'university',
  'university_lab',
  'institute',
  'student_organization',
  'open_source',
  'personal',
]);
export type OrganizationType = z.infer<typeof OrganizationTypeSchema>;

/** 你和该组织是什么关系（PRD §9） */
export const EmploymentRelationSchema = z.enum([
  'employee',
  'intern',
  'research_assistant',
  'student',
  'contractor',
  'volunteer',
  'none',
]);
export type EmploymentRelation = z.infer<typeof EmploymentRelationSchema>;

/**
 * 网站栏目的语义类别 —— 映射的**目标端**。
 * 不同网站叫法千奇百怪（工作经历/工作履历、科研经历/研究经历/课题经历），
 * M3 的语义分类器负责把网站字段归到这些类别上，M4 再按 canMapTo/shouldNotMapTo 决定放什么。
 */
export const ExperienceTargetSchema = z.enum([
  'full_time_work', // 工作经历
  'internship', // 实习经历
  'research_experience', // 科研经历
  'project_experience', // 项目经历
  'competition_experience', // 竞赛经历
  'campus_activity', // 校园经历 / 社团
  'volunteer_experience', // 志愿服务
  'entrepreneurial_experience', // 创业经历
  'social_practice', // 社会实践（含义模糊，PRD §3.6 的典型例子）
]);
export type ExperienceTarget = z.infer<typeof ExperienceTargetSchema>;

/** 受雇性质的栏目 —— 非雇佣类经历一律不得进入，这是防串档的核心 */
const EMPLOYMENT_TARGETS: readonly ExperienceTarget[] = ['full_time_work', 'internship'];

export interface MappingPolicy {
  readonly canMapTo: readonly ExperienceTarget[];
  readonly shouldNotMapTo: readonly ExperienceTarget[];
}

/**
 * experienceType → 默认映射策略。
 *
 * 制定原则：
 * 1. 只有 full_time / internship / entrepreneurial 这类**真实雇佣或经营关系**才允许进受雇栏目。
 * 2. 其余全部硬阻断 full_time_work 与 internship —— 这正是 PRD 反复强调的红线。
 * 3. 科研类允许降级进「项目经历」（网站常常没有独立科研栏），但 M4 必须产生 warning（PRD §35）。
 * 4. social_practice 语义模糊，默认允许实习/科研/活动类进入，但最终仍要看用户确认（PRD §21）。
 */
export const DEFAULT_EXPERIENCE_MAPPING: Readonly<Record<ExperienceType, MappingPolicy>> = {
  full_time: {
    canMapTo: ['full_time_work'],
    shouldNotMapTo: [
      'internship',
      'research_experience',
      'campus_activity',
      'volunteer_experience',
    ],
  },
  internship: {
    canMapTo: ['internship', 'social_practice'],
    shouldNotMapTo: [
      'full_time_work',
      'research_experience',
      'campus_activity',
      'volunteer_experience',
    ],
  },
  research: {
    canMapTo: ['research_experience', 'project_experience', 'social_practice'],
    shouldNotMapTo: ['full_time_work', 'internship', 'volunteer_experience'],
  },
  research_project: {
    canMapTo: ['research_experience', 'project_experience', 'social_practice'],
    shouldNotMapTo: ['full_time_work', 'internship', 'volunteer_experience'],
  },
  engineering_project: {
    canMapTo: ['project_experience', 'research_experience'],
    shouldNotMapTo: ['full_time_work', 'internship', 'campus_activity', 'volunteer_experience'],
  },
  competition_project: {
    canMapTo: ['competition_experience', 'project_experience'],
    shouldNotMapTo: ['full_time_work', 'internship', 'volunteer_experience'],
  },
  academic_project: {
    canMapTo: ['project_experience', 'research_experience'],
    shouldNotMapTo: ['full_time_work', 'internship', 'volunteer_experience'],
  },
  personal_project: {
    canMapTo: ['project_experience'],
    shouldNotMapTo: ['full_time_work', 'internship', 'research_experience', 'volunteer_experience'],
  },
  campus_activity: {
    canMapTo: ['campus_activity', 'social_practice'],
    shouldNotMapTo: ['full_time_work', 'internship', 'research_experience', 'project_experience'],
  },
  volunteer: {
    canMapTo: ['volunteer_experience', 'campus_activity', 'social_practice'],
    shouldNotMapTo: ['full_time_work', 'internship', 'research_experience', 'project_experience'],
  },
  entrepreneurial: {
    canMapTo: ['entrepreneurial_experience', 'project_experience', 'full_time_work'],
    shouldNotMapTo: ['internship', 'research_experience', 'volunteer_experience'],
  },
};

export const ExperienceSchema = z
  .object({
    id: IdSchema,
    /** 经历名称，例如「面向复杂海底环境的水下双臂海洋垃圾捡取 VLA 算法研究」 */
    name: NonEmptyString,
    organization: NonEmptyString,
    role: NonEmptyString,
    startDate: DateSchema,
    endDate: EndDateSchema,
    location: z.string().trim().optional(),

    // —— 四维语义标签 ——
    experienceType: ExperienceTypeSchema,
    organizationType: OrganizationTypeSchema,
    employmentRelation: EmploymentRelationSchema,
    semanticTags: z.array(NonEmptyString).default([]),

    // —— 映射策略。留空则由 experienceType 推导 ——
    canMapTo: z.array(ExperienceTargetSchema).optional(),
    shouldNotMapTo: z.array(ExperienceTargetSchema).optional(),

    // —— 内容 ——
    /** 完整规范描述。生成变体时的输入，本身不会被改写（PRD §31） */
    descriptionCanonical: z.string().default(''),
    canonicalFacts: z.array(CanonicalFactSchema).default([]),
    responsibilities: z.array(NonEmptyString).default([]),
    achievements: z.array(NonEmptyString).default([]),
    technologies: z.array(NonEmptyString).default([]),
    keywords: z.array(NonEmptyString).default([]),
    links: z.array(LinkSchema).default([]),
    /** 关联附件的 assetId */
    attachments: z.array(IdSchema).default([]),
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
    (exp) => {
      const can = exp.canMapTo ?? [];
      const blocked = new Set(exp.shouldNotMapTo ?? []);
      return !can.some((target) => blocked.has(target));
    },
    { message: 'canMapTo 与 shouldNotMapTo 存在冲突项', path: ['canMapTo'] },
  );

export type Experience = z.infer<typeof ExperienceSchema>;

/** 取得该经历实际生效的映射策略：显式声明优先，否则回落到 experienceType 默认值。 */
export function resolveMappingPolicy(experience: Experience): MappingPolicy {
  const fallback = DEFAULT_EXPERIENCE_MAPPING[experience.experienceType];
  return {
    canMapTo: experience.canMapTo ?? fallback.canMapTo,
    shouldNotMapTo: experience.shouldNotMapTo ?? fallback.shouldNotMapTo,
  };
}

/**
 * 判断一段经历能否进入某个网站栏目。
 *
 * 顺序很重要：**先查阻断再查允许**。shouldNotMapTo 是硬红线，
 * 即使 canMapTo 里也列了同一个目标（理论上被 schema 拦下了），也以阻断为准。
 */
export function canMapExperienceTo(
  experience: Experience,
  target: ExperienceTarget,
): { allowed: boolean; reason: string } {
  const policy = resolveMappingPolicy(experience);

  if (policy.shouldNotMapTo.includes(target)) {
    return {
      allowed: false,
      reason: `「${experience.name}」是 ${experience.experienceType}，明确禁止映射到 ${target}`,
    };
  }
  if (policy.canMapTo.includes(target)) {
    return { allowed: true, reason: `${experience.experienceType} 允许映射到 ${target}` };
  }
  return {
    allowed: false,
    reason: `${experience.experienceType} 未声明可映射到 ${target}，按「低置信度不猜测」处理`,
  };
}

/** 是否属于受雇性质的栏目 */
export const isEmploymentTarget = (target: ExperienceTarget): boolean =>
  EMPLOYMENT_TARGETS.includes(target);

export interface ConsistencyWarning {
  readonly field: string;
  readonly message: string;
}

/**
 * 四维标签之间的一致性检查。
 *
 * 这些组合不一定是错的（例如企业横向课题确实是 research_project + company），
 * 所以只产生 warning 交给用户判断，不做硬性拒绝 —— 硬拒会逼用户改数据去迁就规则。
 */
export function checkExperienceConsistency(experience: Experience): ConsistencyWarning[] {
  const warnings: ConsistencyWarning[] = [];
  const { experienceType, organizationType, employmentRelation, name } = experience;

  if (experienceType === 'full_time' && !['employee', 'contractor'].includes(employmentRelation)) {
    warnings.push({
      field: 'employmentRelation',
      message: `「${name}」标为正式工作，但雇佣关系是 ${employmentRelation}，请确认是否应为 internship`,
    });
  }

  if (experienceType === 'internship' && employmentRelation !== 'intern') {
    warnings.push({
      field: 'employmentRelation',
      message: `「${name}」标为实习，但雇佣关系是 ${employmentRelation}`,
    });
  }

  if (
    ['research_project', 'academic_project'].includes(experienceType) &&
    ['employee', 'intern'].includes(employmentRelation)
  ) {
    warnings.push({
      field: 'employmentRelation',
      message: `「${name}」是课题/学术项目，却带有雇佣关系 ${employmentRelation}，容易被误填进工作经历，请复核`,
    });
  }

  if (organizationType === 'university_lab' && employmentRelation === 'employee') {
    warnings.push({
      field: 'organizationType',
      message: `「${name}」发生在高校课题组，雇佣关系却是 employee，请确认是否应为 student 或 research_assistant`,
    });
  }

  return warnings;
}
