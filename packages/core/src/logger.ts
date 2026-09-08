/**
 * 日志器 —— 所有输出强制过 PII 脱敏（PRD §44）。
 *
 * 用法：
 *   const log = createLogger('ats-detector', { runId });
 *   log.info('检测到 ATS', { atsType: 'moka', confidence: 0.96 });
 *
 * 设计要点：
 * - 结构化字段走 redactValue，消息文本走 maskText，两道都过。
 * - ESLint 禁止业务代码直接调 console.*，逼所有输出走这里。
 */

import { redactValue, maskText } from './mask.js';

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type LogFields = Record<string, unknown>;

export interface LogRecord {
  readonly time: string;
  readonly level: LogLevel;
  readonly scope: string;
  readonly message: string;
  readonly runId?: string;
  readonly fields?: LogFields;
}

/** 日志落点。默认写 stderr，测试里可替换成内存收集器。 */
export type LogSink = (record: LogRecord) => void;

export interface LoggerOptions {
  readonly runId?: string;
  readonly level?: LogLevel;
  readonly sink?: LogSink;
  readonly now?: () => Date;
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** 派生子 logger，继承 runId 与 level */
  child(scope: string): Logger;
}

const defaultSink: LogSink = (record) => {
  const runIdPart = record.runId ? ` [${record.runId}]` : '';
  const fieldsPart =
    record.fields && Object.keys(record.fields).length > 0
      ? ` ${JSON.stringify(record.fields)}`
      : '';
  console.error(
    `${record.time} ${record.level.toUpperCase().padEnd(5)}${runIdPart} ${record.scope}: ${record.message}${fieldsPart}`,
  );
};

export function createLogger(scope: string, options: LoggerOptions = {}): Logger {
  const minWeight = LEVEL_WEIGHT[options.level ?? 'info'];
  const sink = options.sink ?? defaultSink;
  const now = options.now ?? ((): Date => new Date());

  const emit = (level: LogLevel, message: string, fields?: LogFields): void => {
    if (LEVEL_WEIGHT[level] < minWeight) return;

    const safeFields = fields === undefined ? undefined : (redactValue(fields) as LogFields);

    sink({
      time: now().toISOString(),
      level,
      scope,
      message: maskText(message),
      ...(options.runId === undefined ? {} : { runId: options.runId }),
      ...(safeFields === undefined ? {} : { fields: safeFields }),
    });
  };

  return {
    debug: (message, fields) => emit('debug', message, fields),
    info: (message, fields) => emit('info', message, fields),
    warn: (message, fields) => emit('warn', message, fields),
    error: (message, fields) => emit('error', message, fields),
    child: (childScope) => createLogger(`${scope}:${childScope}`, options),
  };
}

/** 测试用：把日志收集进数组而不是打到终端。 */
export function createMemorySink(): { sink: LogSink; records: LogRecord[] } {
  const records: LogRecord[] = [];
  return { sink: (record) => void records.push(record), records };
}
