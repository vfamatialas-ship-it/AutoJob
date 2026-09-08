/**
 * M5 验收测试 —— PRD Phase 0 的验收点。
 *
 * 完整链路第一次真正落到浏览器里：
 *
 *   页面 DOM → 提取 → 分类 → 映射 → **填写** → 校验 →（在提交前停住）
 *
 * 注意：本文件使用**脱敏样本 Profile**。真实 Profile 在 materials/ 下且已 gitignore，
 * 提交到仓库的测试代码里不得出现任何真实个人信息。
 */

import { mkdtemp, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { importProfile } from '../../packages/candidate-profile/src/io.js';
import { classifyForm } from '../../packages/form-schema/src/classifier.js';
import { EXTRACT_FIELDS_SCRIPT } from '../../packages/form-schema/src/raw-field.js';
import {
  BUILTIN_GLOBAL_RULES,
  MappingRuleStore,
} from '../../packages/form-mapper/src/mapping-rule.js';
import { mapForm } from '../../packages/form-mapper/src/mapper.js';
import { fillField, fillForm } from '../../packages/browser/src/filler.js';
import { validateForm } from '../../packages/browser/src/validator.js';
import { detectGate, gateToError } from '../../packages/browser/src/session.js';
import type { CandidateProfile } from '../../packages/candidate-profile/src/profile.js';
import type { FormField } from '../../packages/form-schema/src/form-field.js';
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

/** 完整链路：打开页面 → 解析 → 映射 → 填写 */
async function runPipeline(
  page: Page,
  path: string,
): Promise<{ fields: readonly FormField[]; filled: number; failed: number }> {
  await page.goto(path);

  const rawFields = await page.evaluate(EXTRACT_FIELDS_SCRIPT);
  const { fields } = classifyForm(path, rawFields);
  const plan = mapForm(fields, {
    profile,
    rules: new MappingRuleStore(BUILTIN_GLOBAL_RULES),
    today: '2026-09-09',
    companyId: 'mock-company',
    atsType: 'mock-ats',
  });

  const summary = await fillForm(page, plan.mappings);
  return { fields, filled: summary.filled, failed: summary.failed };
}

test.describe('A 公司 · 完整填写', () => {
  test('基本信息与经历被真实填入页面', async ({ page }) => {
    const result = await runPipeline(page, '/mock_company_a/apply.html');
    expect(result.failed, '不应有填写失败的字段').toBe(0);

    await expect(page.locator('#name')).toHaveValue('示例候选人');
    await expect(page.locator('#mobile')).toHaveValue('13800000000');
    await expect(page.locator('#mail')).toHaveValue('candidate@example.com');
    await expect(page.locator('#school')).toHaveValue('西安交通大学');
    await expect(page.locator('#major')).toHaveValue('机械工程');
    await expect(page.locator('#edu-level')).toHaveValue('硕士');
    await expect(page.locator('#homepage')).toHaveValue(/github\.com/);
  });

  test('红线：工作经历栏保持为空，科研没有被塞进去', async ({ page }) => {
    await runPipeline(page, '/mock_company_a/apply.html');

    const work = await page.inputValue('#work-exp');
    expect(work).toBe('');
    expect(work).not.toContain('水下双臂');
  });

  test('科研经历出现在项目经历栏', async ({ page }) => {
    await runPipeline(page, '/mock_company_a/apply.html');

    const project = await page.inputValue('#project-exp');
    expect(project).toContain('水下双臂');
    expect(project).toContain('西安交通大学');
  });

  test('奖项合并栏收到全部 8 项，且奖学金与竞赛同时在内', async ({ page }) => {
    await runPipeline(page, '/mock_company_a/apply.html');

    const honors = await page.inputValue('#honors');
    expect(honors).toContain('国家奖学金');
    expect(honors).toContain('机器人及仿真');
    expect(honors.split('\n').filter((line) => line.trim().length > 0)).toHaveLength(8);
  });

  test('填写后表单校验通过', async ({ page }) => {
    const { fields } = await runPipeline(page, '/mock_company_a/apply.html');
    const issues = await validateForm(page, fields);

    // 工作经历栏为空但非必填，不应报错
    expect(issues.filter((issue) => issue.code !== 'SITE_REPORTED_ERROR')).toEqual([]);
  });

  test('提交按钮没有被点击 —— 停在提交前（PRD §3.7）', async ({ page }) => {
    await runPipeline(page, '/mock_company_a/apply.html');

    // 仍停留在申请页，没有跳转到 success 页
    expect(page.url()).toContain('/mock_company_a/apply.html');
    await expect(page.locator('#submit-btn')).toBeVisible();
  });
});

test.describe('B 公司 · 科研与项目分栏', () => {
  test('课题进课题栏、项目进项目栏，实践经历留空', async ({ page }) => {
    const result = await runPipeline(page, '/mock_company_b/apply.html');
    expect(result.failed).toBe(0);

    expect(await page.inputValue('#topic-exp')).toContain('水下双臂');
    expect(await page.inputValue('#research-proj')).toContain('Open-kaka');

    // 语义模糊，转人工，因此不填 —— 页面上必须是空的
    expect(await page.inputValue('#practice-exp')).toBe('');
  });

  test('奖学金与竞赛严格分栏填写', async ({ page }) => {
    await runPipeline(page, '/mock_company_b/apply.html');

    const scholarship = await page.inputValue('#scholarship');
    const competition = await page.inputValue('#competition');

    expect(scholarship).toContain('国家奖学金');
    expect(scholarship).not.toContain('华为杯');
    expect(competition).toContain('华为杯');
    expect(competition).not.toContain('国家奖学金');
  });

  test('GitHub 通过 aria-label 识别并填入', async ({ page }) => {
    await runPipeline(page, '/mock_company_b/apply.html');
    expect(await page.inputValue('#gh')).toContain('github.com');
  });
});

test.describe('C 公司 · 字数限制', () => {
  test('超长字段保持为空，绝不截断', async ({ page }) => {
    await runPipeline(page, '/mock_company_c/apply.html');

    // 项目简介限 100 字，内容超长 → 映射阶段已转人工，填写阶段跳过
    expect(await page.inputValue('#c-project-brief')).toBe('');
  });

  test('三个奖项栏各填各的', async ({ page }) => {
    await runPipeline(page, '/mock_company_c/apply.html');

    expect(await page.inputValue('#c-scholarship')).toContain('国家奖学金');
    expect(await page.inputValue('#c-competition')).toContain('机器人及仿真');
    expect(await page.inputValue('#c-honor')).toContain('优秀研究生');
  });

  test('placeholder-only 的手机号仍被填入', async ({ page }) => {
    await runPipeline(page, '/mock_company_c/apply.html');
    expect(await page.inputValue('#c-phone')).toBe('13800000000');
  });
});

test.describe('D 公司 · 自定义控件（M2 踩过的坑逐个验证）', () => {
  const field = (overrides: Partial<FormField>): FormField => ({
    id: 'x',
    selector: '#x',
    label: '',
    labelSource: 'label_for',
    kind: 'text',
    semanticType: 'OTHER',
    confidence: 1,
    reason: '',
    required: false,
    disabled: false,
    visible: true,
    section: '',
    options: [],
    repeatable: false,
    ...overrides,
  });

  test('自定义下拉：点开→等渲染→点选项，值写进隐藏 input', async ({ page }) => {
    await page.goto('/mock_widgets/apply.html');

    const result = await fillField(
      page,
      field({ selector: '#w-degree', label: '最高学历', kind: 'unknown', visible: false }),
      '硕士',
    );

    expect(result.ok, result.error).toBe(true);
    expect(result.strategy).toBe('custom_dropdown');
    await expect(page.locator('#w-degree')).toHaveValue('硕士');
    await expect(page.locator('#w-degree-trigger')).toHaveText('硕士');
  });

  test('autocomplete：输入后等候选出现再点选', async ({ page }) => {
    await page.goto('/mock_widgets/apply.html');

    const result = await fillField(
      page,
      field({ selector: '#w-school', label: '毕业院校', kind: 'text' }),
      '西安交通大学',
    );

    expect(result.ok, result.error).toBe(true);
    expect(result.strategy).toBe('autocomplete');
    await expect(page.locator('#w-school')).toHaveValue('西安交通大学');
  });

  test('radio 与 checkbox', async ({ page }) => {
    await page.goto('/mock_widgets/apply.html');

    const radio = await fillField(
      page,
      field({
        selector: 'input[name="w-gender"]',
        label: '性别',
        kind: 'radio',
        groupName: 'w-gender',
        options: ['男', '女'],
      }),
      '女',
    );
    expect(radio.ok, radio.error).toBe(true);
    await expect(page.locator('input[name="w-gender"][value="女"]')).toBeChecked();

    const checkbox = await fillField(
      page,
      field({
        selector: 'input[name="w-city"]',
        label: '工作地点',
        kind: 'checkbox',
        groupName: 'w-city',
        options: ['北京', '上海', '深圳', '杭州', '西安'],
      }),
      '北京\n西安',
    );
    expect(checkbox.ok, checkbox.error).toBe(true);
    await expect(page.locator('input[name="w-city"]:checked')).toHaveCount(2);
  });

  test('原生 date 自动归一为 YYYY-MM-DD', async ({ page }) => {
    await page.goto('/mock_widgets/apply.html');

    const result = await fillField(
      page,
      field({ selector: '#w-graduation', label: '毕业时间', kind: 'date' }),
      '2027-06', // Profile 里存的是 YYYY-MM
    );

    expect(result.ok, result.error).toBe(true);
    await expect(page.locator('#w-graduation')).toHaveValue('2027-06-01');
  });
});

test.describe('F 公司 · 附件上传', () => {
  async function makeFile(name: string, sizeBytes: number): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'autojob-fill-'));
    const path = join(dir, name);
    await writeFile(path, Buffer.alloc(sizeBytes, 0x41));
    return path;
  }

  test('直接操作隐藏的 file input 完成上传', async ({ page }) => {
    await page.goto('/mock_upload/apply.html');
    const resumePath = await makeFile('resume.pdf', 1024);

    const result = await fillField(
      page,
      {
        id: '#up-resume',
        selector: '#up-resume',
        label: '个人简历',
        labelSource: 'sibling_text',
        kind: 'file',
        semanticType: 'RESUME_ATTACHMENT',
        confidence: 0.9,
        reason: '',
        required: true,
        disabled: false,
        visible: false,
        section: '附件材料',
        options: [],
        accept: '.pdf',
        repeatable: false,
      },
      resumePath,
    );

    expect(result.ok, result.error).toBe(true);
    expect(result.strategy).toBe('file_input');
    await expect(page.locator('#up-resume-name')).toHaveText('resume.pdf');
  });
});

test.describe('H 公司 · 登录拦截（PRD §25 / §74）', () => {
  test('识别出页面被登录挡住，且表单字段此时并不存在', async ({ page }) => {
    await page.goto('/mock_login/apply.html');

    const detection = await detectGate(page);
    expect(detection.gate).not.toBe('none');

    const error = gateToError(detection, page.url());
    expect(error?.userActionable).toBe(true);
    expect(error?.hint).toContain('浏览器窗口');

    // 登录前解析不到任何申请表字段 —— 这正是必须先处理登录的原因
    const rawFields = await page.evaluate(EXTRACT_FIELDS_SCRIPT);
    expect(rawFields.filter((raw) => raw.visible)).toHaveLength(0);
  });

  test('用户手动完成登录后，字段出现且可正常填写', async ({ page }) => {
    await page.goto('/mock_login/apply.html');

    // 模拟用户在浏览器里自己完成登录 —— 系统不代劳（PRD §74）
    await page.click('#simulate-login');

    const detection = await detectGate(page);
    expect(detection.gate).toBe('none');

    const rawFields = await page.evaluate(EXTRACT_FIELDS_SCRIPT);
    const { fields } = classifyForm('/mock_login/apply.html', rawFields);
    const plan = mapForm(fields, {
      profile,
      rules: new MappingRuleStore(BUILTIN_GLOBAL_RULES),
      today: '2026-09-09',
    });

    const summary = await fillForm(page, plan.mappings);
    expect(summary.failed).toBe(0);

    await expect(page.locator('#l-name')).toHaveValue('示例候选人');
    await expect(page.locator('#l-research')).toHaveValue(/水下双臂/);
  });

  test('登录态保存在 localStorage，刷新后无需重新登录', async ({ page }) => {
    await page.goto('/mock_login/apply.html');
    await page.click('#simulate-login');

    await page.reload();

    // 同一个 context 内 localStorage 保留，直接进入表单
    expect((await detectGate(page)).gate).toBe('none');
    await expect(page.locator('#l-name')).toBeVisible();
  });
});

test.describe('填写失败会被如实报告', () => {
  test('回读值与期望不符时标记为失败，不假装成功', async ({ page }) => {
    await page.goto('/mock_upload/apply.html');

    // 给只收 PDF 的简历位传 docx，前端会拒绝并清空
    const dir = await mkdtemp(join(tmpdir(), 'autojob-bad-'));
    const badPath = join(dir, 'resume.docx');
    await writeFile(badPath, Buffer.alloc(512, 0x41));

    const result = await fillField(
      page,
      {
        id: '#up-resume',
        selector: '#up-resume',
        label: '个人简历',
        labelSource: 'sibling_text',
        kind: 'file',
        semanticType: 'RESUME_ATTACHMENT',
        confidence: 0.9,
        reason: '',
        required: true,
        disabled: false,
        visible: false,
        section: '',
        options: [],
        repeatable: false,
      },
      badPath,
    );

    expect(result.ok).toBe(false);
    await expect(page.locator('#up-resume-error')).toContainText('不支持的文件格式');
  });
});
