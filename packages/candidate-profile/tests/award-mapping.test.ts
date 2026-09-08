/**
 * Award 分类红线测试 —— PRD §76 的第二条红线：奖学金与竞赛奖项不能混。
 *
 * 用例取自真实获奖结构：3 项奖学金 + 4 项竞赛 + 1 项荣誉称号，
 * 这个组合恰好能同时暴露「合并栏」与「拆分栏」两种网站的处理差异。
 */
import { describe, expect, it } from 'vitest';
import {
  AwardSchema,
  DEFAULT_AWARD_MAPPING,
  type Award,
  type AwardCategory,
  canMapAwardTo,
  sortAwardsByWeight,
} from '../src/award.js';

const award = (
  input: Partial<Award> & Pick<Award, 'id' | 'name' | 'category' | 'level' | 'date'>,
): Award => AwardSchema.parse(input);

const nationalScholarship = award({
  id: 'aw-national-scholarship',
  name: '国家奖学金',
  category: 'scholarship',
  level: 'national',
  date: '2025-12',
});

const goertekScholarship = award({
  id: 'aw-corp-scholarship',
  name: '企业冠名奖学金',
  category: 'scholarship',
  level: 'university',
  date: '2025-11',
});

const robotCompetition = award({
  id: 'aw-robot-competition',
  name: '第十五届国际先进机器人及仿真技术大赛 一等奖',
  category: 'competition_award',
  level: 'national',
  date: '2022-11',
  rank: '一等奖',
});

const aiCompetition = award({
  id: 'aw-ai-competition',
  name: '中国研究生人工智能创新大赛全国总决赛 二等奖',
  category: 'competition_award',
  level: 'national',
  date: '2025-10',
  rank: '二等奖',
});

const honorTitle = award({
  id: 'aw-honor',
  name: '优秀研究生',
  category: 'honor',
  level: 'university',
  date: '2025-09',
});

describe('红线二：奖学金与竞赛奖项互相硬阻断', () => {
  it('奖学金不得进入竞赛获奖栏', () => {
    const result = canMapAwardTo(nationalScholarship, 'competition_award');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('禁止映射');
  });

  it('竞赛奖项不得进入奖学金栏', () => {
    expect(canMapAwardTo(robotCompetition, 'scholarship').allowed).toBe(false);
  });

  it('穷举：所有 category 的默认策略都不会让奖学金与竞赛互串', () => {
    const categories: AwardCategory[] = [
      'scholarship',
      'competition_award',
      'academic_award',
      'honor',
      'research_award',
      'sports_award',
      'other',
    ];

    for (const category of categories) {
      const policy = DEFAULT_AWARD_MAPPING[category];
      if (category !== 'scholarship') {
        expect(policy.canMapTo.includes('scholarship'), `${category} 不得进奖学金栏`).toBe(false);
      }
      if (category !== 'competition_award' && category !== 'sports_award') {
        expect(policy.canMapTo.includes('competition_award'), `${category} 不得进竞赛栏`).toBe(
          false,
        );
      }
    }
  });
});

describe('网站只有一个「荣誉奖励」栏时全部合并（PRD §13）', () => {
  it('所有类别都能进 combined_honors', () => {
    const all = [
      nationalScholarship,
      goertekScholarship,
      robotCompetition,
      aiCompetition,
      honorTitle,
    ];
    for (const item of all) {
      expect(canMapAwardTo(item, 'combined_honors').allowed, `${item.name} 应能进合并栏`).toBe(
        true,
      );
    }
  });
});

describe('网站分别要求奖学金与竞赛时正确拆开', () => {
  it('奖学金栏只收到 2 项奖学金', () => {
    const all = [
      nationalScholarship,
      goertekScholarship,
      robotCompetition,
      aiCompetition,
      honorTitle,
    ];
    const scholarships = all.filter((a) => canMapAwardTo(a, 'scholarship').allowed);

    expect(scholarships).toHaveLength(2);
    expect(scholarships.map((a) => a.id)).toEqual([
      'aw-national-scholarship',
      'aw-corp-scholarship',
    ]);
  });

  it('竞赛栏只收到 2 项竞赛', () => {
    const all = [
      nationalScholarship,
      goertekScholarship,
      robotCompetition,
      aiCompetition,
      honorTitle,
    ];
    const competitions = all.filter((a) => canMapAwardTo(a, 'competition_award').allowed);

    expect(competitions).toHaveLength(2);
    expect(competitions.map((a) => a.id)).toEqual(['aw-robot-competition', 'aw-ai-competition']);
  });

  it('荣誉称号既不进奖学金也不进竞赛', () => {
    expect(canMapAwardTo(honorTitle, 'scholarship').allowed).toBe(false);
    expect(canMapAwardTo(honorTitle, 'competition_award').allowed).toBe(false);
    expect(canMapAwardTo(honorTitle, 'honor_title').allowed).toBe(true);
  });
});

describe('sortAwardsByWeight', () => {
  it('按级别排序，同级按时间倒序', () => {
    const sorted = sortAwardsByWeight([
      goertekScholarship,
      robotCompetition,
      nationalScholarship,
      honorTitle,
    ]);

    // national 级在前：aiCompetition 未参与，此处为 robot(2022-11) 与 国奖(2025-12)
    expect(sorted[0]?.level).toBe('national');
    expect(sorted[1]?.level).toBe('national');
    expect(sorted[0]?.id).toBe('aw-national-scholarship'); // 同为 national，2025-12 更近
    expect(sorted.at(-1)?.level).toBe('university');
  });

  it('网站限制只填 3 项时能挑出最有分量的', () => {
    const top3 = sortAwardsByWeight([
      goertekScholarship,
      robotCompetition,
      nationalScholarship,
      honorTitle,
      aiCompetition,
    ]).slice(0, 3);

    expect(top3.every((a) => a.level === 'national')).toBe(true);
  });
});

describe('schema 校验', () => {
  it('冲突的 canMapTo / shouldNotMapTo 被拒绝', () => {
    expect(() =>
      AwardSchema.parse({
        ...nationalScholarship,
        canMapTo: ['scholarship'],
        shouldNotMapTo: ['scholarship'],
      }),
    ).toThrow(/冲突/);
  });

  it('可逐条覆盖默认策略', () => {
    const custom = AwardSchema.parse({ ...honorTitle, canMapTo: ['combined_honors'] });
    expect(canMapAwardTo(custom, 'honor_title').allowed).toBe(false);
    expect(canMapAwardTo(custom, 'combined_honors').allowed).toBe(true);
  });
});
