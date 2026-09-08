/**
 * Run ID —— PRD §73 Observability。
 *
 * 每次 Application Run 生成一个 ID，贯穿日志、截图目录、数据库记录，
 * 便于事后追查「这次投递到底填了什么、在哪一步挂的」。
 *
 * 格式：run_20260908T231530_a1b2c3  （时间前缀让目录天然按时间排序）
 */

import { randomBytes } from 'node:crypto';

const timestampPart = (date: Date): string =>
  date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, '');

export function createRunId(now: Date = new Date()): string {
  return `run_${timestampPart(now)}_${randomBytes(3).toString('hex')}`;
}

const RUN_ID_PATTERN = /^run_\d{8}T\d{6}_[0-9a-f]{6}$/;

export const isRunId = (value: string): boolean => RUN_ID_PATTERN.test(value);
