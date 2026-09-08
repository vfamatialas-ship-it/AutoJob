import { describe, expect, it } from 'vitest';
import { createRunId, isRunId } from '../src/run-id.js';

describe('createRunId', () => {
  it('生成符合格式的 Run ID', () => {
    const id = createRunId(new Date('2026-09-08T23:15:30.000Z'));
    expect(id).toMatch(/^run_20260908T231530_[0-9a-f]{6}$/);
    expect(isRunId(id)).toBe(true);
  });

  it('时间前缀保证目录可按时间排序', () => {
    const early = createRunId(new Date('2026-09-08T01:00:00.000Z'));
    const late = createRunId(new Date('2026-09-08T02:00:00.000Z'));
    expect(early < late).toBe(true);
  });

  it('同一时刻的多次调用不会撞 ID', () => {
    const now = new Date('2026-09-08T23:15:30.000Z');
    const ids = new Set(Array.from({ length: 200 }, () => createRunId(now)));
    expect(ids.size).toBeGreaterThan(190);
  });

  it('拒绝格式不合法的字符串', () => {
    expect(isRunId('run_bad')).toBe(false);
    expect(isRunId('20260908T231530_a1b2c3')).toBe(false);
  });
});
