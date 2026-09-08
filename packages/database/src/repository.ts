/**
 * 投递记录仓储 —— 业务层唯一的数据入口。
 *
 * 两条不变量在这里保证：
 * 1. **状态变化必然伴随一条 ApplicationEvent**。把两件事绑在同一个方法里，
 *    就不会出现「状态改了但时间线缺一段」的情况。
 * 2. **同一岗位只能有一条投递记录**。数据库有唯一索引兜底，
 *    这里再提供 findByFingerprint 让上层能在填表之前就发现重复（PRD §30）。
 */

import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { AutoJobError, ErrorCode } from '@autojob/core';
import type { AutoJobDatabase } from './client.js';
import {
  applicationEvents,
  applications,
  companies,
  jobs,
  mappingRules,
  type Application,
  type ApplicationStatus,
  type Company,
  type Job,
} from './schema.js';

const nowIso = (): string => new Date().toISOString();

/**
 * 岗位去重指纹 —— PRD §30。
 *
 * 优先用 companyId + 网站自己的 jobId（最可靠）；
 * 没有 jobId 时退到内容 hash。**注意不含 description**：
 * 招聘网站常微调岗位描述，把它算进指纹会导致同一岗位被认成新岗位。
 */
export function jobFingerprint(input: {
  companyId: string;
  externalJobId?: string | undefined;
  title: string;
  location?: string | undefined;
  department?: string | undefined;
}): string {
  if (input.externalJobId !== undefined && input.externalJobId.length > 0) {
    return `${input.companyId}:${input.externalJobId}`;
  }

  const material = [input.companyId, input.title, input.location ?? '', input.department ?? '']
    .map((part) => part.trim().toLowerCase())
    .join('|');

  return `hash:${createHash('sha256').update(material).digest('hex').slice(0, 32)}`;
}

export class ApplicationRepository {
  constructor(private readonly db: AutoJobDatabase) {}

  // —— 公司 ——

  upsertCompany(input: {
    name: string;
    atsType?: string;
    careerUrl?: string;
    category?: string;
  }): Company {
    const existing = this.db.select().from(companies).where(eq(companies.name, input.name)).get();
    if (existing !== undefined) {
      // ATS 类型可能在后续识别中变得更准确，允许更新
      if (input.atsType !== undefined && input.atsType !== existing.atsType) {
        this.db
          .update(companies)
          .set({ atsType: input.atsType })
          .where(eq(companies.id, existing.id))
          .run();
        return { ...existing, atsType: input.atsType };
      }
      return existing;
    }

    const company: Company = {
      id: `co_${randomUUID().slice(0, 8)}`,
      name: input.name,
      atsType: input.atsType ?? 'unknown',
      careerUrl: input.careerUrl ?? null,
      category: input.category ?? null,
      notes: null,
      createdAt: nowIso(),
    };
    this.db.insert(companies).values(company).run();
    return company;
  }

  // —— 岗位 ——

  upsertJob(input: {
    companyId: string;
    title: string;
    url: string;
    externalJobId?: string;
    department?: string;
    location?: string;
    description?: string;
  }): Job {
    const fingerprint = jobFingerprint(input);
    const existing = this.db.select().from(jobs).where(eq(jobs.fingerprint, fingerprint)).get();
    if (existing !== undefined) return existing;

    const job: Job = {
      id: `job_${randomUUID().slice(0, 8)}`,
      companyId: input.companyId,
      externalJobId: input.externalJobId ?? null,
      title: input.title,
      department: input.department ?? null,
      location: input.location ?? null,
      url: input.url,
      description: input.description ?? null,
      fingerprint,
      createdAt: nowIso(),
    };
    this.db.insert(jobs).values(job).run();
    return job;
  }

  // —— 投递 ——

  /** 该岗位是否已投递过 —— 填表之前就该问这一句（PRD §30） */
  findApplicationByJob(jobId: string): Application | undefined {
    return this.db.select().from(applications).where(eq(applications.jobId, jobId)).get();
  }

  createApplication(input: {
    companyId: string;
    jobId: string;
    runId: string;
    status: ApplicationStatus;
    resumeVersionId?: string;
    referralCode?: string;
    screenshotDir?: string;
    warnings?: readonly unknown[];
  }): Application {
    const duplicate = this.findApplicationByJob(input.jobId);
    if (duplicate !== undefined) {
      throw new AutoJobError(
        ErrorCode.DUPLICATE_APPLICATION,
        `该岗位已于 ${duplicate.createdAt.slice(0, 10)} 投递过（状态：${duplicate.status}）`,
        {
          hint: '如需重新投递，请先在投递记录中撤回原记录',
          context: { applicationId: duplicate.id, status: duplicate.status },
        },
      );
    }

    const at = nowIso();
    const application: Application = {
      id: `app_${randomUUID().slice(0, 8)}`,
      companyId: input.companyId,
      jobId: input.jobId,
      runId: input.runId,
      status: input.status,
      resumeVersionId: input.resumeVersionId ?? null,
      referralCode: input.referralCode ?? null,
      confirmationText: null,
      screenshotDir: input.screenshotDir ?? null,
      warningsJson: input.warnings === undefined ? null : JSON.stringify(input.warnings),
      notes: null,
      createdAt: at,
      submittedAt: null,
      updatedAt: at,
    };

    this.db.insert(applications).values(application).run();
    this.recordEvent(application.id, {
      eventType: 'CREATED',
      newStatus: input.status,
      source: 'system',
      notes: `Run ${input.runId}`,
    });

    return application;
  }

  /**
   * 更新状态并自动记录事件。
   *
   * 这是**唯一**允许改状态的入口 —— 直接 update applications.status 会漏掉时间线。
   */
  updateStatus(
    applicationId: string,
    next: ApplicationStatus,
    options: {
      source?: 'system' | 'user' | 'email';
      notes?: string;
      confirmationText?: string;
    } = {},
  ): Application {
    const current = this.db
      .select()
      .from(applications)
      .where(eq(applications.id, applicationId))
      .get();

    if (current === undefined) {
      throw new AutoJobError(ErrorCode.STORAGE_FAILED, `投递记录不存在：${applicationId}`);
    }

    const at = nowIso();
    const patch: Partial<Application> = {
      status: next,
      updatedAt: at,
      ...(next === 'SUBMITTED' ? { submittedAt: at } : {}),
      ...(options.confirmationText === undefined
        ? {}
        : { confirmationText: options.confirmationText }),
    };

    this.db.update(applications).set(patch).where(eq(applications.id, applicationId)).run();
    this.recordEvent(applicationId, {
      eventType: 'STATUS_CHANGED',
      oldStatus: current.status,
      newStatus: next,
      source: options.source ?? 'system',
      ...(options.notes === undefined ? {} : { notes: options.notes }),
    });

    return { ...current, ...patch };
  }

  recordEvent(
    applicationId: string,
    input: {
      eventType: string;
      oldStatus?: string;
      newStatus?: string;
      source?: string;
      notes?: string;
    },
  ): void {
    this.db
      .insert(applicationEvents)
      .values({
        id: `ev_${randomUUID().slice(0, 8)}`,
        applicationId,
        eventType: input.eventType,
        oldStatus: input.oldStatus ?? null,
        newStatus: input.newStatus ?? null,
        source: input.source ?? 'system',
        notes: input.notes ?? null,
        createdAt: nowIso(),
      })
      .run();
  }

  /** 某次投递的完整时间线，按时间正序 */
  timeline(applicationId: string): Array<typeof applicationEvents.$inferSelect> {
    return this.db
      .select()
      .from(applicationEvents)
      .where(eq(applicationEvents.applicationId, applicationId))
      .all();
  }

  // —— Dashboard ——

  /** 各状态的投递数量 —— PRD §38 */
  statusCounts(): Record<string, number> {
    const rows = this.db
      .select({ status: applications.status, count: sql<number>`count(*)` })
      .from(applications)
      .groupBy(applications.status)
      .all();

    return Object.fromEntries(rows.map((row) => [row.status, Number(row.count)]));
  }

  /** 投递列表，最近的在前 */
  listApplications(options: { status?: ApplicationStatus; limit?: number } = {}): Array<{
    application: Application;
    company: Company;
    job: Job;
  }> {
    const base = this.db
      .select({ application: applications, company: companies, job: jobs })
      .from(applications)
      .innerJoin(companies, eq(applications.companyId, companies.id))
      .innerJoin(jobs, eq(applications.jobId, jobs.id))
      .orderBy(desc(applications.updatedAt));

    const rows =
      options.status === undefined
        ? base.all()
        : this.db
            .select({ application: applications, company: companies, job: jobs })
            .from(applications)
            .innerJoin(companies, eq(applications.companyId, companies.id))
            .innerJoin(jobs, eq(applications.jobId, jobs.id))
            .where(eq(applications.status, options.status))
            .orderBy(desc(applications.updatedAt))
            .all();

    return options.limit === undefined ? rows : rows.slice(0, options.limit);
  }

  // —— Mapping Memory 持久化 ——

  saveMappingRule(rule: {
    id: string;
    scope: string;
    atsType?: string | undefined;
    companyId?: string | undefined;
    fieldLabel?: string | undefined;
    semanticType?: string | undefined;
    allowedCandidateTypes: readonly string[];
    blockedCandidateTypes: readonly string[];
    origin: string;
    confidence: number;
    note?: string;
  }): void {
    this.db
      .insert(mappingRules)
      .values({
        id: rule.id,
        scope: rule.scope,
        atsType: rule.atsType ?? null,
        companyId: rule.companyId ?? null,
        fieldLabel: rule.fieldLabel ?? null,
        semanticType: rule.semanticType ?? null,
        allowedTypesJson: JSON.stringify(rule.allowedCandidateTypes),
        blockedTypesJson: JSON.stringify(rule.blockedCandidateTypes),
        origin: rule.origin,
        confidence: Math.round(rule.confidence * 100),
        note: rule.note ?? null,
        createdAt: nowIso(),
      })
      .onConflictDoNothing()
      .run();
  }

  /** 读出持久化的规则，供 MappingRuleStore 初始化 */
  loadMappingRules(context: { atsType?: string; companyId?: string } = {}): Array<{
    id: string;
    scope: string;
    atsType: string | undefined;
    companyId: string | undefined;
    fieldLabel: string | undefined;
    semanticType: string | undefined;
    allowedCandidateTypes: string[];
    blockedCandidateTypes: string[];
    origin: string;
    confidence: number;
    note: string;
  }> {
    const rows = this.db.select().from(mappingRules).all();

    return rows
      .filter((row) => {
        if (row.scope === 'global') return true;
        if (row.scope === 'ats') return row.atsType === context.atsType;
        if (row.scope === 'company') return row.companyId === context.companyId;
        return false;
      })
      .map((row) => ({
        id: row.id,
        scope: row.scope,
        atsType: row.atsType ?? undefined,
        companyId: row.companyId ?? undefined,
        fieldLabel: row.fieldLabel ?? undefined,
        semanticType: row.semanticType ?? undefined,
        allowedCandidateTypes: JSON.parse(row.allowedTypesJson) as string[],
        blockedCandidateTypes: JSON.parse(row.blockedTypesJson) as string[],
        origin: row.origin,
        confidence: row.confidence / 100,
        note: row.note ?? '',
      }));
  }

  /** 供测试与调试：某公司下的岗位数 */
  countJobs(companyId: string): number {
    const row = this.db
      .select({ count: sql<number>`count(*)` })
      .from(jobs)
      .where(and(eq(jobs.companyId, companyId)))
      .get();
    return Number(row?.count ?? 0);
  }
}
