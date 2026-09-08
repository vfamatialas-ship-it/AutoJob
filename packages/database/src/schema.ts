/**
 * 数据库 Schema —— PRD §36 / §37 / §61。
 *
 * ## 全部数据留在本地（PRD §41）
 *
 * 这个库文件默认落在 `~/.autojob/autojob.db`，永远不上传。
 * 它记录「投了哪家、什么岗位、用了哪版简历、现在什么状态」，
 * 是整个秋招周期里最有价值的资产 —— 也正因如此，它绝不该离开用户的机器。
 *
 * ## 为什么状态变化要单独建表
 *
 * Application 只存当前状态，ApplicationEvent 存每一次变化。
 * 前者回答「现在怎么样」，后者回答「怎么走到今天的」。
 * 秋招周期长达数月，没有时间线就无法回答「这家公司卡了多久」。
 */

import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/** 投递状态 —— PRD §36 全量 14 态 */
export const APPLICATION_STATUSES = [
  'DISCOVERED',
  'MATCHED',
  'SAVED',
  'QUEUED',
  'FILLING',
  'WAITING_USER',
  'READY_TO_SUBMIT',
  'SUBMITTED',
  'OA',
  'INTERVIEW',
  'OFFER',
  'REJECTED',
  'WITHDRAWN',
  'FAILED',
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const companies = sqliteTable(
  'companies',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    /** 识别出的 ATS 类型，未知时为 'unknown' */
    atsType: text('ats_type').notNull().default('unknown'),
    /** 招聘主页 */
    careerUrl: text('career_url'),
    /** 企业类型：互联网 / 国企 / 具身初创 等，来自用户的分类习惯 */
    category: text('category'),
    notes: text('notes'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [uniqueIndex('companies_name_idx').on(table.name)],
);

export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id')
      .notNull()
      .references(() => companies.id),
    /** 网站自己的岗位 ID。没有时留空，靠 hash 去重（PRD §30） */
    externalJobId: text('external_job_id'),
    title: text('title').notNull(),
    department: text('department'),
    location: text('location'),
    url: text('url').notNull(),
    description: text('description'),
    /**
     * 去重指纹。有 externalJobId 时用 companyId+externalJobId，
     * 否则用 company+title+location+department 的 hash（PRD §30）
     */
    fingerprint: text('fingerprint').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('jobs_fingerprint_idx').on(table.fingerprint),
    index('jobs_company_idx').on(table.companyId),
  ],
);

export const applications = sqliteTable(
  'applications',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id')
      .notNull()
      .references(() => companies.id),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id),
    /** 本次运行的 Run ID，串联日志与截图（PRD §73） */
    runId: text('run_id').notNull(),
    status: text('status').notNull(),
    /** 用了哪一版简历 —— PRD §17 明确要求记录 */
    resumeVersionId: text('resume_version_id'),
    referralCode: text('referral_code'),
    /** 提交成功后网站返回的确认文本，是「真的投出去了」的证据 */
    confirmationText: text('confirmation_text'),
    /** 截图目录，相对于 runs 根目录 */
    screenshotDir: text('screenshot_dir'),
    /** 映射与填写过程中产生的 warning，JSON 数组 */
    warningsJson: text('warnings_json'),
    notes: text('notes'),
    createdAt: text('created_at').notNull(),
    submittedAt: text('submitted_at'),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('applications_status_idx').on(table.status),
    index('applications_company_idx').on(table.companyId),
    // 同一岗位只应有一条投递记录 —— 防重复投递的数据库层保障（PRD §30）
    uniqueIndex('applications_job_idx').on(table.jobId),
  ],
);

export const applicationEvents = sqliteTable(
  'application_events',
  {
    id: text('id').primaryKey(),
    applicationId: text('application_id')
      .notNull()
      .references(() => applications.id),
    eventType: text('event_type').notNull(),
    oldStatus: text('old_status'),
    newStatus: text('new_status'),
    /** 事件来源：system / user / email */
    source: text('source').notNull().default('system'),
    notes: text('notes'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('events_application_idx').on(table.applicationId)],
);

/**
 * Mapping Memory 的持久化 —— 补上 M4 的已知限制。
 *
 * M4 的 MappingRuleStore 是内存实现，重启即失效。
 * 这张表让「用户确认过一次的字段映射」跨会话保留，
 * 这正是 Mapping Memory 的价值所在（PRD §21 / §65）。
 */
export const mappingRules = sqliteTable(
  'mapping_rules',
  {
    id: text('id').primaryKey(),
    scope: text('scope').notNull(),
    atsType: text('ats_type'),
    companyId: text('company_id'),
    fieldLabel: text('field_label'),
    semanticType: text('semantic_type'),
    allowedTypesJson: text('allowed_types_json').notNull().default('[]'),
    blockedTypesJson: text('blocked_types_json').notNull().default('[]'),
    origin: text('origin').notNull().default('user'),
    confidence: integer('confidence').notNull().default(100),
    note: text('note'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('rules_lookup_idx').on(table.scope, table.semanticType)],
);

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type Application = typeof applications.$inferSelect;
export type NewApplication = typeof applications.$inferInsert;
export type ApplicationEvent = typeof applicationEvents.$inferSelect;
export type MappingRuleRow = typeof mappingRules.$inferSelect;
