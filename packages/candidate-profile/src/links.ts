/**
 * Links —— PRD §15。
 *
 * 网站的叫法很多：个人主页 / GitHub / 作品链接 / Portfolio / 博客 / 个人网站。
 * 用 semanticType 统一，Mapping 层按语义取值，而不是按字段名硬猜。
 *
 * 一个常见情况：网站只有一个「个人主页」框，但候选人同时有 GitHub 和个人网站。
 * `primaryFor` 让用户指定「问个人主页时优先给哪个」。
 */

import { z } from 'zod';
import { NonEmptyString } from './common.js';

export const LinkSemanticTypeSchema = z.enum([
  'github',
  'personal_homepage',
  'portfolio',
  'linkedin',
  'google_scholar',
  'zhihu',
  'blog',
  'research_gate',
  'bilibili',
  'gitee',
  'other',
]);
export type LinkSemanticType = z.infer<typeof LinkSemanticTypeSchema>;

export const ProfileLinkSchema = z.object({
  semanticType: LinkSemanticTypeSchema,
  url: z.string().url('必须是合法 URL'),
  /** 展示名称，例如 "GitHub - 机器人开源实验室" */
  label: z.string().trim().default(''),
  /**
   * 当网站只给一个通用「个人主页」框时，标记为 true 的链接优先填入。
   * 多个候选都标 true 时取第一个。
   */
  primaryForHomepage: z.boolean().default(false),
  description: z.string().default(''),
});

export type ProfileLink = z.infer<typeof ProfileLinkSchema>;

export const ProfileLinksSchema = z.array(ProfileLinkSchema).default([]);

/** 按语义类型取链接 */
export function findLink(
  links: readonly ProfileLink[],
  type: LinkSemanticType,
): ProfileLink | undefined {
  return links.find((link) => link.semanticType === type);
}

/**
 * 网站只有一个「个人主页」框时该填什么。
 *
 * 优先级：显式标记 primaryForHomepage > personal_homepage > portfolio > github > 第一个可用链接。
 * 之所以把 github 排在 portfolio 之后：作品集通常是为求职专门整理的，信息密度更高。
 */
export function pickHomepageLink(links: readonly ProfileLink[]): ProfileLink | undefined {
  const explicit = links.find((link) => link.primaryForHomepage);
  if (explicit) return explicit;

  const order: LinkSemanticType[] = ['personal_homepage', 'portfolio', 'github'];
  for (const type of order) {
    const found = findLink(links, type);
    if (found) return found;
  }
  return links[0];
}

/** 校验链接列表中同一语义类型不重复（重复会让 Mapping 层无法确定取哪个） */
export function findDuplicateLinkTypes(links: readonly ProfileLink[]): LinkSemanticType[] {
  const seen = new Set<LinkSemanticType>();
  const duplicates = new Set<LinkSemanticType>();
  for (const link of links) {
    if (link.semanticType === 'other') continue;
    if (seen.has(link.semanticType)) duplicates.add(link.semanticType);
    seen.add(link.semanticType);
  }
  return [...duplicates];
}

export const LinkLabelSchema = NonEmptyString;
