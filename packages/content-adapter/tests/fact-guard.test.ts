import { describe, expect, it } from 'vitest';
import {
  extractNumerics,
  factSourceFrom,
  guardGeneratedContent,
  type FactSource,
} from '../src/fact-guard.js';

const source: FactSource = {
  metrics: ['90.4%', '86.7%', '2→4→6'],
  statements: ['单臂抓取成功率达到 90.4%', '双臂抓取成功率达到 86.7%'],
  canonicalTexts: ['研发全球首款适形水下作业航行器，实验室搭建近岸浅海模拟环境。'],
  structuralValues: ['2024-09', '2026-06'],
};

describe('extractNumerics', () => {
  it('抽出百分比', () => {
    expect(extractNumerics('成功率 90.4%')).toContain('90.4%');
  });

  it('抽出带中文单位的数量', () => {
    expect(extractNumerics('真机采集 200 条轨迹')).toContain('200条');
  });

  it('抽出裸数字', () => {
    expect(extractNumerics('共 6 个阶段')).toContain('6');
  });

  it('空文本返回空数组', () => {
    expect(extractNumerics('纯文字没有数字')).toEqual([]);
  });
});

describe('拦住编造的量化成果（PRD §3.5）', () => {
  it('引用真实指标时通过', () => {
    const result = guardGeneratedContent('单臂抓取成功率达到 90.4%，双臂 86.7%。', source);

    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.checkedCount).toBeGreaterThan(0);
  });

  it('注入不存在的数字时拦截', () => {
    const result = guardGeneratedContent('单臂抓取成功率达到 99.9%。', source);

    expect(result.ok).toBe(false);
    expect(result.violations[0]?.numeric).toBe('99.9%');
  });

  it('把 90.4% 悄悄改成 94% 也会被抓到', () => {
    const result = guardGeneratedContent('成功率 94%', source);
    expect(result.ok).toBe(false);
  });

  it('违规信息带上下文，便于定位', () => {
    const result = guardGeneratedContent('第一句没问题。第二句声称成功率 99%。', source);

    expect(result.violations[0]?.context).toContain('99');
    expect(result.violations[0]?.context).not.toContain('第一句');
  });

  it('日期等结构化数值不算编造', () => {
    expect(guardGeneratedContent('2024-09 — 2026-06', source).ok).toBe(true);
  });

  it('空白差异不影响判定：「200 条」与「200条」是同一事实', () => {
    const withSpace: FactSource = { ...source, metrics: ['200 条'] };
    expect(guardGeneratedContent('真机采集200条轨迹', withSpace).ok).toBe(true);
  });

  it('引用 statement 中出现但未列入 metrics 的数字也放行', () => {
    const partial: FactSource = {
      metrics: [],
      statements: ['垃圾数量由 2→4→6 递增'],
      canonicalTexts: [],
      structuralValues: [],
    };
    expect(guardGeneratedContent('数量由 2→4→6 递增', partial).ok).toBe(true);
  });
});

describe('factSourceFrom', () => {
  it('从 Profile 记录构造事实来源', () => {
    const built = factSourceFrom({
      canonicalFacts: [{ statement: '成功率 71.56%', metrics: ['71.56%'] }],
      descriptionCanonical: '面向工业打包场景的长程任务。',
      responsibilities: ['子任务细粒度优化'],
      achievements: ['长程成功率 0.03% → 71.56%'],
      name: 'Nero 双臂分拣',
      startDate: '2026-05',
      endDate: '2026-08',
    });

    expect(built.metrics).toContain('71.56%');
    expect(built.structuralValues).toContain('2026-05');
    expect(built.canonicalTexts.some((text) => text.includes('子任务'))).toBe(true);
  });

  it('用构造出的来源校验原文，必然通过', () => {
    const record = {
      canonicalFacts: [{ statement: '成功率由 0.03% 提升至 71.56%', metrics: ['0.03%', '71.56%'] }],
      descriptionCanonical: '6 阶段长程任务。',
      responsibilities: [],
      achievements: [],
      name: 'x',
      startDate: '2026-05',
      endDate: '2026-08',
    };

    const result = guardGeneratedContent(
      '成功率由 0.03% 提升至 71.56%，覆盖 6 阶段长程任务。',
      factSourceFrom(record),
    );
    expect(result.ok).toBe(true);
  });
});
