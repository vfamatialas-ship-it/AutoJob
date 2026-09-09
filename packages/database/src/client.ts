/**
 * 数据库连接与建表。
 *
 * 用 Drizzle 定义 schema，但建表走手写 DDL 而不是 drizzle-kit 迁移文件 ——
 * 现阶段只有一个用户、一台机器、一个版本，引入迁移工具链的收益还不如
 * 「打开就能用」来得实在。等 schema 真正需要演进（M9 之后）再切到迁移。
 * 那时 Drizzle 的定义已经在这里了，切换成本很低。
 */

import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { AutoJobError, ErrorCode, requireExternal } from '@autojob/core';
import * as schema from './schema.js';

/** 默认数据库位置。个人投递数据留在本地（PRD §41） */
export const DEFAULT_DB_PATH = join(homedir(), '.autojob', 'autojob.db');

export type AutoJobDatabase = BetterSQLite3Database<typeof schema> & {
  /** 关闭底层连接 */
  close(): void;
};

/** 建表语句。IF NOT EXISTS 让重复打开是安全的。 */
const DDL = `
CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  ats_type TEXT NOT NULL DEFAULT 'unknown',
  career_url TEXT,
  category TEXT,
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS companies_name_idx ON companies(name);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  external_job_id TEXT,
  title TEXT NOT NULL,
  department TEXT,
  location TEXT,
  url TEXT NOT NULL,
  description TEXT,
  fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_fingerprint_idx ON jobs(fingerprint);
CREATE INDEX IF NOT EXISTS jobs_company_idx ON jobs(company_id);

CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  job_id TEXT NOT NULL REFERENCES jobs(id),
  run_id TEXT NOT NULL,
  status TEXT NOT NULL,
  resume_version_id TEXT,
  referral_code TEXT,
  confirmation_text TEXT,
  screenshot_dir TEXT,
  warnings_json TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  submitted_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS applications_status_idx ON applications(status);
CREATE INDEX IF NOT EXISTS applications_company_idx ON applications(company_id);
CREATE UNIQUE INDEX IF NOT EXISTS applications_job_idx ON applications(job_id);

CREATE TABLE IF NOT EXISTS application_events (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL REFERENCES applications(id),
  event_type TEXT NOT NULL,
  old_status TEXT,
  new_status TEXT,
  source TEXT NOT NULL DEFAULT 'system',
  notes TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_application_idx ON application_events(application_id);

CREATE TABLE IF NOT EXISTS mapping_rules (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  ats_type TEXT,
  company_id TEXT,
  field_label TEXT,
  semantic_type TEXT,
  allowed_types_json TEXT NOT NULL DEFAULT '[]',
  blocked_types_json TEXT NOT NULL DEFAULT '[]',
  origin TEXT NOT NULL DEFAULT 'user',
  confidence INTEGER NOT NULL DEFAULT 100,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS rules_lookup_idx ON mapping_rules(scope, semantic_type);
`;

export interface OpenOptions {
  /** 数据库路径。传 ':memory:' 可用于测试 */
  readonly path?: string;
}

export function openDatabase(options: OpenOptions = {}): AutoJobDatabase {
  const path = options.path ?? DEFAULT_DB_PATH;

  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }

  /*
   * better-sqlite3 是原生扩展，打包成单文件可执行程序后不能走普通 require ——
   * 必须从可执行文件旁边解析。详见 requireExternal 的说明。
   */
  const DatabaseCtor = requireExternal<typeof Database>('better-sqlite3', import.meta.url);

  let sqlite: Database.Database;
  try {
    sqlite = new DatabaseCtor(path);
  } catch (cause) {
    throw new AutoJobError(ErrorCode.STORAGE_FAILED, `无法打开数据库：${path}`, { cause });
  }

  // WAL 提升并发读写表现；外键约束默认是关的，必须显式打开
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(DDL);

  // 用 Object.assign 而不是类型断言：前者产生的交叉类型是真实的，
  // 断言只是骗过编译器，close 方法实际并不存在。
  return Object.assign(drizzle(sqlite, { schema }), {
    // 用块体而非表达式体：better-sqlite3 的 close() 返回 Database 以支持链式调用，
    // 表达式体会把它当作返回值，与声明的 void 冲突
    close: (): void => {
      sqlite.close();
    },
  });
}
