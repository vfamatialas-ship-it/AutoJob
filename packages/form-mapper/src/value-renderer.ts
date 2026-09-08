/**
 * 把 Profile 记录渲染成可填入文本框的草稿。
 *
 * 这里只做**结构化排版**，不做压缩改写 —— 后者是 M6 ContentAdapter 的职责，
 * 且必须受 Canonical Facts 约束。本文件严格只搬运已有文字，一个字都不新增。
 */

import type { Award, Education, Experience, Project } from '@autojob/candidate-profile';
import { normalizedGpa, rankingPercentile } from '@autojob/candidate-profile';

const formatDateRange = (start: string, end: string): string =>
  `${start} — ${end === 'present' ? '至今' : end}`;

/** 单段经历的文本形态。与简历常见排版一致，招聘网站的文本框基本都吃这一套。 */
export function renderExperience(experience: Experience): string {
  const header = [
    experience.name,
    experience.organization,
    experience.role,
    formatDateRange(experience.startDate, experience.endDate),
  ]
    .filter((part) => part.length > 0)
    .join(' | ');

  const body: string[] = [];
  if (experience.descriptionCanonical.length > 0) body.push(experience.descriptionCanonical);
  for (const item of experience.responsibilities) body.push(`· ${item}`);
  for (const item of experience.achievements) body.push(`· ${item}`);

  return [header, ...body].join('\n');
}

export function renderProject(project: Project): string {
  const header = [
    project.name,
    project.organization,
    project.role,
    formatDateRange(project.startDate, project.endDate),
  ]
    .filter((part) => part.length > 0)
    .join(' | ');

  const body: string[] = [];
  if (project.descriptionCanonical.length > 0) body.push(project.descriptionCanonical);
  for (const item of project.responsibilities) body.push(`· ${item}`);
  for (const item of project.achievements) body.push(`· ${item}`);

  return [header, ...body].join('\n');
}

/** 奖项一行一条。多数网站的奖项栏是单个文本框，逐行罗列最通用。 */
export function renderAward(award: Award): string {
  const parts = [award.date, award.name, award.rank, award.issuer].filter(
    (part) => part.length > 0,
  );
  return parts.join(' | ');
}

export function renderEducation(education: Education): string {
  const degree =
    education.degree !== undefined && education.degree.length > 0
      ? education.degree
      : education.major;
  const header = [
    education.institution,
    education.college,
    degree,
    formatDateRange(education.startDate, education.endDate),
  ]
    .filter((part) => part !== undefined && part.length > 0)
    .join(' | ');

  const extras: string[] = [];
  const gpa = normalizedGpa(education);
  if (education.gpa !== undefined) {
    extras.push(
      `GPA ${education.gpa}${education.gpaScale === undefined ? '' : `/${education.gpaScale}`}${gpa === undefined ? '' : `（折合 4.0 制 ${gpa}）`}`,
    );
  }
  const percentile = rankingPercentile(education);
  if (percentile !== undefined) {
    extras.push(`专业排名 ${education.ranking}/${education.rankingTotal}（前 ${percentile}%）`);
  }
  if (education.description.length > 0) extras.push(education.description);

  return [header, ...extras].join('\n');
}

/** 多条记录之间用空行分隔 —— 网站文本框里这样最易读 */
export const joinEntries = (entries: readonly string[]): string => entries.join('\n\n');
