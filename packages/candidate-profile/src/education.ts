/**
 * Education —— PRD §8。
 *
 * 两个容易出错的点：
 * 1. **双学位**：一次入学同时读两个专业，网站往往只给一个「专业」框。
 *    用 `minor` 与 `secondMajor` 区分辅修与双学位，Mapping 层才知道该怎么填。
 * 2. **排名**：网站有的要「排名/总人数」，有的要百分比。存原始的 ranking + rankingTotal，
 *    百分比由 Mapping 层现算，避免精度和口径丢失。
 */

import { z } from 'zod';
import { DateSchema, EndDateSchema, IdSchema, NonEmptyString, normalizeDate } from './common.js';

export const DegreeTypeSchema = z.enum([
  'associate', // 专科
  'bachelor', // 学士
  'master', // 硕士
  'doctor', // 博士
  'other',
]);
export type DegreeType = z.infer<typeof DegreeTypeSchema>;

/** 培养方式，网站常单独问 */
export const StudyModeSchema = z.enum(['full_time', 'part_time']);
export type StudyMode = z.infer<typeof StudyModeSchema>;

export const EducationSchema = z
  .object({
    id: IdSchema,
    institution: NonEmptyString,
    /** 学院 / 系 */
    college: z.string().trim().optional(),
    /** 学位名称原文，例如「机械工程与工程力学双学位（钱学森班）」 */
    degree: z.string().trim().optional(),
    degreeType: DegreeTypeSchema,
    studyMode: StudyModeSchema.default('full_time'),

    major: NonEmptyString,
    /** 辅修专业 */
    minor: z.string().trim().optional(),
    /** 双学位的第二专业（与辅修不同，双学位是两个完整学位） */
    secondMajor: z.string().trim().optional(),

    startDate: DateSchema,
    endDate: EndDateSchema,
    /** 毕业时间。在读时可与 endDate 一致，作为预计毕业时间 */
    graduationDate: DateSchema.optional(),

    gpa: z.number().nonnegative().optional(),
    /** GPA 满分制，例如 4.0 / 4.3 / 5.0 / 100 */
    gpaScale: z.number().positive().optional(),
    ranking: z.number().int().positive().optional(),
    rankingTotal: z.number().int().positive().optional(),

    coursework: z.array(NonEmptyString).default([]),
    advisor: z.string().trim().optional(),
    /** 课题组 / 实验室 */
    lab: z.string().trim().optional(),
    description: z.string().default(''),
  })
  .refine(
    ({ startDate, endDate }) =>
      endDate === 'present' || normalizeDate(startDate) <= normalizeDate(endDate),
    {
      message: '入学时间不能晚于毕业时间',
      path: ['endDate'],
    },
  )
  .refine(({ gpa, gpaScale }) => gpa === undefined || gpaScale === undefined || gpa <= gpaScale, {
    message: 'GPA 不能超过满分值',
    path: ['gpa'],
  })
  .refine(
    ({ ranking, rankingTotal }) =>
      ranking === undefined || rankingTotal === undefined || ranking <= rankingTotal,
    { message: '排名不能超过总人数', path: ['ranking'] },
  );

export type Education = z.infer<typeof EducationSchema>;

/** 排名百分比，例如 3/200 → 1.5（%）。网站要求「专业前 X%」时用。 */
export function rankingPercentile(education: Education): number | undefined {
  const { ranking, rankingTotal } = education;
  if (ranking === undefined || rankingTotal === undefined) return undefined;
  return Number(((ranking / rankingTotal) * 100).toFixed(2));
}

/** GPA 归一到 4.0 制，便于跨学校比较与填写要求 4.0 制的网站。 */
export function normalizedGpa(education: Education): number | undefined {
  const { gpa, gpaScale } = education;
  if (gpa === undefined || gpaScale === undefined) return undefined;
  return Number(((gpa / gpaScale) * 4).toFixed(2));
}

const DEGREE_RANK: Record<DegreeType, number> = {
  doctor: 4,
  master: 3,
  bachelor: 2,
  associate: 1,
  other: 0,
};

/** 取最高学历。网站问「最高学历」时用，避免填成本科。 */
export function highestEducation(educations: readonly Education[]): Education | undefined {
  return [...educations].sort((a, b) => {
    const diff = DEGREE_RANK[b.degreeType] - DEGREE_RANK[a.degreeType];
    return diff !== 0 ? diff : b.startDate.localeCompare(a.startDate);
  })[0];
}
