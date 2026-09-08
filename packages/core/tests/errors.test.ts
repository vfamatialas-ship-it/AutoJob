import { describe, expect, it } from 'vitest';
import { AutoJobError, ErrorCode, isUserActionable, toAutoJobError } from '../src/errors.js';
import { err, isErr, isOk, mapErr, mapOk, ok, unwrap, unwrapOr } from '../src/result.js';

describe('AutoJobError', () => {
  it('携带错误码与用户提示', () => {
    const error = new AutoJobError(ErrorCode.LOGIN_REQUIRED, '站点要求登录', {
      hint: '请在浏览器中完成扫码登录',
    });

    expect(error.code).toBe('LOGIN_REQUIRED');
    expect(error.hint).toBe('请在浏览器中完成扫码登录');
    expect(error.userActionable).toBe(true);
  });

  it('区分「需用户介入」与「系统自处理」的错误', () => {
    expect(isUserActionable(ErrorCode.CAPTCHA_REQUIRED)).toBe(true);
    expect(isUserActionable(ErrorCode.SESSION_EXPIRED)).toBe(true);
    expect(isUserActionable(ErrorCode.UPLOAD_FAILED)).toBe(false);
    expect(isUserActionable(ErrorCode.INTERNAL)).toBe(false);
  });

  it('toAutoJobError 归一化任意抛出物', () => {
    expect(toAutoJobError(new AutoJobError(ErrorCode.UPLOAD_FAILED, 'x').valueOf()).code).toBe(
      'UPLOAD_FAILED',
    );
    expect(toAutoJobError(new Error('boom')).code).toBe('INTERNAL');
    expect(toAutoJobError('字符串异常').message).toBe('字符串异常');
    expect(toAutoJobError(new Error('boom'), ErrorCode.LLM_FAILED).code).toBe('LLM_FAILED');
  });
});

describe('Result', () => {
  it('ok / err 与类型守卫', () => {
    expect(isOk(ok(1))).toBe(true);
    expect(isErr(err('e'))).toBe(true);
  });

  it('unwrap 成功值，失败时抛出', () => {
    expect(unwrap(ok(42))).toBe(42);
    expect(() => unwrap(err('炸了'))).toThrow();
  });

  it('unwrapOr 提供兜底', () => {
    expect(unwrapOr(err<string>('e'), 7)).toBe(7);
  });

  it('mapOk / mapErr 只作用于对应分支', () => {
    expect(mapOk(ok(2), (n) => n * 3)).toEqual({ ok: true, value: 6 });
    expect(mapOk(err<string>('e'), (n: number) => n * 3)).toEqual({ ok: false, error: 'e' });
    expect(mapErr(err('e'), (e) => `${e}!`)).toEqual({ ok: false, error: 'e!' });
  });
});
