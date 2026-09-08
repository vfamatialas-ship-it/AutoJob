import { describe, expect, it } from 'vitest';
import { createLogger, createMemorySink } from '../src/logger.js';

const fixedNow = (): Date => new Date('2026-09-08T15:30:00.000Z');

describe('createLogger', () => {
  it('消息文本中的手机号被脱敏', () => {
    const { sink, records } = createMemorySink();
    createLogger('test', { sink, now: fixedNow }).info('用户手机号 13812341234 已填写');

    expect(records[0]?.message).toBe('用户手机号 138****1234 已填写');
  });

  it('结构化字段中的敏感 key 被屏蔽', () => {
    const { sink, records } = createMemorySink();
    createLogger('test', { sink, now: fixedNow }).info('登录', {
      cookie: 'SESSIONID=abc',
      phone: '13812341234',
    });

    const fields = records[0]?.fields as Record<string, unknown>;
    expect(fields['cookie']).toBe('[已屏蔽]');
    expect(fields['phone']).toBe('138****1234');
  });

  it('低于阈值的级别不输出', () => {
    const { sink, records } = createMemorySink();
    const log = createLogger('test', { sink, level: 'warn', now: fixedNow });
    log.debug('看不见');
    log.info('也看不见');
    log.warn('看得见');

    expect(records).toHaveLength(1);
    expect(records[0]?.level).toBe('warn');
  });

  it('携带 runId 便于串联一次投递的全过程', () => {
    const { sink, records } = createMemorySink();
    createLogger('test', { sink, runId: 'run_20260908T153000_a1b2c3', now: fixedNow }).info('开始');

    expect(records[0]?.runId).toBe('run_20260908T153000_a1b2c3');
  });

  it('child logger 继承 runId 并拼接 scope', () => {
    const { sink, records } = createMemorySink();
    createLogger('browser', { sink, runId: 'run_x', now: fixedNow }).child('filler').info('填写中');

    expect(records[0]?.scope).toBe('browser:filler');
    expect(records[0]?.runId).toBe('run_x');
  });
});
