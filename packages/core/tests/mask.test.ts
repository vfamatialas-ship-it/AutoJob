/**
 * 注意：本文件全部使用**虚构**的手机号 / 身份证 / 邮箱。
 * 真实个人数据不得进入代码仓库 —— 测试文件同样会被提交和上传。
 */
import { describe, expect, it } from 'vitest';
import {
  REDACTED,
  maskEmail,
  maskIdNumber,
  maskPhone,
  maskText,
  redactValue,
} from '../src/mask.js';

describe('maskPhone', () => {
  it('把手机号中间四位遮蔽成 138****1234 的形式', () => {
    expect(maskPhone('13812341234')).toBe('138****1234');
  });

  it('能处理嵌在句子里的手机号', () => {
    expect(maskPhone('联系方式 15987654321 请查收')).toBe('联系方式 159****4321 请查收');
  });

  it('不误伤更长的数字串（身份证里的连续 11 位不算手机号）', () => {
    const eighteenDigits = '110101199003071234';
    expect(maskPhone(eighteenDigits)).toBe(eighteenDigits);
  });

  it('不误伤非 1[3-9] 开头的 11 位数字', () => {
    expect(maskPhone('12012341234')).toBe('12012341234');
  });
});

describe('maskIdNumber', () => {
  it('18 位身份证整体屏蔽，不保留任何片段', () => {
    const masked = maskIdNumber('身份证：110101199003071234');
    expect(masked).toBe('身份证：[身份证已屏蔽]');
    expect(masked).not.toContain('1101');
  });

  it('支持末位为 X 的身份证', () => {
    expect(maskIdNumber('11010119900307123X')).toBe('[身份证已屏蔽]');
  });

  it('支持 15 位旧格式', () => {
    expect(maskIdNumber('110101900307123')).toBe('[身份证已屏蔽]');
  });
});

describe('maskEmail', () => {
  it('保留首字母与域名', () => {
    expect(maskEmail('zhangsan@example.com')).toBe('z***@example.com');
  });

  it('支持多级域名', () => {
    expect(maskEmail('a.b+c@mail.stu.edu.cn')).toBe('a***@mail.stu.edu.cn');
  });
});

describe('maskText 综合脱敏', () => {
  it('同时处理身份证与手机号，且身份证不被拆成手机号', () => {
    const input = '候选人 110101199003071234，电话 13812341234';
    const output = maskText(input);
    expect(output).toContain('[身份证已屏蔽]');
    expect(output).toContain('138****1234');
    expect(output).not.toContain('110101199003071234');
    expect(output).not.toContain('13812341234');
  });

  it('回归：邮箱本地部分含长数字时，不被手机号规则切碎', () => {
    // 曾经的 bug：maskPhone 先跑，把 19303864024 当成手机号切成 193****4024，
    // 导致 maskEmail 只能从星号后接手，最终输出 Yang193****4***@qq.com，
    // 暴露的字符远多于预期的「首字母 + 域名」。
    const output = maskText('zhang19303864024@qq.com');

    expect(output).toBe('z***@qq.com');
    expect(output).not.toContain('193');
  });

  it('回归：同一段文本里的邮箱与手机号各自按规则脱敏', () => {
    const output = maskText('邮箱 li12345678901@example.com 电话 13812341234');

    expect(output).toContain('l***@example.com');
    expect(output).toContain('138****1234');
    expect(output).not.toContain('12345678901');
  });

  it('屏蔽 Bearer token', () => {
    expect(maskText('Authorization: Bearer abc.def.ghi')).toContain('[已屏蔽]');
    expect(maskText('Authorization: Bearer abc.def.ghi')).not.toContain('abc.def.ghi');
  });

  it('屏蔽 key=value 形态的凭证', () => {
    const output = maskText('cookie=SESSIONID=xyz123; token=t0ps3cret');
    expect(output).not.toContain('t0ps3cret');
    expect(output).not.toContain('xyz123');
  });
});

describe('redactValue 结构化屏蔽', () => {
  it('按 key 名整体屏蔽敏感字段', () => {
    const output = redactValue({
      idNumber: '110101199003071234',
      password: 'hunter2',
      cookie: 'SESSIONID=abc',
      accessToken: 'tok_live_123',
    }) as Record<string, unknown>;

    expect(output['idNumber']).toBe(REDACTED);
    expect(output['password']).toBe(REDACTED);
    expect(output['cookie']).toBe(REDACTED);
    expect(output['accessToken']).toBe(REDACTED);
  });

  it('key 名归一化：id_number / ID-Number 同样命中', () => {
    const output = redactValue({ id_number: 'x', 'ID-Number': 'y' }) as Record<string, unknown>;
    expect(output['id_number']).toBe(REDACTED);
    expect(output['ID-Number']).toBe(REDACTED);
  });

  it('手机号 / 邮箱字段做部分脱敏而非整体屏蔽（保留排查价值）', () => {
    const output = redactValue({ phone: '13812341234', email: 'zhangsan@example.com' }) as Record<
      string,
      unknown
    >;
    expect(output['phone']).toBe('138****1234');
    expect(output['email']).toBe('z***@example.com');
  });

  it('递归处理嵌套对象与数组', () => {
    const output = redactValue({
      profile: { basic: { phone: '13812341234' } },
      list: [{ password: 'p' }],
    }) as { profile: { basic: { phone: string } }; list: Array<{ password: string }> };

    expect(output.profile.basic.phone).toBe('138****1234');
    expect(output.list[0]?.password).toBe(REDACTED);
  });

  it('普通字符串字段也会过 maskText，防止 PII 混在自由文本里溜走', () => {
    const output = redactValue({ note: '备注：13812341234' }) as Record<string, unknown>;
    expect(output['note']).toBe('备注：138****1234');
  });

  it('循环引用不会爆栈', () => {
    const cyclic: Record<string, unknown> = { name: 'a' };
    cyclic['self'] = cyclic;
    const output = redactValue(cyclic) as Record<string, unknown>;
    expect(output['self']).toBe('[循环引用]');
  });

  it('Error 对象只保留 name 与脱敏后的 message', () => {
    const output = redactValue(new Error('failed for 13812341234')) as Record<string, unknown>;
    expect(output['message']).toBe('failed for 138****1234');
  });
});
