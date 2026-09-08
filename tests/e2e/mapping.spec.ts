/**
 * M4 端到端验收 —— 真实浏览器上的完整链路：
 *
 *   页面 DOM → 提取 → 分类 → 映射 → FormPlan
 *
 * 这是第一次把 M1（Profile）、M2（Mock 站）、M3（分类）、M4（映射）串起来跑。
 * 重点验证 M2 就留好的 `expectedWarnings` —— 那时写下的期望，现在该兑现了。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { importProfile } from '../../packages/candidate-profile/src/io.js';
import { classifyForm } from '../../packages/form-schema/src/classifier.js';
import { EXTRACT_FIELDS_SCRIPT } from '../../packages/form-schema/src/raw-field.js';
import {
  BUILTIN_GLOBAL_RULES,
  MappingRuleStore,
} from '../../packages/form-mapper/src/mapping-rule.js';
import { allWarnings, mapForm, summarizePlan } from '../../packages/form-mapper/src/mapper.js';
import { MOCK_SITES } from '../fixtures/sites/manifest.js';
import type { CandidateProfile } from '../../packages/candidate-profile/src/profile.js';
import type { FormPlan } from '../../packages/form-mapper/src/mapper.js';
import type { Page } from '@playwright/test';

const profile: CandidateProfile = importProfile(
  readFileSync(
    fileURLToPath(
      new URL(
        '../../packages/candidate-profile/tests/fixtures/profile.sample.json',
        import.meta.url,
      ),
    ),
    'utf-8',
  ),
);

async function planFor(page: Page, path: string): Promise<FormPlan> {
  await page.goto(path);
  const rawFields = await page.evaluate(EXTRACT_FIELDS_SCRIPT);
  const { fields } = classifyForm(path, rawFields);

  return mapForm(fields, {
    profile,
    rules: new MappingRuleStore(BUILTIN_GLOBAL_RULES),
    today: '2026-09-09',
    companyId: 'mock-company',
    atsType: 'mock-ats',
  });
}

const mappingFor = (plan: FormPlan, selector: string) =>
  plan.mappings.find((mapping) => mapping.field.selector === selector);

test.describe('A 公司 · 无科研栏的降级处理', () => {
  test('产生 M2 就写好的 expectedWarnings', async ({ page }) => {
    const site = MOCK_SITES.find((item) => item.id === 'mock_company_a');
    expect(site?.expectedWarnings.length).toBeGreaterThan(0);

    const plan = await planFor(page, '/mock_company_a/apply.html');
    const messages = allWarnings(plan)
      .map((item) => item.message)
      .join(' ');

    for (const keyword of site?.expectedWarnings ?? []) {
      expect(messages, `期望 warning 中包含「${keyword}」`).toContain(keyword);
    }
  });

  test('降级 warning 点名了具体的科研经历', async ({ page }) => {
    const plan = await planFor(page, '/mock_company_a/apply.html');
    const downgrade = plan.formWarnings.find((item) => item.code === 'DOWNGRADED_TO_BROADER_FIELD');

    expect(downgrade).toBeDefined();
    expect(downgrade?.message).toContain('没有独立的科研经历栏目');
    expect(downgrade?.recordIds).toContain('exp-underwater-vla');
  });

  test('红线：工作经历栏没有收到任何科研或实习记录', async ({ page }) => {
    const plan = await planFor(page, '/mock_company_a/apply.html');
    const work = mappingFor(plan, '#work-exp');

    expect(work?.sourceRecordIds).not.toContain('exp-underwater-vla');
    expect(work?.sourceRecordIds).not.toContain('exp-internship-sorting');
    expect(work?.status).toBe('skipped');
  });

  test('科研经历被填进项目经历栏', async ({ page }) => {
    const plan = await planFor(page, '/mock_company_a/apply.html');
    const project = mappingFor(plan, '#project-exp');

    expect(project?.status).toBe('filled');
    expect(project?.sourceRecordIds).toContain('exp-underwater-vla');
    expect(project?.value).toContain('水下双臂');
  });

  test('奖项合并栏收到全部 8 项并提示已合并', async ({ page }) => {
    const plan = await planFor(page, '/mock_company_a/apply.html');
    const honors = mappingFor(plan, '#honors');

    expect(honors?.sourceRecordIds).toHaveLength(8);
    expect(allWarnings(plan).some((item) => item.code === 'MERGED_INTO_COMBINED_FIELD')).toBe(true);
  });

  test('基本信息被正确填入', async ({ page }) => {
    const plan = await planFor(page, '/mock_company_a/apply.html');

    expect(mappingFor(plan, '#name')?.value).toBe('示例候选人');
    expect(mappingFor(plan, '#school')?.value).toBe('西安交通大学');
    expect(mappingFor(plan, '#edu-level')?.value).toBe('硕士');
    expect(mappingFor(plan, '#homepage')?.value).toContain('github.com');
  });
});

test.describe('B 公司 · 科研与项目分栏', () => {
  test('课题经历栏收到课题，研究项目栏收到项目', async ({ page }) => {
    const plan = await planFor(page, '/mock_company_b/apply.html');

    const topic = mappingFor(plan, '#topic-exp');
    expect(topic?.sourceRecordIds).toContain('exp-underwater-vla');

    const research = mappingFor(plan, '#research-proj');
    expect(research?.sourceRecordIds).toContain('proj-open-kaka');
  });

  test('本站有科研栏，因此不产生降级 warning', async ({ page }) => {
    const plan = await planFor(page, '/mock_company_b/apply.html');
    expect(plan.formWarnings.some((item) => item.code === 'DOWNGRADED_TO_BROADER_FIELD')).toBe(
      false,
    );
  });

  test('「实践经历」置信度不足，转人工而非猜测', async ({ page }) => {
    const plan = await planFor(page, '/mock_company_b/apply.html');
    const practice = mappingFor(plan, '#practice-exp');

    expect(practice?.status).toBe('ask_user');
    expect(practice?.sourceRecordIds).toHaveLength(0);
    expect(practice?.warnings[0]?.code).toBe('LOW_CONFIDENCE');
  });

  test('奖学金与竞赛分栏时严格拆开', async ({ page }) => {
    const plan = await planFor(page, '/mock_company_b/apply.html');

    expect(mappingFor(plan, '#scholarship')?.sourceRecordIds).toHaveLength(3);
    expect(mappingFor(plan, '#competition')?.sourceRecordIds).toHaveLength(4);

    const scholarshipValue = mappingFor(plan, '#scholarship')?.value ?? '';
    expect(scholarshipValue).toContain('国家奖学金');
    expect(scholarshipValue).not.toContain('华为杯');
  });
});

test.describe('C 公司 · 三栏分开 + 字数限制', () => {
  test('奖学金 / 竞赛 / 荣誉三栏各收各的', async ({ page }) => {
    const plan = await planFor(page, '/mock_company_c/apply.html');

    expect(mappingFor(plan, '#c-scholarship')?.sourceRecordIds).toHaveLength(3);
    expect(mappingFor(plan, '#c-competition')?.sourceRecordIds).toHaveLength(4);
    expect(mappingFor(plan, '#c-honor')?.sourceRecordIds).toEqual(['aw-honor-excellent']);
  });

  test('100 字限制的项目简介超长，转人工等待压缩版本', async ({ page }) => {
    const plan = await planFor(page, '/mock_company_c/apply.html');
    const brief = mappingFor(plan, '#c-project-brief');

    expect(brief?.status).toBe('ask_user');
    expect(brief?.warnings.some((item) => item.code === 'CONTENT_TOO_LONG')).toBe(true);
    // 绝不截断
    expect(brief?.value).toBe('');
  });

  test('内推码字段因无可用内推码而留空', async ({ page }) => {
    const plan = await planFor(page, '/mock_company_c/apply.html');
    const referral = mappingFor(plan, '#c-referral');

    expect(referral?.status).toBe('skipped');
    expect(referral?.warnings.some((item) => item.code === 'NO_REFERRAL_CODE')).toBe(true);
  });
});

test.describe('F 公司 · 附件上传', () => {
  test('简历上传选中 PDF 简历', async ({ page }) => {
    const plan = await planFor(page, '/mock_upload/apply.html');
    const resume = mappingFor(plan, '#up-resume');

    expect(resume?.status).toBe('filled');
    expect(resume?.value).toContain('.pdf');
  });

  test('成绩单缺失时明确报缺，不拿别的文件顶替', async ({ page }) => {
    const plan = await planFor(page, '/mock_upload/apply.html');
    const transcript = mappingFor(plan, '#up-transcript');

    expect(transcript?.status).toBe('ask_user');
    expect(transcript?.warnings.some((item) => item.code === 'NO_SUITABLE_ASSET')).toBe(true);
  });
});

test.describe('G 公司 · 问答', () => {
  test('调剂问题命中问答库的变体问法', async ({ page }) => {
    const plan = await planFor(page, '/mock_qa/apply.html');
    const transfer = plan.mappings.find((item) => item.field.groupName === 'q-transfer');

    expect(transfer?.status).toBe('filled');
    expect(transfer?.value).toBe('否');
  });

  test('开放题转人工，系统不代答', async ({ page }) => {
    const plan = await planFor(page, '/mock_qa/apply.html');
    const open = mappingFor(plan, '#q-open');

    expect(open?.status).toBe('ask_user');
    expect(open?.value).toBe('');
  });

  test('期望城市与薪资走标量映射', async ({ page }) => {
    const plan = await planFor(page, '/mock_qa/apply.html');

    // Profile 未填这两项，应留空而非编造
    expect(mappingFor(plan, '#q-city')?.status).toBe('skipped');
    expect(mappingFor(plan, '#q-salary')?.status).toBe('skipped');
  });
});

test.describe('整表统计', () => {
  test('每个站的每个字段都有明确结论', async ({ page }) => {
    for (const site of MOCK_SITES) {
      if (site.fields.length === 0) continue;

      const plan = await planFor(page, site.applyPath);
      const stats = summarizePlan(plan);

      expect(stats.filled + stats.skipped + stats.askUser, `${site.id} 有字段没有结论`).toBe(
        stats.total,
      );
      expect(stats.total, `${site.id} 应至少解析出字段`).toBeGreaterThan(0);
    }
  });
});
