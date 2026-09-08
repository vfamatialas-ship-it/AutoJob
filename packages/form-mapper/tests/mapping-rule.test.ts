import { describe, expect, it } from 'vitest';
import { BUILTIN_GLOBAL_RULES, MappingRuleSchema, MappingRuleStore } from '../src/mapping-rule.js';

const rule = (input: Record<string, unknown>): ReturnType<typeof MappingRuleSchema.parse> =>
  MappingRuleSchema.parse(input);

describe('四级优先级：Company > ATS > Global', () => {
  const store = new MappingRuleStore([
    rule({
      id: 'g',
      scope: 'global',
      semanticType: 'SOCIAL_PRACTICE',
      allowedCandidateTypes: ['campus_activity'],
      note: '全局规则',
    }),
    rule({
      id: 'a',
      scope: 'ats',
      atsType: 'moka',
      semanticType: 'SOCIAL_PRACTICE',
      allowedCandidateTypes: ['internship'],
      note: 'ATS 规则',
    }),
    rule({
      id: 'c',
      scope: 'company',
      companyId: 'acme',
      semanticType: 'SOCIAL_PRACTICE',
      allowedCandidateTypes: ['internship', 'research_project'],
      note: '公司规则',
    }),
  ]);

  it('公司规则优先级最高', () => {
    const resolved = store.resolve('实践经历', 'SOCIAL_PRACTICE', {
      atsType: 'moka',
      companyId: 'acme',
    });
    expect(resolved.source).toBe('company');
    expect([...resolved.allowed]).toEqual(['internship', 'research_project']);
  });

  it('无公司规则时退到 ATS 规则', () => {
    const resolved = store.resolve('实践经历', 'SOCIAL_PRACTICE', {
      atsType: 'moka',
      companyId: 'other',
    });
    expect(resolved.source).toBe('ats');
    expect([...resolved.allowed]).toEqual(['internship']);
  });

  it('无公司也无 ATS 规则时退到全局规则', () => {
    const resolved = store.resolve('实践经历', 'SOCIAL_PRACTICE', { atsType: 'beisen' });
    expect(resolved.source).toBe('global');
    expect([...resolved.allowed]).toEqual(['campus_activity']);
  });

  it('完全不匹配时无规则生效', () => {
    expect(store.resolve('姓名', 'PERSON_NAME', {}).source).toBe('none');
  });
});

describe('阻断是叠加的，不因优先级被抹掉', () => {
  it('高优先级规则无法解除低优先级规则设的阻断', () => {
    const store = new MappingRuleStore([
      rule({
        id: 'g',
        scope: 'global',
        semanticType: 'WORK_EXPERIENCE',
        blockedCandidateTypes: ['research_project'],
      }),
      rule({
        id: 'c',
        scope: 'company',
        companyId: 'acme',
        semanticType: 'WORK_EXPERIENCE',
        allowedCandidateTypes: ['research_project'], // 公司规则试图放开
      }),
    ]);

    const resolved = store.resolve('工作经历', 'WORK_EXPERIENCE', { companyId: 'acme' });

    expect(resolved.source).toBe('company');
    // 即使公司规则「允许」，全局阻断依然在 blocked 里 —— 由 mapper 判定为不可填
    expect(resolved.blocked.has('research_project')).toBe(true);
  });

  it('多条规则的阻断取并集', () => {
    const store = new MappingRuleStore([
      rule({
        id: '1',
        scope: 'global',
        semanticType: 'WORK_EXPERIENCE',
        blockedCandidateTypes: ['a'],
      }),
      rule({
        id: '2',
        scope: 'ats',
        atsType: 'moka',
        semanticType: 'WORK_EXPERIENCE',
        blockedCandidateTypes: ['b'],
      }),
    ]);

    const resolved = store.resolve('工作经历', 'WORK_EXPERIENCE', { atsType: 'moka' });
    expect([...resolved.blocked].sort()).toEqual(['a', 'b']);
  });
});

describe('规则命中条件', () => {
  it('按 fieldLabel 精确命中', () => {
    const store = new MappingRuleStore([
      rule({
        id: '1',
        scope: 'global',
        fieldLabel: '实践经历',
        allowedCandidateTypes: ['internship'],
      }),
    ]);

    expect(store.resolve('实践经历', 'SOCIAL_PRACTICE', {}).source).toBe('global');
    expect(store.resolve('社会实践', 'SOCIAL_PRACTICE', {}).source).toBe('none');
  });

  it('fieldLabel 与 semanticType 同时给出时须都命中', () => {
    const store = new MappingRuleStore([
      rule({ id: '1', scope: 'global', fieldLabel: '实践经历', semanticType: 'SOCIAL_PRACTICE' }),
    ]);

    expect(store.resolve('实践经历', 'SOCIAL_PRACTICE', {}).source).toBe('global');
    expect(store.resolve('实践经历', 'INTERNSHIP', {}).source).toBe('none');
  });

  it('两个条件都不给的规则不匹配任何字段，避免误伤全场', () => {
    const store = new MappingRuleStore([rule({ id: '1', scope: 'global' })]);
    expect(store.resolve('任意字段', 'PERSON_NAME', {}).source).toBe('none');
  });
});

describe('Mapping Memory', () => {
  it('用户确认后沉淀成 ATS 级规则，同 ATS 的其他公司可复用', () => {
    const store = new MappingRuleStore();

    store.remember({
      scope: 'ats',
      atsType: 'moka',
      fieldLabel: '实践经历',
      semanticType: 'SOCIAL_PRACTICE',
      allowedCandidateTypes: ['internship', 'research_project'],
    });

    // 公司 A 确认的，公司 B 直接复用
    const forCompanyB = store.resolve('实践经历', 'SOCIAL_PRACTICE', {
      atsType: 'moka',
      companyId: 'company-b',
    });

    expect(forCompanyB.source).toBe('ats');
    expect([...forCompanyB.allowed].sort()).toEqual(['internship', 'research_project']);
  });

  it('确认为公司级时不会外溢到其他公司', () => {
    const store = new MappingRuleStore();
    store.remember({
      scope: 'company',
      companyId: 'acme',
      fieldLabel: '特殊栏目',
      semanticType: 'OTHER',
      allowedCandidateTypes: ['internship'],
    });

    expect(store.resolve('特殊栏目', 'OTHER', { companyId: 'acme' }).source).toBe('company');
    expect(store.resolve('特殊栏目', 'OTHER', { companyId: 'other' }).source).toBe('none');
  });

  it('记录来源为 user，便于与内置规则区分', () => {
    const store = new MappingRuleStore();
    const created = store.remember({
      scope: 'ats',
      atsType: 'moka',
      fieldLabel: 'x',
      semanticType: 'OTHER',
      allowedCandidateTypes: [],
    });
    expect(created.origin).toBe('user');
  });
});

describe('内置全局规则加固红线', () => {
  const store = new MappingRuleStore(BUILTIN_GLOBAL_RULES);

  it('工作经历栏阻断科研与实习', () => {
    const blocked = store.resolve('工作经历', 'WORK_EXPERIENCE', {}).blocked;
    expect(blocked.has('research_project')).toBe(true);
    expect(blocked.has('research')).toBe(true);
    expect(blocked.has('internship')).toBe(true);
  });

  it('实习栏阻断科研与正式工作', () => {
    const blocked = store.resolve('实习经历', 'INTERNSHIP', {}).blocked;
    expect(blocked.has('research_project')).toBe(true);
    expect(blocked.has('full_time')).toBe(true);
  });

  it('奖学金栏阻断竞赛，竞赛栏阻断奖学金', () => {
    expect(store.resolve('奖学金', 'SCHOLARSHIP', {}).blocked.has('competition_award')).toBe(true);
    expect(store.resolve('竞赛获奖', 'COMPETITION_AWARD', {}).blocked.has('scholarship')).toBe(
      true,
    );
  });

  it('内置规则来源标记为 builtin', () => {
    expect(BUILTIN_GLOBAL_RULES.every((item) => item.origin === 'builtin')).toBe(true);
  });
});
