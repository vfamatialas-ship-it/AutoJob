/**
 * Mapping Engine 验收 —— PRD §54：「至少构建 20 种不同 Mock Schema，同一 Candidate Profile 自动适配。」
 *
 * 这里的 20+ 种 Schema 是**按字段组合派生**的，而不是手写 20 个页面：
 * 真正要验证的是「不同栏目组合下，同一份 Profile 都能正确落位且红线不破」，
 * 页面长什么样在 M2/M3 已经验过了。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { importProfile, type CandidateProfile } from '@autojob/candidate-profile';
import type { FormField, SemanticType } from '@autojob/form-schema';
import { BUILTIN_GLOBAL_RULES, MappingRuleStore } from '../src/mapping-rule.js';
import { allWarnings, mapField, mapForm, summarizePlan } from '../src/mapper.js';
import { hasBlockers } from '../src/warnings.js';

const profile: CandidateProfile = importProfile(
  readFileSync(
    fileURLToPath(
      new URL('../../candidate-profile/tests/fixtures/profile.sample.json', import.meta.url),
    ),
    'utf-8',
  ),
);

let counter = 0;
function field(
  label: string,
  semanticType: SemanticType,
  overrides: Partial<FormField> = {},
): FormField {
  counter += 1;
  return {
    id: `#f${counter}`,
    selector: `#f${counter}`,
    label,
    labelSource: 'label_for',
    kind: 'textarea',
    semanticType,
    confidence: 0.95,
    reason: 'test',
    required: false,
    disabled: false,
    visible: true,
    section: '',
    options: [],
    repeatable: false,
    ...overrides,
  };
}

const rules = new MappingRuleStore(BUILTIN_GLOBAL_RULES);
const context = { profile, rules, today: '2026-09-09', companyId: 'acme', atsType: 'moka' };

// ————————————————————————————————————————————————
// 红线：跨所有 Schema 变体穿透测试
// ————————————————————————————————————————————————

/** 经历类栏目的所有可能组合（2^4 = 16 种），外加奖项组合，凑出 20+ 种 Schema */
const EXPERIENCE_COLUMNS: ReadonlyArray<readonly [string, SemanticType]> = [
  ['工作经历', 'WORK_EXPERIENCE'],
  ['实习经历', 'INTERNSHIP'],
  ['科研经历', 'RESEARCH_EXPERIENCE'],
  ['项目经历', 'PROJECT_EXPERIENCE'],
];

const AWARD_COLUMN_SETS: ReadonlyArray<{
  name: string;
  columns: ReadonlyArray<readonly [string, SemanticType]>;
}> = [
  { name: '合并栏', columns: [['荣誉奖励', 'AWARD']] },
  {
    name: '奖学金+竞赛分栏',
    columns: [
      ['奖学金', 'SCHOLARSHIP'],
      ['竞赛获奖', 'COMPETITION_AWARD'],
    ],
  },
  {
    name: '三栏全分',
    columns: [
      ['奖学金', 'SCHOLARSHIP'],
      ['竞赛获奖', 'COMPETITION_AWARD'],
      ['荣誉称号', 'HONOR_TITLE'],
    ],
  },
  { name: '无奖项栏', columns: [] },
];

/** 生成全部 Schema 变体：16 种经历组合 × 4 种奖项组合中取样，共 20 种 */
function buildSchemaVariants(): Array<{ name: string; fields: FormField[] }> {
  const variants: Array<{ name: string; fields: FormField[] }> = [];

  for (let mask = 0; mask < 16; mask += 1) {
    const columns = EXPERIENCE_COLUMNS.filter((_, index) => (mask & (1 << index)) !== 0);
    const awardSet = AWARD_COLUMN_SETS[mask % AWARD_COLUMN_SETS.length];
    if (!awardSet) continue;

    variants.push({
      name: `经历[${columns.map((c) => c[0]).join(',') || '无'}] + 奖项[${awardSet.name}]`,
      fields: [
        ...columns.map(([label, type]) => field(label, type)),
        ...awardSet.columns.map(([label, type]) => field(label, type)),
      ],
    });
  }

  // 再补 4 种带附加字段的变体，凑满 20 种
  variants.push({
    name: '仅基本信息',
    fields: [
      field('姓名', 'PERSON_NAME', { kind: 'text' }),
      field('手机号', 'PHONE', { kind: 'tel' }),
      field('邮箱', 'EMAIL', { kind: 'email' }),
    ],
  });
  variants.push({
    name: '教育 + 项目',
    fields: [
      field('毕业院校', 'UNIVERSITY', { kind: 'text' }),
      field('专业', 'MAJOR', { kind: 'text' }),
      field('项目经历', 'PROJECT_EXPERIENCE'),
    ],
  });
  variants.push({
    name: '工作经历 + 合并奖项 + 个人主页',
    fields: [
      field('工作经历', 'WORK_EXPERIENCE'),
      field('荣誉奖励', 'AWARD'),
      field('个人主页', 'PERSONAL_HOMEPAGE', { kind: 'url' }),
    ],
  });
  variants.push({
    name: '全量栏目',
    fields: [
      ...EXPERIENCE_COLUMNS.map(([label, type]) => field(label, type)),
      field('奖学金', 'SCHOLARSHIP'),
      field('竞赛获奖', 'COMPETITION_AWARD'),
      field('荣誉称号', 'HONOR_TITLE'),
      field('GitHub', 'GITHUB', { kind: 'url' }),
    ],
  });

  return variants;
}

const SCHEMA_VARIANTS = buildSchemaVariants();

describe(`跨 ${SCHEMA_VARIANTS.length} 种 Schema 变体的红线穿透测试`, () => {
  it('确实构建了 20 种以上变体（PRD §54）', () => {
    expect(SCHEMA_VARIANTS.length).toBeGreaterThanOrEqual(20);
  });

  it('红线一：任何 Schema 下，科研课题都不出现在工作经历或实习栏', () => {
    const researchIds = profile.experiences
      .filter((experience) => ['research', 'research_project'].includes(experience.experienceType))
      .map((experience) => experience.id);
    expect(researchIds.length).toBeGreaterThan(0);

    for (const variant of SCHEMA_VARIANTS) {
      const plan = mapForm(variant.fields, context);

      for (const mapping of plan.mappings) {
        if (!['WORK_EXPERIENCE', 'INTERNSHIP'].includes(mapping.field.semanticType)) continue;

        for (const id of researchIds) {
          expect(
            mapping.sourceRecordIds,
            `变体「${variant.name}」把科研 ${id} 填进了 ${mapping.field.label}`,
          ).not.toContain(id);
        }
      }
    }
  });

  it('红线二：任何 Schema 下，奖学金不进竞赛栏、竞赛不进奖学金栏', () => {
    const scholarshipIds = profile.awards
      .filter((a) => a.category === 'scholarship')
      .map((a) => a.id);
    const competitionIds = profile.awards
      .filter((a) => a.category === 'competition_award')
      .map((a) => a.id);

    for (const variant of SCHEMA_VARIANTS) {
      const plan = mapForm(variant.fields, context);

      for (const mapping of plan.mappings) {
        if (mapping.field.semanticType === 'SCHOLARSHIP') {
          for (const id of competitionIds) {
            expect(
              mapping.sourceRecordIds,
              `变体「${variant.name}」竞赛进了奖学金栏`,
            ).not.toContain(id);
          }
        }
        if (mapping.field.semanticType === 'COMPETITION_AWARD') {
          for (const id of scholarshipIds) {
            expect(
              mapping.sourceRecordIds,
              `变体「${variant.name}」奖学金进了竞赛栏`,
            ).not.toContain(id);
          }
        }
      }
    }
  });

  it('所有变体都不会抛异常，且每个字段都有明确结论', () => {
    for (const variant of SCHEMA_VARIANTS) {
      const plan = mapForm(variant.fields, context);
      const stats = summarizePlan(plan);
      expect(stats.total).toBe(variant.fields.length);
      expect(stats.filled + stats.skipped + stats.askUser).toBe(stats.total);
    }
  });
});

// ————————————————————————————————————————————————
// 降级与合并的 warning
// ————————————————————————————————————————————————

describe('降级检测（PRD §35）', () => {
  it('无科研栏但有项目栏时产生降级 warning，并点名具体经历', () => {
    const plan = mapForm(
      [field('工作经历', 'WORK_EXPERIENCE'), field('项目经历', 'PROJECT_EXPERIENCE')],
      context,
    );

    const downgrade = plan.formWarnings.find((w) => w.code === 'DOWNGRADED_TO_BROADER_FIELD');
    expect(downgrade).toBeDefined();
    expect(downgrade?.message).toContain('没有独立的科研经历栏目');
    expect(downgrade?.message).toContain('水下双臂');
    expect(downgrade?.recordIds).toContain('exp-underwater-vla');
  });

  it('有科研栏时不产生降级 warning', () => {
    const plan = mapForm(
      [field('科研经历', 'RESEARCH_EXPERIENCE'), field('项目经历', 'PROJECT_EXPERIENCE')],
      context,
    );
    expect(plan.formWarnings.some((w) => w.code === 'DOWNGRADED_TO_BROADER_FIELD')).toBe(false);
  });

  it('既无科研栏也无项目栏时，明确告知科研经历无处安放', () => {
    const plan = mapForm([field('工作经历', 'WORK_EXPERIENCE')], context);
    const orphan = plan.formWarnings.find((w) => w.message.includes('无处填写'));
    expect(orphan).toBeDefined();
  });
});

describe('合并栏 warning', () => {
  it('只有一个荣誉奖励栏时提示已合并多个类别', () => {
    const plan = mapForm([field('荣誉奖励', 'AWARD')], context);
    const merged = allWarnings(plan).filter((w) => w.code === 'MERGED_INTO_COMBINED_FIELD');

    expect(merged.length).toBeGreaterThan(0);
    expect(merged.some((w) => w.message.includes('合并'))).toBe(true);
  });

  it('奖项分栏时不提示合并', () => {
    const plan = mapForm(
      [field('奖学金', 'SCHOLARSHIP'), field('竞赛获奖', 'COMPETITION_AWARD')],
      context,
    );
    expect(allWarnings(plan).some((w) => w.code === 'MERGED_INTO_COMBINED_FIELD')).toBe(false);
  });
});

// ————————————————————————————————————————————————
// 字段级映射
// ————————————————————————————————————————————————

describe('经历映射', () => {
  it('科研栏收到课题，且不含实习', () => {
    const mapping = mapField(field('科研经历', 'RESEARCH_EXPERIENCE'), context);
    expect(mapping.status).toBe('filled');
    expect(mapping.sourceRecordIds).toContain('exp-underwater-vla');
    expect(mapping.sourceRecordIds).not.toContain('exp-internship-sorting');
    expect(mapping.value).toContain('水下双臂');
  });

  it('实习栏收到实习，且不含课题', () => {
    const mapping = mapField(field('实习经历', 'INTERNSHIP'), context);
    expect(mapping.sourceRecordIds).toEqual(['exp-internship-sorting']);
  });

  it('工作经历栏无记录可填，给出 skipped 而非硬塞', () => {
    const mapping = mapField(field('工作经历', 'WORK_EXPERIENCE'), context);
    expect(mapping.status).toBe('skipped');
    expect(mapping.warnings.some((w) => w.code === 'NO_MATCHING_DATA')).toBe(true);
  });

  it('必填的工作经历栏无数据时升级为阻断级 warning', () => {
    const mapping = mapField(field('工作经历', 'WORK_EXPERIENCE', { required: true }), context);
    expect(mapping.warnings.some((w) => w.code === 'REQUIRED_FIELD_EMPTY')).toBe(true);
    expect(hasBlockers(mapping.warnings)).toBe(true);
  });

  it('项目经历栏同时收入 Experience 与 Project 两个集合', () => {
    const mapping = mapField(field('项目经历', 'PROJECT_EXPERIENCE'), context);
    expect(mapping.sourceRecordIds).toContain('exp-underwater-vla'); // 降级进来的课题
    expect(mapping.sourceRecordIds).toContain('proj-open-kaka'); // Project 集合
  });

  it('被排除的记录带有可读原因，供 Diff 展示', () => {
    const mapping = mapField(field('工作经历', 'WORK_EXPERIENCE'), context);
    expect(mapping.excluded.length).toBeGreaterThan(0);
    expect(mapping.excluded[0]?.reason).toBeTruthy();
  });
});

describe('奖项映射', () => {
  it('奖学金栏只收 3 项奖学金', () => {
    const mapping = mapField(field('奖学金', 'SCHOLARSHIP'), context);
    expect(mapping.sourceRecordIds).toHaveLength(3);
    expect(mapping.value).toContain('国家奖学金');
    expect(mapping.value).not.toContain('机器人及仿真');
  });

  it('竞赛栏只收 4 项竞赛', () => {
    const mapping = mapField(field('竞赛获奖', 'COMPETITION_AWARD'), context);
    expect(mapping.sourceRecordIds).toHaveLength(4);
    expect(mapping.value).not.toContain('国家奖学金');
  });

  it('合并栏收全部 8 项，且按含金量排序', () => {
    const mapping = mapField(field('荣誉奖励', 'AWARD'), context);
    expect(mapping.sourceRecordIds).toHaveLength(8);
    // 国家级排在前面
    expect(mapping.value.split('\n')[0]).toContain('2025-12');
  });
});

describe('标量字段映射', () => {
  it('姓名 / 手机 / 邮箱直接取自 Profile', () => {
    expect(mapField(field('姓名', 'PERSON_NAME', { kind: 'text' }), context).value).toBe(
      '示例候选人',
    );
    expect(mapField(field('手机号', 'PHONE', { kind: 'tel' }), context).value).toBe('13800000000');
  });

  it('学校 / 专业取最高学历，不会误取本科', () => {
    expect(mapField(field('毕业院校', 'UNIVERSITY', { kind: 'text' }), context).value).toBe(
      '西安交通大学',
    );
    expect(mapField(field('专业', 'MAJOR', { kind: 'text' }), context).value).toBe('机械工程');
  });

  it('学历下拉能对上网站选项', () => {
    const mapping = mapField(
      field('学历', 'DEGREE', { kind: 'select', options: ['请选择', '本科', '硕士', '博士'] }),
      context,
    );
    expect(mapping.status).toBe('filled');
    expect(mapping.value).toBe('硕士');
  });

  it('取值对不上网站选项时转人工，不硬填', () => {
    const mapping = mapField(
      field('学历', 'DEGREE', { kind: 'select', options: ['大专', '中专'] }),
      context,
    );
    expect(mapping.status).toBe('ask_user');
    expect(mapping.warnings[0]?.message).toContain('不在网站选项');
  });

  it('个人主页取 GitHub（Profile 中标记为 primary）', () => {
    const mapping = mapField(field('个人主页', 'PERSONAL_HOMEPAGE', { kind: 'url' }), context);
    expect(mapping.value).toContain('github.com');
  });

  it('Profile 中没有的字段留空并说明，不编造', () => {
    const mapping = mapField(field('微信号', 'WECHAT', { kind: 'text' }), context);
    expect(mapping.status).toBe('skipped');
    expect(mapping.value).toBe('');
  });
});

describe('附件映射', () => {
  it('简历上传选中中文简历', () => {
    const mapping = mapField(
      field('个人简历', 'RESUME_ATTACHMENT', { kind: 'file', accept: '.pdf' }),
      context,
    );
    expect(mapping.status).toBe('filled');
    expect(mapping.sourceRecordIds).toEqual(['asset-resume-robotics-zh']);
  });

  it('网站只收 PDF 而证书是 jpg 时，拒绝上传并说明原因', () => {
    const mapping = mapField(
      field('获奖证书', 'CERTIFICATE_ATTACHMENT', { kind: 'file', accept: '.pdf' }),
      context,
    );
    expect(mapping.status).toBe('ask_user');
    expect(hasBlockers(mapping.warnings)).toBe(true);
  });

  it('附件类型未识别时不随意上传文件', () => {
    const mapping = mapField(field('其他材料', 'OTHER', { kind: 'file' }), context);
    expect(mapping.status).toBe('ask_user');
    expect(mapping.reason).toContain('不能随意上传');
  });
});

describe('内推码与问答', () => {
  it('没有该公司内推码时留空并提示', () => {
    const mapping = mapField(field('内推码', 'REFERRAL_CODE', { kind: 'text' }), context);
    expect(mapping.status).toBe('skipped');
    expect(mapping.warnings.some((w) => w.code === 'NO_REFERRAL_CODE')).toBe(true);
  });

  it('问答库命中变体问法', () => {
    const mapping = mapField(
      field('是否服从职位调剂？', 'QUESTION', { kind: 'radio', options: ['是', '否'] }),
      context,
    );
    expect(mapping.status).toBe('filled');
    expect(mapping.value).toBe('否');
    expect(mapping.reason).toContain('问答库命中');
  });

  it('问答库无匹配时转人工，不代答', () => {
    const mapping = mapField(field('你最想解决的技术问题是什么？', 'QUESTION'), context);
    expect(mapping.status).toBe('ask_user');
    expect(mapping.warnings.some((w) => w.code === 'UNANSWERED_QUESTION')).toBe(true);
  });
});

describe('置信度闸门', () => {
  it('低置信度字段一律转人工，不进入取值流程', () => {
    const mapping = mapField(field('实践经历', 'SOCIAL_PRACTICE', { confidence: 0.55 }), context);
    expect(mapping.status).toBe('ask_user');
    expect(mapping.warnings[0]?.code).toBe('LOW_CONFIDENCE');
    expect(mapping.sourceRecordIds).toHaveLength(0);
  });

  it('用户通过 Mapping Memory 确认后，同 ATS 复用（但仍需字段置信度达标）', () => {
    const store = new MappingRuleStore(BUILTIN_GLOBAL_RULES);
    store.remember({
      scope: 'ats',
      atsType: 'moka',
      fieldLabel: '实践经历',
      semanticType: 'SOCIAL_PRACTICE',
      allowedCandidateTypes: ['internship', 'research_project'],
    });

    const resolved = store.resolve('实践经历', 'SOCIAL_PRACTICE', {
      atsType: 'moka',
      companyId: 'another-company',
    });
    expect(resolved.source).toBe('ats');
  });
});

/**
 * 字数限制的处理在 M6 变了：
 * M4 时超限一律转人工；M6 接入 ContentAdapter 后会先尝试抽取式压缩，
 * 只有压到最简形态仍放不下时才转人工。
 */
describe('字数限制与内容自适应', () => {
  it('内容超限时自动压缩，不再一律转人工', () => {
    const mapping = mapField(field('项目简介', 'PROJECT_EXPERIENCE', { maxLength: 200 }), context);

    expect(mapping.status).toBe('filled');
    expect(mapping.value.length).toBeLessThanOrEqual(200);
    expect(mapping.value.length).toBeGreaterThan(0);
  });

  it('压缩后标注 CONTENT_COMPRESSED（warn 级），不是阻断级', () => {
    const mapping = mapField(field('项目简介', 'PROJECT_EXPERIENCE', { maxLength: 200 }), context);

    const compressed = mapping.warnings.find((w) => w.code === 'CONTENT_COMPRESSED');
    expect(compressed).toBeDefined();
    // 压缩成功意味着内容填得进去，不该阻断提交
    expect(compressed?.severity).toBe('warn');
    expect(mapping.warnings.some((w) => w.code === 'CONTENT_TOO_LONG')).toBe(false);
  });

  it('reason 里说明压缩前后的字数，便于核对', () => {
    const mapping = mapField(field('项目简介', 'PROJECT_EXPERIENCE', { maxLength: 200 }), context);
    expect(mapping.reason).toMatch(/压缩至 \d+ 字/);
  });

  it('多种限制下都不超长', () => {
    for (const limit of [100, 150, 200, 300, 500, 1000]) {
      const mapping = mapField(
        field('项目简介', 'PROJECT_EXPERIENCE', { maxLength: limit }),
        context,
      );
      if (mapping.status === 'filled') {
        expect(mapping.value.length, `限制 ${limit} 时超长`).toBeLessThanOrEqual(limit);
      }
    }
  });

  it('绝不截断句子 —— 压缩结果不以逗号顿号结尾', () => {
    const mapping = mapField(field('项目简介', 'PROJECT_EXPERIENCE', { maxLength: 200 }), context);
    expect(mapping.value).not.toMatch(/[，、]$/);
  });

  it('限制极紧到放不下任何一条记录时，仍然转人工而非输出误导性片段', () => {
    const mapping = mapField(field('项目简介', 'PROJECT_EXPERIENCE', { maxLength: 6 }), context);

    expect(mapping.status).toBe('ask_user');
    expect(mapping.value).toBe('');
    expect(mapping.warnings.some((w) => w.code === 'CONTENT_TOO_LONG')).toBe(true);
  });

  it('装不下全部记录时明确告知省略了几条', () => {
    // 40 字只够放下一条记录的名称，另一条必然被整条舍弃
    const mapping = mapField(field('项目简介', 'PROJECT_EXPERIENCE', { maxLength: 40 }), context);

    expect(mapping.status).toBe('filled');
    expect(mapping.warnings.some((w) => w.code === 'ITEMS_TRUNCATED')).toBe(true);
    expect(mapping.warnings.find((w) => w.code === 'ITEMS_TRUNCATED')?.message).toMatch(
      /已省略 \d+ 条/,
    );
  });

  it('内容未超限时原样填写，不做任何压缩', () => {
    const mapping = mapField(
      field('项目经历', 'PROJECT_EXPERIENCE', { maxLength: 99999 }),
      context,
    );

    expect(mapping.status).toBe('filled');
    expect(mapping.warnings.some((w) => w.code === 'CONTENT_TOO_LONG')).toBe(false);
  });
});
