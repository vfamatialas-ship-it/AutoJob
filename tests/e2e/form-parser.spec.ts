/**
 * M3 验收测试 —— 在**真实浏览器**里跑完整链路：
 *
 *   页面 DOM → EXTRACT_FIELDS_SCRIPT → RawField[] → classifyForm → FormField[]
 *
 * 然后拿结果与 manifest 声明的 semanticType 逐项比对。
 *
 * 这是 M3 唯一有意义的验收方式：单元测试喂的是手工构造的 RawField，
 * 只有真实 DOM 才能验证提取脚本对各种 label 写法的处理是否真的成立。
 */

import { expect, test } from '@playwright/test';
import { EXTRACT_FIELDS_SCRIPT } from '../../packages/form-schema/src/raw-field.js';
import { classifyForm } from '../../packages/form-schema/src/classifier.js';
import { confidenceAction } from '../../packages/form-schema/src/form-field.js';
import { MOCK_SITES } from '../fixtures/sites/manifest.js';
import type { FormField } from '../../packages/form-schema/src/form-field.js';
import type { Page } from '@playwright/test';

async function parse(page: Page, path: string): Promise<readonly FormField[]> {
  await page.goto(path);
  const rawFields = await page.evaluate(EXTRACT_FIELDS_SCRIPT);
  return classifyForm(path, rawFields).fields;
}

const bySelector = (fields: readonly FormField[], selector: string): FormField | undefined =>
  fields.find((field) => field.selector === selector);

for (const site of MOCK_SITES) {
  if (site.fields.length === 0) continue; // Repeatable 站初始无字段，由专门用例覆盖

  test.describe(`${site.id} · 语义分类验收`, () => {
    test('manifest 声明的每个字段都被正确分类', async ({ page }) => {
      const fields = await parse(page, site.applyPath);

      for (const expected of site.fields) {
        const actual = bySelector(fields, expected.selector);
        expect(actual, `未提取到字段 ${expected.selector}（${expected.label}）`).toBeDefined();
        if (!actual) continue;

        expect(
          actual.semanticType,
          `${expected.selector}「${expected.label}」应为 ${expected.semanticType}，` +
            `实际 ${actual.semanticType}（label 归因：「${actual.label}」来自 ${actual.labelSource}）`,
        ).toBe(expected.semanticType);
      }
    });

    test('模糊字段落入 ask_user，明确字段不落', async ({ page }) => {
      const fields = await parse(page, site.applyPath);

      for (const expected of site.fields) {
        const actual = bySelector(fields, expected.selector);
        if (!actual) continue;

        const action = confidenceAction(actual.confidence);
        if (expected.expectAmbiguous === true) {
          expect(
            action,
            `${expected.selector}「${expected.label}」语义模糊，必须转人工，实际置信度 ${actual.confidence}`,
          ).toBe('ask_user');
        } else {
          expect(
            action,
            `${expected.selector}「${expected.label}」应能自动填写，实际置信度 ${actual.confidence}`,
          ).not.toBe('ask_user');
        }
      }
    });
  });
}

test.describe('label 归因：三种真实写法都能识别', () => {
  test('A 公司：相邻文本节点（无 label for）', async ({ page }) => {
    const fields = await parse(page, '/mock_company_a/apply.html');

    const mobile = bySelector(fields, '#mobile');
    expect(mobile?.labelSource).toBe('sibling_text');
    expect(mobile?.label).toBe('手机号码');
    expect(mobile?.semanticType).toBe('PHONE');
  });

  test('B 公司：仅有 aria-label', async ({ page }) => {
    const fields = await parse(page, '/mock_company_b/apply.html');

    const github = bySelector(fields, '#gh');
    expect(github?.labelSource).toBe('aria_label');
    expect(github?.semanticType).toBe('GITHUB');
    expect(confidenceAction(github?.confidence ?? 0)).toBe('auto');
  });

  test('C 公司：仅有 placeholder，置信度相应下调', async ({ page }) => {
    const fields = await parse(page, '/mock_company_c/apply.html');

    const phone = bySelector(fields, '#c-phone');
    expect(phone?.labelSource).toBe('placeholder');
    expect(phone?.semanticType).toBe('PHONE');
    // 能填，但要在 Diff 里标出来
    expect(confidenceAction(phone?.confidence ?? 0)).toBe('auto_with_warning');
  });

  test('F 公司：<label for> 是「选择文件」按钮文案，必须跳过', async ({ page }) => {
    const fields = await parse(page, '/mock_upload/apply.html');

    const resume = bySelector(fields, '#up-resume');
    // 如果照单全收 label[for]，字段名会变成「选择文件」，语义彻底丢失
    expect(resume?.label).not.toBe('选择文件');
    expect(resume?.semanticType).toBe('RESUME_ATTACHMENT');
  });
});

test.describe('核心难点：B 公司的科研 / 项目陷阱', () => {
  test('「课题经历」判为科研，「研究项目」判为项目', async ({ page }) => {
    const fields = await parse(page, '/mock_company_b/apply.html');

    expect(bySelector(fields, '#topic-exp')?.semanticType).toBe('RESEARCH_EXPERIENCE');
    expect(bySelector(fields, '#research-proj')?.semanticType).toBe('PROJECT_EXPERIENCE');
  });

  test('「实践经历」转人工，不被硬判成实习或科研', async ({ page }) => {
    const fields = await parse(page, '/mock_company_b/apply.html');
    const practice = bySelector(fields, '#practice-exp');

    expect(practice?.semanticType).toBe('SOCIAL_PRACTICE');
    expect(confidenceAction(practice?.confidence ?? 1)).toBe('ask_user');
    expect(practice?.semanticType).not.toBe('INTERNSHIP');
    expect(practice?.semanticType).not.toBe('RESEARCH_EXPERIENCE');
  });
});

test.describe('结构信息提取', () => {
  test('区块标题被正确关联', async ({ page }) => {
    const fields = await parse(page, '/mock_company_a/apply.html');

    expect(bySelector(fields, '#school')?.section).toBe('教育背景');
    expect(bySelector(fields, '#work-exp')?.section).toBe('经历');
  });

  test('字数限制被提取', async ({ page }) => {
    const fields = await parse(page, '/mock_company_c/apply.html');

    expect(bySelector(fields, '#c-project-brief')?.maxLength).toBe(100);
    expect(bySelector(fields, '#c-achievement')?.maxLength).toBe(300);
  });

  test('select 选项被提取', async ({ page }) => {
    const fields = await parse(page, '/mock_company_a/apply.html');

    expect(bySelector(fields, '#edu-level')?.kind).toBe('select');
    expect(bySelector(fields, '#edu-level')?.options).toContain('硕士');
  });

  test('radio / checkbox 按组合并成一个字段', async ({ page }) => {
    const fields = await parse(page, '/mock_widgets/apply.html');

    const cityFields = fields.filter((field) => field.groupName === 'w-city');
    expect(cityFields).toHaveLength(1);
    expect(cityFields[0]?.kind).toBe('checkbox');
    expect(cityFields[0]?.options).toEqual(['北京', '上海', '深圳', '杭州', '西安']);
  });

  test('隐藏的 file input 仍被提取（上传控件常被 CSS 藏起来）', async ({ page }) => {
    const fields = await parse(page, '/mock_upload/apply.html');

    const resume = bySelector(fields, '#up-resume');
    expect(resume).toBeDefined();
    expect(resume?.visible).toBe(false);
    expect(resume?.accept).toBe('.pdf');
  });

  test('必填标记被识别', async ({ page }) => {
    const fields = await parse(page, '/mock_company_a/apply.html');
    expect(bySelector(fields, '#name')?.required).toBe(true);
  });

  test('回归：区块内第一个字段不会把 <legend> 误当作 label', async ({ page }) => {
    // 曾经的 bug：checkbox 组的前一个兄弟是 <legend>求职意向</legend>，
    // 被当成字段名后语义彻底丢失（分类为 OTHER，置信度 0）。
    const widgets = await parse(page, '/mock_widgets/apply.html');
    const city = widgets.find((field) => field.groupName === 'w-city');

    expect(city?.label).not.toBe('求职意向');
    expect(city?.semanticType).toBe('EXPECTED_LOCATION');
    expect(confidenceAction(city?.confidence ?? 0)).not.toBe('ask_user');

    const qa = await parse(page, '/mock_qa/apply.html');
    const transfer = qa.find((field) => field.groupName === 'q-transfer');

    expect(transfer?.label).not.toBe('补充问题');
    expect(transfer?.semanticType).toBe('QUESTION');
    expect(confidenceAction(transfer?.confidence ?? 0)).not.toBe('ask_user');
  });
});

test.describe('Repeatable 站：动态生成的字段也能解析', () => {
  test('添加条目后能提取到带索引的字段', async ({ page }) => {
    await page.goto('/mock_repeatable/apply.html');

    // 初始无字段
    let rawFields = await page.evaluate(EXTRACT_FIELDS_SCRIPT);
    expect(rawFields).toHaveLength(0);

    await page.click('#add-research');
    await page.click('#add-project');

    rawFields = await page.evaluate(EXTRACT_FIELDS_SCRIPT);
    const fields = classifyForm('/mock_repeatable/apply.html', rawFields).fields;

    expect(bySelector(fields, '#research-0-name')).toBeDefined();
    expect(bySelector(fields, '#project-0-name')).toBeDefined();
    expect(bySelector(fields, '#research-0-desc')?.section).toBe('科研经历');
    expect(bySelector(fields, '#project-0-desc')?.section).toBe('项目经历');
  });
});

test.describe('页面指纹', () => {
  test('同一页面两次解析得到相同指纹', async ({ page }) => {
    await page.goto('/mock_company_a/apply.html');
    const first = classifyForm('a', await page.evaluate(EXTRACT_FIELDS_SCRIPT)).pageSignature;

    await page.reload();
    const second = classifyForm('a', await page.evaluate(EXTRACT_FIELDS_SCRIPT)).pageSignature;

    expect(first).toBe(second);
  });

  test('不同页面指纹不同', async ({ page }) => {
    await page.goto('/mock_company_a/apply.html');
    const a = classifyForm('a', await page.evaluate(EXTRACT_FIELDS_SCRIPT)).pageSignature;

    await page.goto('/mock_company_c/apply.html');
    const c = classifyForm('c', await page.evaluate(EXTRACT_FIELDS_SCRIPT)).pageSignature;

    expect(a).not.toBe(c);
  });
});
