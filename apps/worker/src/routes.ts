/**
 * Worker 接口定义。
 *
 * 每个接口都是「桌面端需要的一件事」，而不是对内部模块的机械转发。
 * 界面不该知道 FormPlan、MappingRule 这些概念 —— 它只关心
 * 「看板上有什么」「这个岗位匹配几分」「填表进行到哪一步了」。
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  checkProfileIntegrity,
  highestEducation,
  importProfile,
  type CandidateProfile,
} from '@autojob/candidate-profile';
import { maskText } from '@autojob/core';
import { ApplicationRepository, openDatabase, type ApplicationStatus } from '@autojob/database';
import { launchSession } from '@autojob/browser';
import {
  CLICK_LOAD_MORE_SCRIPT,
  EXTRACT_JOB_LIST_SCRIPT,
  parseJobList,
} from '@autojob/job-discovery';
import { DEFAULT_PREFERENCE, matchJobs, summarizeMatches } from '@autojob/job-matcher';
import { detectAts } from '@autojob/ats-detector';

export type RouteHandler = (body: unknown) => Promise<unknown> | unknown;
export type RouteTable = Record<string, RouteHandler>;

export interface WorkerConfig {
  /** Profile JSON 路径 */
  profilePath: string;
  dbPath: string;
}

export const DEFAULT_CONFIG: WorkerConfig = {
  profilePath: join(homedir(), '.autojob', 'profile.json'),
  dbPath: join(homedir(), '.autojob', 'autojob.db'),
};

const asRecord = (body: unknown): Record<string, unknown> =>
  typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};

const asString = (body: unknown, key: string, fallback = ''): string => {
  const value = asRecord(body)[key];
  return typeof value === 'string' ? value : fallback;
};

/**
 * 加载 Profile。
 *
 * 每次调用都重新读盘而不是缓存：用户可能在外部编辑器里改了 Profile，
 * 缓存会让界面显示陈旧数据 —— 这类不一致极难排查。读一个 JSON 很便宜。
 */
function loadProfile(config: WorkerConfig): CandidateProfile {
  return importProfile(readFileSync(config.profilePath, 'utf-8'));
}

export function buildRoutes(config: WorkerConfig): RouteTable {
  const withRepo = <T>(fn: (repo: ApplicationRepository) => T): T => {
    const db = openDatabase({ path: config.dbPath });
    try {
      return fn(new ApplicationRepository(db));
    } finally {
      db.close();
    }
  };

  return {
    /** 配置与环境状态 */
    '/config': () => ({
      profilePath: config.profilePath,
      dbPath: config.dbPath,
      profileExists: (() => {
        try {
          readFileSync(config.profilePath);
          return true;
        } catch {
          return false;
        }
      })(),
    }),

    '/config/update': (body) => {
      const profilePath = asString(body, 'profilePath');
      const dbPath = asString(body, 'dbPath');
      if (profilePath.length > 0) config.profilePath = profilePath;
      if (dbPath.length > 0) config.dbPath = dbPath;
      return { profilePath: config.profilePath, dbPath: config.dbPath };
    },

    /**
     * Profile 摘要。**敏感字段一律脱敏后再送到界面** ——
     * 界面可能被截图或投屏，没必要让手机号出现在上面（PRD §44）。
     */
    '/profile/summary': () => {
      const profile = loadProfile(config);
      const top = highestEducation(profile.educations);

      return {
        name: profile.basicInfo.name,
        phone: maskText(profile.basicInfo.phone ?? ''),
        email: maskText(profile.basicInfo.email ?? ''),
        education: top === undefined ? '' : `${top.institution} · ${top.major} · ${top.degreeType}`,
        expectedGraduation: profile.basicInfo.expectedGraduationDate ?? '',
        counts: {
          educations: profile.educations.length,
          experiences: profile.experiences.length,
          projects: profile.projects.length,
          awards: profile.awards.length,
          skills: profile.skills.length,
          assets: profile.assets.length,
          questions: profile.questions.length,
        },
        issues: checkProfileIntegrity(profile).map((issue) => issue.message),
      };
    },

    /** 附件库 */
    '/profile/assets': () => {
      const profile = loadProfile(config);
      return profile.assets.map((asset) => ({
        id: asset.id,
        name: asset.name,
        type: asset.type,
        language: asset.language,
        sizeKb: Math.round(asset.fileSize / 1024),
        path: asset.path,
      }));
    },

    /** 投递看板 */
    '/applications': (body) =>
      withRepo((repo) => {
        const status = asString(body, 'status');
        const rows = repo.listApplications(
          status.length > 0 ? { status: status as ApplicationStatus } : {},
        );

        return {
          counts: repo.statusCounts(),
          items: rows.map((row) => ({
            id: row.application.id,
            company: row.company.name,
            atsType: row.company.atsType,
            title: row.job.title,
            url: row.job.url,
            status: row.application.status,
            createdAt: row.application.createdAt,
            submittedAt: row.application.submittedAt,
          })),
        };
      }),

    '/applications/update': (body) =>
      withRepo((repo) => {
        const id = asString(body, 'id');
        const status = asString(body, 'status') as ApplicationStatus;
        const notes = asString(body, 'notes');

        const updated = repo.updateStatus(id, status, {
          source: 'user',
          ...(notes.length > 0 ? { notes } : {}),
        });
        return { id: updated.id, status: updated.status };
      }),

    '/applications/timeline': (body) =>
      withRepo((repo) =>
        repo.timeline(asString(body, 'id')).map((event) => ({
          at: event.createdAt,
          from: event.oldStatus,
          to: event.newStatus,
          source: event.source,
          notes: event.notes,
        })),
      ),

    /**
     * 抓岗位并匹配。**只读** —— 与 CLI 的 match 命令同样的约束（PRD §56）。
     */
    '/jobs/match': async (body) => {
      const url = asString(body, 'url');
      const company = asString(body, 'company', new URL(url).hostname);
      const profile = loadProfile(config);

      const session = await launchSession({ headless: true });
      try {
        await session.page.goto(url, { waitUntil: 'domcontentloaded' });

        const extract = async (): Promise<ReturnType<typeof parseJobList>> =>
          parseJobList(await session.page.evaluate(EXTRACT_JOB_LIST_SCRIPT), {
            company,
            baseUrl: url,
          });

        // SPA 渲染时序：轮询直到抓出像样的列表
        let best = await extract();
        for (let round = 0; round < 8 && best.jobs.length < 5; round += 1) {
          await session.page.waitForTimeout(1_000);
          const next = await extract();
          if (next.jobs.length > best.jobs.length || next.score > best.score) best = next;
        }

        for (let round = 0; round < 20; round += 1) {
          const clicked = await session.page.evaluate(CLICK_LOAD_MORE_SCRIPT);
          if (!clicked.clicked) break;
          await session.page.waitForTimeout(500);
          const expanded = await extract();
          if (expanded.jobs.length <= best.jobs.length) break;
          best = expanded;
        }

        const detection = detectAts({ url });
        const results = matchJobs(best.jobs, { preference: DEFAULT_PREFERENCE, profile });

        return {
          ats: detection.label,
          summary: summarizeMatches(results),
          items: results.map((result) => ({
            title: result.job.title,
            url: result.job.url,
            location: result.job.location,
            department: result.job.department,
            score: result.score,
            passed: result.passed,
            summary: result.summary,
            rejectReason: result.rejectReason ?? null,
          })),
        };
      } finally {
        await session.close();
      }
    },
  };
}
