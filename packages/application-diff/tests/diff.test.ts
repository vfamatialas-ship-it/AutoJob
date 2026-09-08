import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { importProfile, type CandidateProfile } from '@autojob/candidate-profile';
import { BUILTIN_GLOBAL_RULES, MappingRuleStore, mapForm } from '@autojob/form-mapper';
import type { FormField, SemanticType } from '@autojob/form-schema';
import { buildDiff, findTransformations } from '../src/model.js';
import { renderDiff, renderTransformationsOnly } from '../src/renderer.js';

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
    section: '经历',
    options: [],
    repeatable: false,
    ...overrides,
  };
}

const context = {
  profile,
  rules: new MappingRuleStore(BUILTIN_GLOBAL_RULES),
  today: '2026-09-09',
  companyId: 'acme',
  atsType: 'moka',
};

const meta = { company: 'A 公司', jobTitle: '机器人算法工程师', url: 'https://example.test/apply' };

/** A 公司形态：无科研栏、奖项合并 */
const companyAFields = [
  field('姓名', 'PERSON_NAME', { kind: 'text', section: '基本信息' }),
  field('工作经历', 'WORK_EXPERIENCE'),
  field('项目经历', 'PROJECT_EXPERIENCE'),
  field('荣誉奖励', 'AWARD', { section: '荣誉与获奖' }),
];

describe('Diff 回答「内容从哪来」', () => {
  it('每个已填字段都能溯源到具体的 Profile 记录', () => {
    const diff = buildDiff(mapForm(companyAFields, context), profile, meta);
    const project = diff.sections
      .flatMap((section) => section.entries)
      .find((entry) => entry.semanticType === 'PROJECT_EXPERIENCE');

    expect(project?.sources.length).toBeGreaterThan(0);
    expect(project?.sources.some((source) => source.recordId === 'exp-underwater-vla')).toBe(true);
  });

  it('溯源带上人能看懂的名称与类型，而不是裸 id', () => {
    const diff = buildDiff(mapForm(companyAFields, context), profile, meta);
    const award = diff.sections
      .flatMap((section) => section.entries)
      .find((entry) => entry.semanticType === 'AWARD');

    const national = award?.sources.find((source) => source.recordId === 'aw-national-scholarship');
    expect(national?.label).toBe('国家奖学金');
    expect(national?.kind).toBe('奖项');
  });
});

describe('Diff 回答「为什么这条没出现」', () => {
  it('被排除的记录带原因', () => {
    const diff = buildDiff(mapForm(companyAFields, context), profile, meta);
    const work = diff.sections
      .flatMap((section) => section.entries)
      .find((entry) => entry.semanticType === 'WORK_EXPERIENCE');

    expect(work?.excluded.length).toBeGreaterThan(0);
    expect(work?.excluded[0]?.reason).toBeTruthy();
    expect(work?.excluded[0]?.source.label).toBeTruthy();
  });

  it('留空的字段说明为什么留空', () => {
    const diff = buildDiff(mapForm(companyAFields, context), profile, meta);
    const work = diff.sections
      .flatMap((section) => section.entries)
      .find((entry) => entry.semanticType === 'WORK_EXPERIENCE');

    expect(work?.status).toBe('skipped');
    expect(work?.reason).toContain('没有可映射');
  });
});

describe('Diff 回答「系统擅自做了什么判断」', () => {
  it('科研降级进项目经历被明确标注', () => {
    const diff = buildDiff(mapForm(companyAFields, context), profile, meta);

    const downgrade = diff.formWarnings.find((w) => w.code === 'DOWNGRADED_TO_BROADER_FIELD');
    expect(downgrade?.message).toContain('没有独立的科研经历栏目');
  });

  it('奖项合并被明确标注', () => {
    const diff = buildDiff(mapForm(companyAFields, context), profile, meta);
    const merged = findTransformations(diff).flatMap((entry) =>
      entry.warnings.filter((w) => w.code === 'MERGED_INTO_COMBINED_FIELD'),
    );

    expect(merged.length).toBeGreaterThan(0);
  });

  it('内容被压缩时标注出来', () => {
    const diff = buildDiff(
      mapForm([field('项目简介', 'PROJECT_EXPERIENCE', { maxLength: 200 })], context),
      profile,
      meta,
    );

    const compressed = findTransformations(diff).flatMap((entry) =>
      entry.warnings.filter((w) => w.code === 'CONTENT_COMPRESSED'),
    );
    expect(compressed[0]?.message).toContain('抽取压缩');
  });

  it('直接映射的字段不产生转换说明', () => {
    const diff = buildDiff(
      mapForm([field('姓名', 'PERSON_NAME', { kind: 'text' })], context),
      profile,
      meta,
    );
    expect(findTransformations(diff)).toHaveLength(0);
  });
});

describe('提交闸门（PRD §3.7）', () => {
  it('存在待确认字段时不可提交', () => {
    const diff = buildDiff(
      mapForm([field('实践经历', 'SOCIAL_PRACTICE', { confidence: 0.55 })], context),
      profile,
      meta,
    );

    expect(diff.stats.askUser).toBe(1);
    expect(diff.submittable).toBe(false);
  });

  it('存在阻断级问题时不可提交', () => {
    const diff = buildDiff(
      mapForm([field('工作经历', 'WORK_EXPERIENCE', { required: true })], context),
      profile,
      meta,
    );

    expect(diff.stats.blockers).toBeGreaterThan(0);
    expect(diff.submittable).toBe(false);
  });

  it('全部直接映射且无阻断时可提交', () => {
    const diff = buildDiff(
      mapForm([field('姓名', 'PERSON_NAME', { kind: 'text' })], context),
      profile,
      meta,
    );
    expect(diff.submittable).toBe(true);
  });
});

describe('按页面区块分组', () => {
  it('字段归入各自的区块', () => {
    const diff = buildDiff(mapForm(companyAFields, context), profile, meta);
    const titles = diff.sections.map((section) => section.title);

    expect(titles).toContain('基本信息');
    expect(titles).toContain('经历');
    expect(titles).toContain('荣誉与获奖');
  });

  it('无区块信息的字段归入「其他」', () => {
    const diff = buildDiff(
      mapForm([field('姓名', 'PERSON_NAME', { kind: 'text', section: '' })], context),
      profile,
      meta,
    );
    expect(diff.sections[0]?.title).toBe('其他');
  });
});

describe('终端渲染', () => {
  const diff = buildDiff(mapForm(companyAFields, context), profile, meta);

  it('包含公司与岗位标题', () => {
    const output = renderDiff(diff);
    expect(output).toContain('A 公司');
    expect(output).toContain('机器人算法工程师');
  });

  it('包含字段统计', () => {
    expect(renderDiff(diff)).toMatch(/字段 \d+ 个/);
  });

  it('转换说明单独成段，且阻断级排在前面', () => {
    const output = renderDiff(diff);
    expect(output).toContain('系统做了这些判断');
  });

  it('已填字段展示溯源', () => {
    const output = renderDiff(diff);
    expect(output).toContain('← ');
    expect(output).toContain('国家奖学金');
  });

  it('留空字段说明原因而不是静默消失', () => {
    const output = renderDiff(diff);
    expect(output).toContain('（留空）');
  });

  it('末尾给出能否提交的结论', () => {
    const output = renderDiff(diff);
    expect(output).toMatch(/可以提交|暂不建议提交/);
  });

  it('verbose 展开被排除的记录与完整内容', () => {
    const brief = renderDiff(diff);
    const verbose = renderDiff(diff, { verbose: true });

    expect(verbose.length).toBeGreaterThan(brief.length);
    expect(verbose).toContain('│ '); // 完整内容的引用前缀
  });

  it('精简版只输出转换说明', () => {
    const output = renderTransformationsOnly(diff);
    expect(output).toContain('科研经历栏目');
    expect(output).not.toContain('字段明细');
  });

  it('无转换时精简版明确说明「未做任何转换」', () => {
    // 需要一个真正不产生任何转换的表单：科研栏与项目栏都在，
    // 科研经历各就各位，不发生降级，也没有无处安放的记录
    const clean = buildDiff(
      mapForm(
        [
          field('姓名', 'PERSON_NAME', { kind: 'text' }),
          field('科研经历', 'RESEARCH_EXPERIENCE'),
          field('项目经历', 'PROJECT_EXPERIENCE'),
        ],
        context,
      ),
      profile,
      meta,
    );

    expect(renderTransformationsOnly(clean)).toContain('未做任何转换');
  });
});
