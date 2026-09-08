/**
 * 难点站交互验证 —— 自定义控件 / Repeatable / 上传 / 问答。
 *
 * 这些用例的价值不在「测 Mock 站」，而在**提前把 M5 填写引擎要面对的坑全踩一遍**：
 * 每个 test 里的操作序列，就是 M5 的 FormFiller 将来必须实现的动作。
 * 如果这里都填不进去，真实招聘网站更填不进去。
 */

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

test.describe('D 公司 · 自定义控件', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/mock_widgets/apply.html');
  });

  test('自定义下拉：选项必须点开才存在，不能用 selectOption', async ({ page }) => {
    // 初始状态列表是空的 —— 这正是直接查 option 会失败的原因
    await expect(page.locator('#w-degree-list li')).toHaveCount(0);

    await page.click('#w-degree-trigger');
    await expect(page.locator('#w-degree-list li')).toHaveCount(4);

    await page.locator('#w-degree-list li', { hasText: '硕士' }).click();

    // 真实值写在隐藏 input 里，按钮上只是显示文本
    await expect(page.locator('#w-degree')).toHaveValue('硕士');
    await expect(page.locator('#w-degree-trigger')).toHaveText('硕士');
    await expect(page.locator('#w-degree-list')).not.toBeVisible();
  });

  test('autocomplete：输入后需等待候选出现再点选', async ({ page }) => {
    await page.fill('#w-school', '西安');

    // 候选是延迟渲染的，必须等
    await expect(page.locator('#w-school-list li').first()).toBeVisible();
    const options = await page.locator('#w-school-list li').allInnerTexts();
    expect(options).toContain('西安交通大学');

    await page.locator('#w-school-list li', { hasText: '西安交通大学' }).click();
    await expect(page.locator('#w-school')).toHaveValue('西安交通大学');
  });

  test('autocomplete：输入不足 2 字不出候选', async ({ page }) => {
    await page.fill('#w-school', '西');
    await expect(page.locator('#w-school-list li')).toHaveCount(0);
  });

  test('radio 与 checkbox', async ({ page }) => {
    await page.check('input[name="w-gender"][value="女"]');
    await expect(page.locator('input[name="w-gender"][value="女"]')).toBeChecked();

    await page.check('input[name="w-city"][value="北京"]');
    await page.check('input[name="w-city"][value="西安"]');
    await expect(page.locator('input[name="w-city"]:checked')).toHaveCount(2);
  });

  test('原生 date 需要 YYYY-MM-DD 格式', async ({ page }) => {
    await page.fill('#w-graduation', '2027-06-30');
    await expect(page.locator('#w-graduation')).toHaveValue('2027-06-30');
  });
});

test.describe('E 公司 · Repeatable Section', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/mock_repeatable/apply.html');
  });

  test('初始状态没有任何输入框', async ({ page }) => {
    await expect(page.locator('#edu-container .section-item')).toHaveCount(0);
    await expect(page.locator('#research-container .section-item')).toHaveCount(0);
    await expect(page.locator('#project-container .section-item')).toHaveCount(0);
  });

  test('点击添加后动态生成带索引的字段', async ({ page }) => {
    await page.click('#add-edu');
    await expect(page.locator('#edu-0-school')).toBeVisible();

    await page.click('#add-edu');
    await expect(page.locator('#edu-1-school')).toBeVisible();

    await page.fill('#edu-0-school', '西安交通大学');
    await page.fill('#edu-1-school', '某某大学');
    await expect(page.locator('#edu-0-school')).toHaveValue('西安交通大学');
    await expect(page.locator('#edu-1-school')).toHaveValue('某某大学');
  });

  test('三个分区独立计数，互不干扰', async ({ page }) => {
    await page.click('#add-edu');
    await page.click('#add-research');
    await page.click('#add-research');
    await page.click('#add-project');

    await expect(page.locator('#edu-container .section-item')).toHaveCount(1);
    await expect(page.locator('#research-container .section-item')).toHaveCount(2);
    await expect(page.locator('#project-container .section-item')).toHaveCount(1);

    // 各分区索引都从 0 开始
    await expect(page.locator('#research-0-name')).toBeVisible();
    await expect(page.locator('#research-1-name')).toBeVisible();
    await expect(page.locator('#project-0-name')).toBeVisible();
  });

  test('索引陷阱：删除中间一条后索引不重排', async ({ page }) => {
    await page.click('#add-edu');
    await page.click('#add-edu');
    await page.click('#add-edu');

    await page.fill('#edu-2-school', '第三条');
    await page.locator('#edu-item-1 .remove-btn').click();

    // 索引 1 消失，但索引 2 仍是 2 —— 按顺序数第二条会拿错元素
    await expect(page.locator('#edu-1-school')).toHaveCount(0);
    await expect(page.locator('#edu-2-school')).toHaveValue('第三条');
    await expect(page.locator('#edu-container .section-item')).toHaveCount(2);

    // 再添加一条，编号继续递增，不会复用被删掉的 1
    await page.click('#add-edu');
    await expect(page.locator('#edu-3-school')).toBeVisible();
  });

  test('科研分区独立存在 —— 本站不会发生科研降级', async ({ page }) => {
    await page.click('#add-research');
    await page.fill('#research-0-name', '水下双臂 VLA 课题');
    await expect(page.locator('#research-0-name')).toHaveValue('水下双臂 VLA 课题');
  });
});

test.describe('F 公司 · 附件上传', () => {
  /** 生成指定大小的临时文件 */
  async function makeFile(name: string, sizeBytes: number): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'autojob-e2e-'));
    const path = join(dir, name);
    await writeFile(path, Buffer.alloc(sizeBytes, 0x41));
    return path;
  }

  test.beforeEach(async ({ page }) => {
    await page.goto('/mock_upload/apply.html');
  });

  test('file input 被隐藏，必须用 setInputFiles 而不是点按钮', async ({ page }) => {
    await expect(page.locator('#up-resume')).toBeHidden();
    await expect(page.locator('label[for="up-resume"]')).toBeVisible();

    const path = await makeFile('resume.pdf', 1024);
    await page.setInputFiles('#up-resume', path);
    await expect(page.locator('#up-resume-name')).toHaveText('resume.pdf');
  });

  test('格式不符被前端拒绝并给出错误', async ({ page }) => {
    const path = await makeFile('resume.docx', 1024);
    await page.setInputFiles('#up-resume', path);

    await expect(page.locator('#up-resume-error')).toContainText('不支持的文件格式');
    await expect(page.locator('#up-resume-name')).toHaveText('未选择文件');
  });

  test('超过大小上限被前端拒绝', async ({ page }) => {
    const path = await makeFile('portfolio.pdf', 3 * 1024 * 1024);
    await page.setInputFiles('#up-portfolio', path); // 作品集上限 10MB，通过
    await expect(page.locator('#up-portfolio-name')).toHaveText('portfolio.pdf');

    await page.setInputFiles('#up-resume', path); // 简历上限 2MB，拒绝
    await expect(page.locator('#up-resume-error')).toContainText('文件过大');
  });

  test('成绩单接受图片，简历不接受', async ({ page }) => {
    const image = await makeFile('transcript.png', 2048);

    await page.setInputFiles('#up-transcript', image);
    await expect(page.locator('#up-transcript-name')).toHaveText('transcript.png');

    await page.setInputFiles('#up-resume', image);
    await expect(page.locator('#up-resume-error')).toContainText('不支持的文件格式');
  });
});

test.describe('G 公司 · 校招问答', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/mock_qa/apply.html');
  });

  test('问题用 <p> 承载，没有 label for —— 分类器只能靠邻近文本', async ({ page }) => {
    await expect(page.locator('label[for="q-city"]')).toHaveCount(0);

    const questionText = await page.locator('#q-city-wrap p').innerText();
    expect(questionText).toContain('期望工作城市');
  });

  test('措辞与标准问法不一致，需语义匹配', async ({ page }) => {
    const text = await page.locator('#q-transfer p').innerText();
    expect(text).toContain('是否服从职位调剂');
    // 标准问法是「是否接受岗位调剂」，字面不同
    expect(text).not.toContain('接受岗位调剂');
  });

  test('全部 10 道问题都在页面上', async ({ page }) => {
    await expect(page.locator('#qa-form .q')).toHaveCount(10);
  });

  test('开放题有字数限制，且必然无法自动作答', async ({ page }) => {
    await expect(page.locator('#q-open')).toHaveAttribute('maxlength', '500');

    const text = await page.locator('#q-open-wrap p').innerText();
    expect(text).toContain('为什么适合本岗位');
  });

  test('各类控件都能被填写', async ({ page }) => {
    await page.check('input[name="q-transfer"][value="否"]');
    await page.fill('#q-city', '西安');
    await page.fill('#q-salary', '40');
    await page.fill('#q-available', '2027-07-01');
    await page.fill('#q-english', 'CET-4');

    await expect(page.locator('input[name="q-transfer"][value="否"]')).toBeChecked();
    await expect(page.locator('#q-city')).toHaveValue('西安');
    await expect(page.locator('#q-available')).toHaveValue('2027-07-01');
  });
});
