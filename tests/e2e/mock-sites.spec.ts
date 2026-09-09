/**
 * Mock 站点结构验证 —— M2 的验收测试。
 *
 * 目的不是测业务逻辑，而是**保证 Mock 站确实制造了它声称的困难**。
 * 如果哪天有人「顺手」把 A 公司的 label 补全了，或者给它加了个科研栏，
 * 那么 M3/M4 在它上面跑通就失去了意义 —— 这个测试就是防止这种悄悄退化。
 */

import { expect, test } from '@playwright/test';
import { MOCK_SITES } from '../fixtures/sites/manifest.js';

test.describe('Mock 站点索引页', () => {
  test('列出全部站点入口', async ({ page }) => {
    await page.goto('/');
    for (const site of MOCK_SITES) {
      await expect(page.locator(`a[href="${site.applyPath}"]`)).toHaveCount(1);
    }
  });
});

for (const site of MOCK_SITES) {
  test.describe(`${site.id} · ${site.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto(site.applyPath);
    });

    test('manifest 声明的字段在页面上真实存在', async ({ page }) => {
      for (const field of site.fields) {
        await expect(
          page.locator(field.selector),
          `缺少字段 ${field.label} (${field.selector})`,
        ).toHaveCount(1);
      }
    });

    test('字数限制与 manifest 一致', async ({ page }) => {
      for (const field of site.fields) {
        if (field.maxLength === undefined) continue;
        await expect(page.locator(field.selector)).toHaveAttribute(
          'maxlength',
          String(field.maxLength),
        );
      }
    });

    test('页面有可提交的表单与提交按钮', async ({ page }) => {
      // 被登录挡住的站表单不可见；岗位列表页压根没有申请表 —— 各有专项用例覆盖
      test.skip(site.gated === true, `${site.id} 需要先登录才能看到表单`);
      test.skip(site.isJobList === true, `${site.id} 是岗位列表页，没有申请表`);

      await expect(page.locator('form')).toHaveCount(1);
      await expect(page.locator('#submit-btn')).toBeVisible();
    });

    test('文本字段可被真实填写', async ({ page }) => {
      // 上传站全是 file input、Repeatable 站初始无字段，这类站由各自的专项用例覆盖
      const textField = site.fields.find((f) =>
        (['PERSON_NAME', 'UNIVERSITY', 'EXPECTED_LOCATION'] as const).some(
          (type) => type === f.semanticType,
        ),
      );
      test.skip(textField === undefined, `${site.id} 没有可直接填写的文本字段`);
      if (!textField) return;

      await page.fill(textField.selector, '测试候选人');
      await expect(page.locator(textField.selector)).toHaveValue('测试候选人');
    });
  });
}

test.describe('刁难点确实存在', () => {
  test('A 公司：没有任何科研经历栏目', async ({ page }) => {
    await page.goto('/mock_company_a/apply.html');

    // 页面文本里不应出现「科研」「课题」「研究经历」这类栏目名
    const labels = await page.locator('label, .field-name, legend').allInnerTexts();
    const joined = labels.join(' ');
    expect(joined).not.toContain('科研');
    expect(joined).not.toContain('课题');

    // 但工作经历与项目经历都在
    expect(joined).toContain('工作经历');
    expect(joined).toContain('项目经历');
  });

  test('A 公司：手机号与邮箱没有 <label for>，只能靠相邻文本识别', async ({ page }) => {
    await page.goto('/mock_company_a/apply.html');

    await expect(page.locator('label[for="mobile"]')).toHaveCount(0);
    await expect(page.locator('label[for="mail"]')).toHaveCount(0);

    // 相邻的 span 里确实有文字
    const mobileRowText = await page.locator('.row', { has: page.locator('#mobile') }).innerText();
    expect(mobileRowText).toContain('手机号码');
  });

  test('A 公司：奖项只有一个合并栏', async ({ page }) => {
    await page.goto('/mock_company_a/apply.html');
    const labels = (await page.locator('label').allInnerTexts()).join(' ');

    expect(labels).toContain('荣誉奖励');
    expect(labels).not.toContain('奖学金');
    expect(labels).not.toContain('竞赛');
  });

  test('B 公司：使用生僻栏目名「课题经历」「研究项目」「实践经历」', async ({ page }) => {
    await page.goto('/mock_company_b/apply.html');
    const labels = (await page.locator('label').allInnerTexts()).join(' ');

    expect(labels).toContain('课题经历');
    expect(labels).toContain('研究项目');
    expect(labels).toContain('实践经历');
    // 不使用标准说法，这才是难点所在
    expect(labels).not.toContain('科研经历');
  });

  test('B 公司：GitHub 字段只有 aria-label，页面上无可见文字标签', async ({ page }) => {
    await page.goto('/mock_company_b/apply.html');

    await expect(page.locator('label[for="gh"]')).toHaveCount(0);
    await expect(page.locator('#gh')).toHaveAttribute('aria-label', 'GitHub 地址');
  });

  test('B 公司：奖学金与竞赛分为两栏', async ({ page }) => {
    await page.goto('/mock_company_b/apply.html');
    const labels = (await page.locator('label').allInnerTexts()).join(' ');

    expect(labels).toContain('奖学金情况');
    expect(labels).toContain('竞赛获奖');
  });

  test('C 公司：手机号只有 placeholder，没有 label', async ({ page }) => {
    await page.goto('/mock_company_c/apply.html');

    await expect(page.locator('label[for="c-phone"]')).toHaveCount(0);
    await expect(page.locator('#c-phone')).toHaveAttribute('placeholder', '请输入手机号');
  });

  test('C 公司：奖学金 / 竞赛 / 荣誉三栏严格分开', async ({ page }) => {
    await page.goto('/mock_company_c/apply.html');
    const labels = (await page.locator('label').allInnerTexts()).join(' ');

    expect(labels).toContain('奖学金');
    expect(labels).toContain('学科竞赛获奖');
    expect(labels).toContain('荣誉称号');
  });

  test('C 公司：字数限制会真的阻止超长输入', async ({ page }) => {
    await page.goto('/mock_company_c/apply.html');

    const longText = '算'.repeat(150);
    await page.fill('#c-project-brief', longText);

    const actual = await page.inputValue('#c-project-brief');
    expect(actual.length).toBe(100); // 浏览器按 maxlength 截断
  });
});
