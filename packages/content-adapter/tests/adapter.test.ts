import { describe, expect, it } from 'vitest';
import { adaptEntries, adaptRecord, type AdaptableRecord } from '../src/adapter.js';

/** 结构取自真实经历，但内容已泛化 */
const underwater: AdaptableRecord = {
  id: 'exp-underwater',
  name: '水下双臂垃圾捡取 VLA 算法研究',
  organization: '某高校机器人研究所',
  role: '课题负责人',
  startDate: '2024-09',
  endDate: '2026-06',
  descriptionCanonical:
    '研发适形水下作业航行器，基于其搭载的水下双机械臂，在实验室搭建近岸浅海模拟环境。研究多目标、长程、双臂协同条件下的垃圾自主感知与连续抓取的 VLA 算法框架。该环境由沙石、鹅卵石及多类型海洋垃圾构成。',
  responsibilities: ['机械臂 SDK 开发与遥操作系统搭建', '水下视觉域增强插件研发'],
  achievements: ['单臂抓取成功率 90.4%', '双臂抓取成功率 86.7%'],
  canonicalFacts: [
    { id: 'f1', statement: '单臂抓取成功率达到 90.4%', metrics: ['90.4%'] },
    { id: 'f2', statement: '双臂抓取成功率达到 86.7%', metrics: ['86.7%'] },
  ],
};

const sorting: AdaptableRecord = {
  id: 'exp-sorting',
  name: '双臂分拣装箱长程任务 VLA-RL 系统',
  organization: '某科技公司',
  role: '算法实习生',
  startDate: '2026-05',
  endDate: '2026-08',
  descriptionCanonical: '面向工业打包场景构建长程 VLA 操作系统，实现 6 阶段长程任务。',
  responsibilities: ['子任务细粒度优化'],
  achievements: ['长程任务成功率由 0.03% 提升至 71.56%'],
  canonicalFacts: [
    { id: 'f3', statement: '成功率由 0.03% 提升至 71.56%', metrics: ['0.03%', '71.56%'] },
  ],
};

describe('压缩到目标长度', () => {
  it('不限长度时内容完整', () => {
    const result = adaptRecord(underwater, 100_000);

    expect(result).toBeDefined();
    expect(result?.droppedUnits).toBe(0);
    expect(result?.text).toContain('90.4%');
    expect(result?.text).toContain('机械臂 SDK');
  });

  it('100 字限制下仍不超长', () => {
    const result = adaptRecord(underwater, 100);

    expect(result).toBeDefined();
    expect(result?.length).toBeLessThanOrEqual(100);
  });

  it('各种限制下都不超长', () => {
    for (const limit of [60, 80, 100, 150, 200, 300, 500]) {
      const result = adaptRecord(underwater, limit);
      expect(result?.length, `限制 ${limit} 时超长`).toBeLessThanOrEqual(limit);
    }
  });

  it('预算越紧，舍弃的单元越多', () => {
    const loose = adaptRecord(underwater, 500);
    const tight = adaptRecord(underwater, 120);

    expect(tight?.droppedUnits).toBeGreaterThan(loose?.droppedUnits ?? 0);
  });
});

describe('压缩时优先保留量化成果', () => {
  it('紧预算下先留带数字的成果', () => {
    const result = adaptRecord(underwater, 120);

    // 带指标的成果分数最高，应当活到最后
    expect(result?.text).toMatch(/90\.4%|86\.7%/);
  });

  it('溯源到具体的 fact id', () => {
    const result = adaptRecord(underwater, 500);
    expect(result?.sourceFactIds).toContain('f1');
  });
});

describe('绝不截断句子', () => {
  it('输出的每一行都是完整句子或完整条目', () => {
    const result = adaptRecord(underwater, 130);
    const lines = result?.text.split('\n') ?? [];

    for (const line of lines.slice(1)) {
      // 条目以 · 开头，句子以句号类标点结尾 —— 两者都不该是半截话
      const isBullet = line.startsWith('·');
      const isSentence = /[。！？；.!?;]$/.test(line);
      expect(isBullet || isSentence, `出现半截句子：${line}`).toBe(true);
    }
  });

  it('宁可少放一句也不留半截话', () => {
    const result = adaptRecord(underwater, 90);
    expect(result?.text).not.toMatch(/[，、]$/);
  });
});

describe('表头逐级降级，但名称永远保留', () => {
  it('宽裕时表头完整', () => {
    const result = adaptRecord(underwater, 500);
    expect(result?.text.split('\n')[0]).toContain('课题负责人');
  });

  it('预算不足时先丢角色，再丢日期，最后只留名称', () => {
    const nameOnly = adaptRecord(underwater, underwater.name.length + 2);
    expect(nameOnly?.text).toBe(underwater.name);
  });

  it('连名称都放不下时返回 undefined —— 任何输出都会误导', () => {
    expect(adaptRecord(underwater, 5)).toBeUndefined();
  });
});

describe('按岗位关键词强化表达（PRD §31）', () => {
  it('命中关键词的内容被优先保留', () => {
    const withKeyword = adaptRecord(underwater, 140, { targetKeywords: ['视觉'] });
    const without = adaptRecord(underwater, 140);

    expect(withKeyword?.text).toContain('视觉');
    // 不给关键词时，同等预算下未必会选中这条
    expect(withKeyword?.text).not.toBe(without?.text);
  });

  it('强化表达不会引入任何新事实', () => {
    const result = adaptRecord(underwater, 140, { targetKeywords: ['视觉', 'VLA'] });
    expect(result?.guard.ok).toBe(true);
  });
});

describe('事实校验是内建的回归防线', () => {
  it('任何长度下的输出都通过事实校验', () => {
    for (const limit of [60, 100, 200, 500, 100_000]) {
      const result = adaptRecord(underwater, limit);
      expect(result?.guard.ok, `限制 ${limit} 时出现无出处的数值`).toBe(true);
    }
  });

  it('校验确实检查了数值而不是空跑', () => {
    const result = adaptRecord(underwater, 500);
    expect(result?.guard.checkedCount).toBeGreaterThan(0);
  });
});

describe('多条记录共享预算', () => {
  it('宽裕时两条都完整纳入', () => {
    const result = adaptEntries([underwater, sorting], 100_000);

    expect(result.includedIds).toHaveLength(2);
    expect(result.droppedIds).toEqual([]);
    expect(result.length).toBeLessThanOrEqual(100_000);
  });

  it('紧预算下不超长', () => {
    for (const limit of [150, 200, 300, 500]) {
      const result = adaptEntries([underwater, sorting], limit);
      expect(result.length, `限制 ${limit} 时超长`).toBeLessThanOrEqual(limit);
    }
  });

  it('新的经历排在前面', () => {
    // sorting 结束于 2026-08，比 underwater 的 2026-06 更近
    const result = adaptEntries([underwater, sorting], 400);

    expect(result.includedIds).toEqual(['exp-sorting', 'exp-underwater']);
    expect(result.text.indexOf('双臂分拣')).toBeLessThan(result.text.indexOf('水下双臂'));
  });

  it('预算极紧时整条舍弃并如实报告，而不是每条塞半句', () => {
    // 30 字：均分后每条只有 15 字，两条记录的名称都比这长；
    // 第一条放不下被整条舍弃，额度回收后第二条得以完整纳入
    const result = adaptEntries([underwater, sorting], 30);

    expect(result.droppedIds.length).toBeGreaterThan(0);
    expect(result.includedIds.length + result.droppedIds.length).toBe(2);
    // 纳入的那条是完整的名称，不是半截
    expect(result.text).not.toMatch(/[，、]$/);
  });

  it('全部放不下时如实报告 0 纳入，不输出误导性片段', () => {
    const result = adaptEntries([underwater, sorting], 8);

    expect(result.includedIds).toEqual([]);
    expect(result.droppedIds).toHaveLength(2);
    expect(result.text).toBe('');
  });

  it('多条合并后依然通过事实校验', () => {
    for (const limit of [150, 300, 1000]) {
      expect(adaptEntries([underwater, sorting], limit).guard.ok).toBe(true);
    }
  });

  it('空输入返回空结果而不是崩溃', () => {
    const result = adaptEntries([], 100);
    expect(result.text).toBe('');
    expect(result.guard.ok).toBe(true);
  });
});

describe('内容侧重（避免两栏填一样的东西）', () => {
  it('brief 只要背景与职责，不含成果', () => {
    const result = adaptRecord(underwater, 100_000, { emphasis: 'brief' });

    expect(result?.text).toContain('研发适形水下作业航行器');
    expect(result?.text).not.toContain('单臂抓取成功率 90.4%');
  });

  it('achievement 只要成果，不含项目背景', () => {
    const result = adaptRecord(underwater, 100_000, { emphasis: 'achievement' });

    expect(result?.text).toContain('90.4%');
    expect(result?.text).not.toContain('实验室搭建近岸浅海模拟环境');
  });

  it('两种侧重产出的内容确实不同', () => {
    const brief = adaptRecord(underwater, 300, { emphasis: 'brief' })?.text;
    const achievement = adaptRecord(underwater, 300, { emphasis: 'achievement' })?.text;

    expect(brief).not.toBe(achievement);
  });

  it('侧重模式下没有对应内容的记录整条不纳入，不留孤零零的标题', () => {
    const noAchievements: AdaptableRecord = {
      id: 'proj-plain',
      name: '某开源项目',
      startDate: '2025-06',
      endDate: 'present',
      descriptionCanonical: '一个没有量化成果的开源项目。',
      responsibilities: [],
      achievements: [],
      canonicalFacts: [{ id: 'f0', statement: '以 MIT 协议开源', metrics: [] }],
    };

    // 放进「主要成果」栏毫无贡献 → 不纳入
    expect(adaptRecord(noAchievements, 1000, { emphasis: 'achievement' })).toBeUndefined();
    // 但「项目简介」栏它是有内容的
    expect(adaptRecord(noAchievements, 1000, { emphasis: 'brief' })?.text).toContain('开源项目');
    // full 模式下表头本身就是有效信息，照常纳入
    expect(adaptRecord(noAchievements, 1000)).toBeDefined();
  });

  it('侧重模式下的输出同样通过事实校验', () => {
    for (const emphasis of ['brief', 'achievement', 'full'] as const) {
      expect(adaptRecord(underwater, 200, { emphasis })?.guard.ok ?? true).toBe(true);
    }
  });
});

describe('成果去重按指标而非文字', () => {
  it('同一指标的两种措辞只保留一条', () => {
    const record: AdaptableRecord = {
      id: 'r',
      name: '某研究',
      startDate: '2024-09',
      endDate: '2026-06',
      descriptionCanonical: '',
      responsibilities: [],
      achievements: ['单臂抓取成功率 90.4%'],
      canonicalFacts: [
        // 与上面的 achievement 是同一件事，只是措辞不同（多了「达到」）
        { id: 'f1', statement: '单臂抓取成功率达到 90.4%', metrics: ['90.4%'] },
      ],
    };

    const text = adaptRecord(record, 1000, { emphasis: 'achievement' })?.text ?? '';
    const occurrences = text.split('90.4%').length - 1;

    expect(occurrences).toBe(1);
  });

  it('指标不同的 fact 照常补进来', () => {
    const record: AdaptableRecord = {
      id: 'r',
      name: '某研究',
      startDate: '2024-09',
      endDate: '2026-06',
      descriptionCanonical: '',
      responsibilities: [],
      achievements: ['单臂抓取成功率 90.4%'],
      canonicalFacts: [
        { id: 'f1', statement: '单臂抓取成功率达到 90.4%', metrics: ['90.4%'] },
        { id: 'f2', statement: '双臂抓取成功率达到 86.7%', metrics: ['86.7%'] },
      ],
    };

    const text = adaptRecord(record, 1000, { emphasis: 'achievement' })?.text ?? '';

    expect(text).toContain('90.4%');
    expect(text).toContain('86.7%');
    expect(text.split('90.4%').length - 1).toBe(1);
  });
});
