import { describe, expect, it } from 'vitest';
import { AtsType, detectAts, shouldUseAdapter } from '../src/detector.js';

describe('脚本来源是最可靠的信号', () => {
  it('自有域名的 Moka 站靠脚本来源认出来', () => {
    // 真实案例：大疆用 apply.careers.dji.com，光看域名认不出是 Moka
    const result = detectAts({
      url: 'https://apply.careers.dji.com/campus-recruitment/dji/143359',
      resourceUrls: ['https://static-ats.mokahr.com/app.js', 'https://hm.baidu.com/hm.js'],
    });

    expect(result.ats).toBe(AtsType.MOKA);
    expect(result.confidence).toBeGreaterThan(0.9);
    expect(result.evidence.some((e) => e.includes('mokahr.com'))).toBe(true);
  });

  it('自有域名的北森站同理', () => {
    // vivo 用 hr-campus.vivo.com，普渡用 pudutech1.zhiye.com，脚本都来自北森 CDN
    const result = detectAts({
      url: 'https://hr-campus.vivo.com/personal/deliveryRecord',
      resourceUrls: ['https://acdn.bstatics.com/main.js'],
    });

    expect(result.ats).toBe(AtsType.BEISEN);
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it('飞书招聘', () => {
    const result = detectAts({
      url: 'https://xiaopeng.jobs.feishu.cn/campus/position',
      resourceUrls: ['https://lf-package-cn.feishucdn.com/a.js'],
    });

    expect(result.ats).toBe(AtsType.FEISHU);
    expect(result.confidence).toBeGreaterThan(0.9);
  });
});

describe('没有资源信息时靠 URL 特征，但置信度明显更低', () => {
  it('仅凭路径能认出北森，但不到自动启用 Adapter 的把握', () => {
    const result = detectAts({ url: 'https://we.zyt.com/personal/deliveryRecord' });

    expect(result.ats).toBe(AtsType.BEISEN);
    expect(result.confidence).toBeLessThan(0.6);
    expect(shouldUseAdapter(result)).toBe(false);
  });

  it('官方域名 + 路径两个信号叠加才够用', () => {
    const result = detectAts({ url: 'https://app.mokahr.com/campus-recruitment/x/1#/job/abc' });

    expect(result.ats).toBe(AtsType.MOKA);
    expect(shouldUseAdapter(result)).toBe(true);
  });
});

describe('认不出时如实返回 unknown', () => {
  it('自研站点不硬判', () => {
    const result = detectAts({
      url: 'https://campus.jd.com/home',
      resourceUrls: ['https://static.jd.com/app.js'],
    });

    expect(result.ats).toBe(AtsType.UNKNOWN);
    expect(shouldUseAdapter(result)).toBe(false);
  });

  it('非法 URL 不崩溃', () => {
    expect(detectAts({ url: 'not-a-url' }).ats).toBe(AtsType.UNKNOWN);
  });
});

describe('置信度阈值', () => {
  it('低于阈值时回落到 GenericAdapter', () => {
    expect(
      shouldUseAdapter({ ats: AtsType.MOKA, label: 'Moka', confidence: 0.3, evidence: [] }),
    ).toBe(false);
    expect(
      shouldUseAdapter({ ats: AtsType.MOKA, label: 'Moka', confidence: 0.7, evidence: [] }),
    ).toBe(true);
  });
});
