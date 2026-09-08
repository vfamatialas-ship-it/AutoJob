/**
 * FormFiller —— 把 FormPlan 真正填进浏览器。
 *
 * ## 设计前提：真实招聘网站基本不用原生控件
 *
 * `page.fill()` 和 `page.selectOption()` 只能覆盖最理想的情况。
 * M2 的 Mock 站专门复刻了四类真实世界的难点，本文件为每一类准备了策略：
 *
 * | 难点 | 为什么原生方法失效 | 本文件的对策 |
 * |---|---|---|
 * | div 模拟的下拉 | 选项在点击前 DOM 里根本不存在 | 点触发器 → 等选项渲染 → 点匹配项 |
 * | autocomplete | 候选异步返回，且输入太短不出候选 | 输入 → 等候选出现 → 点匹配项 |
 * | 隐藏 file input | 被 CSS 藏起来，点 label 会弹系统文件框 | 直接 setInputFiles 操作隐藏 input |
 * | Repeatable | 条目要点「添加」才生成，删除后索引不重排 | 按需添加，用真实 DOM 顺序而非索引推算 |
 *
 * ## 每次填写都要回读验证
 *
 * 填进去 ≠ 填成功。自定义控件可能只改了显示文本没改真实值，
 * 前端校验可能把值又清空了。所以每个策略执行后都回读一次实际值，
 * 对不上就报失败 —— 宁可报错，也不要以为填好了其实是空的。
 */

import type { Page } from 'playwright';
import type { Logger } from '@autojob/core';
import type { FieldMapping } from '@autojob/form-mapper';
import type { FormField } from '@autojob/form-schema';

/** 填写用到的策略，出现在日志与 Diff 里 */
export type FillStrategy =
  | 'native_fill'
  | 'native_select'
  | 'radio_check'
  | 'checkbox_check'
  | 'file_input'
  | 'custom_dropdown'
  | 'autocomplete'
  | 'skipped';

export interface FillResult {
  readonly selector: string;
  readonly label: string;
  readonly ok: boolean;
  readonly strategy: FillStrategy;
  /** 回读到的实际值，用于验证是否真的填进去了 */
  readonly actualValue: string;
  readonly error?: string;
}

export interface FillOptions {
  readonly logger?: Logger;
  /** 单个字段的操作超时 */
  readonly timeoutMs?: number;
  /** 附件的基准目录，用于把 Profile 里的相对路径解析成绝对路径 */
  readonly assetBaseDir?: string;
}

const DEFAULT_TIMEOUT = 8_000;

/** 日期归一到 YYYY-MM-DD —— 原生 date 控件只认这个格式 */
function normalizeDateValue(value: string): string {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  if (/^\d{4}-\d{2}$/.test(trimmed)) return `${trimmed}-01`;
  if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(trimmed)) {
    const [year, month, day] = trimmed.split('/');
    return `${year}-${(month ?? '1').padStart(2, '0')}-${(day ?? '1').padStart(2, '0')}`;
  }
  return trimmed;
}

/** 选项匹配：先精确，再包含。两边都去掉空白，避免「 硕士 」对不上「硕士」 */
function matchOption(value: string, options: readonly string[]): string | undefined {
  const target = value.trim();
  const exact = options.find((option) => option.trim() === target);
  if (exact !== undefined) return exact;
  return options.find((option) => option.trim().includes(target) || target.includes(option.trim()));
}

// ————————————————————————————————————————————————
// 各类控件的填写策略
// ————————————————————————————————————————————————

async function fillNative(page: Page, field: FormField, value: string): Promise<string> {
  const text = field.kind === 'date' ? normalizeDateValue(value) : value;
  await page.fill(field.selector, text);
  return page.inputValue(field.selector);
}

async function fillNativeSelect(page: Page, field: FormField, value: string): Promise<string> {
  const option = matchOption(value, field.options) ?? value;
  await page.selectOption(field.selector, { label: option });
  return page.inputValue(field.selector);
}

async function fillRadio(page: Page, field: FormField, value: string): Promise<string> {
  const groupName = field.groupName;
  if (groupName === undefined) throw new Error('radio 字段缺少 groupName');

  const option = matchOption(value, field.options) ?? value;
  await page.check(`input[name="${groupName}"][value="${option}"]`);

  return page.inputValue(`input[name="${groupName}"]:checked`);
}

/** checkbox 支持多选，值用换行分隔 */
async function fillCheckbox(page: Page, field: FormField, value: string): Promise<string> {
  const groupName = field.groupName;
  if (groupName === undefined) throw new Error('checkbox 字段缺少 groupName');

  const wanted = value
    .split('\n')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  for (const item of wanted) {
    const option = matchOption(item, field.options) ?? item;
    await page.check(`input[name="${groupName}"][value="${option}"]`);
  }

  const checked = await page
    .locator(`input[name="${groupName}"]:checked`)
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).value));
  return checked.join('\n');
}

/**
 * 附件上传。
 *
 * 关键点：**直接对 input[type=file] 调 setInputFiles**，不去点那个可见的
 * `<label class="upload-trigger">选择文件</label>`。点 label 会触发系统文件选择框，
 * 那是浏览器进程外的原生窗口，Playwright 控制不了。
 */
async function fillFile(page: Page, field: FormField, absolutePath: string): Promise<string> {
  await page.setInputFiles(field.selector, absolutePath);

  const names = await page
    .locator(field.selector)
    .evaluate((node) =>
      Array.from((node as HTMLInputElement).files ?? []).map((file) => file.name),
    );
  return names.join(', ');
}

/**
 * 自定义下拉（div 模拟 select）。
 *
 * 难点在于**选项在点击触发器之前根本不在 DOM 里**，所以不能先查选项再决定点什么，
 * 只能：点开 → 等渲染 → 在渲染出来的列表里找匹配项 → 点它。
 *
 * 触发器的定位是启发式的：在字段所在容器里找 button / [role=combobox] / .combo-input。
 * 真实 ATS 的结构千奇百怪，M8 的 Adapter 会针对具体站点覆盖这个逻辑。
 */
async function fillCustomDropdown(
  page: Page,
  field: FormField,
  value: string,
  timeoutMs: number,
): Promise<string> {
  const container = page
    .locator(`${field.selector} >> xpath=ancestor-or-self::*[self::div or self::li][1]`)
    .first();

  const trigger = container
    .locator('button, [role="combobox"], .combo-input, .select-trigger')
    .first();
  await trigger.click({ timeout: timeoutMs });

  // 选项现在才被渲染出来
  const list = container.locator('ul li, [role="listbox"] [role="option"], .combo-list li');
  await list.first().waitFor({ state: 'visible', timeout: timeoutMs });

  const texts = await list.allInnerTexts();
  const option = matchOption(value, texts);
  if (option === undefined) {
    throw new Error(`下拉选项中没有「${value}」，可选：${texts.join('、')}`);
  }

  await list.filter({ hasText: option }).first().click();

  // 真实值通常写在隐藏 input 里，显示文本只是给人看的
  return page.inputValue(field.selector).catch(() => trigger.innerText());
}

/**
 * autocomplete 输入框。
 *
 * 两个必须尊重的时序：输入太短不出候选、候选是异步渲染的。
 * 所以先整串输入，再等候选出现；等不到就退化成「就把文本留在框里」，
 * 因为有些站点本来就允许自由输入。
 */
async function fillAutocomplete(
  page: Page,
  field: FormField,
  value: string,
  timeoutMs: number,
): Promise<string> {
  await page.fill(field.selector, value);

  const container = page
    .locator(`${field.selector} >> xpath=ancestor-or-self::*[self::div or self::li][1]`)
    .first();

  /*
   * 先用 count() 秒判容器里到底有没有候选列表的骨架。
   *
   * 早期版本上来就 waitFor(3s)，结果每个普通文本框都白等 3 秒 ——
   * 一个 5 字段的表单凭空多花 15 秒。而候选列表的容器元素（哪怕是空的 <ul>）
   * 在页面初始 HTML 里就存在，count() 是即时的，用它做前置判断成本为零。
   */
  const listContainer = container.locator('ul, [role="listbox"], .combo-list, .autocomplete-list');
  if ((await listContainer.count()) === 0) {
    return page.inputValue(field.selector);
  }

  const list = container.locator('ul li, [role="listbox"] [role="option"], .combo-list li');

  try {
    await list.first().waitFor({ state: 'visible', timeout: Math.min(timeoutMs, 3_000) });
  } catch {
    // 有列表骨架但没出候选，说明这个站允许自由输入
    return page.inputValue(field.selector);
  }

  const texts = await list.allInnerTexts();
  const option = matchOption(value, texts);
  if (option !== undefined) {
    await list.filter({ hasText: option }).first().click();
  }

  return page.inputValue(field.selector);
}

// ————————————————————————————————————————————————
// 调度
// ————————————————————————————————————————————————

/** 该字段看起来像自定义下拉吗 */
function looksLikeCustomDropdown(field: FormField): boolean {
  // 隐藏 input + 有候选选项，是 div 模拟下拉的典型形态
  return (field.kind === 'unknown' || !field.visible) && field.kind !== 'file';
}

/** 该字段看起来像 autocomplete 吗 */
function looksLikeAutocomplete(field: FormField): boolean {
  return field.kind === 'text' && field.options.length === 0;
}

export async function fillField(
  page: Page,
  field: FormField,
  value: string,
  options: FillOptions = {},
): Promise<FillResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT;
  const base = { selector: field.selector, label: field.label };

  const run = async (): Promise<[FillStrategy, string]> => {
    switch (field.kind) {
      case 'select':
        return ['native_select', await fillNativeSelect(page, field, value)];
      case 'radio':
        return ['radio_check', await fillRadio(page, field, value)];
      case 'checkbox':
        return ['checkbox_check', await fillCheckbox(page, field, value)];
      case 'file':
        return ['file_input', await fillFile(page, field, value)];
      case 'text':
      case 'textarea':
      case 'tel':
      case 'email':
      case 'url':
      case 'number':
      case 'date':
        if (looksLikeAutocomplete(field)) {
          return ['autocomplete', await fillAutocomplete(page, field, value, timeoutMs)];
        }
        return ['native_fill', await fillNative(page, field, value)];
      case 'unknown':
        return ['custom_dropdown', await fillCustomDropdown(page, field, value, timeoutMs)];
    }
  };

  try {
    const [strategy, actualValue] = await run();

    // 回读验证：填进去 ≠ 填成功
    const succeeded =
      strategy === 'file_input'
        ? actualValue.length > 0
        : actualValue.trim().length > 0 &&
          (actualValue.includes(value.trim()) ||
            value.includes(actualValue.trim()) ||
            strategy === 'checkbox_check');

    if (!succeeded) {
      return {
        ...base,
        ok: false,
        strategy,
        actualValue,
        error: `回读值「${actualValue}」与期望「${value}」不符，可能被前端校验清空`,
      };
    }

    options.logger?.debug('字段填写成功', { selector: field.selector, strategy });
    return { ...base, ok: true, strategy, actualValue };
  } catch (thrown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown);

    // 自定义下拉失败时退一步试原生 select —— 有些站点两者都支持
    if (looksLikeCustomDropdown(field) && field.options.length > 0) {
      try {
        const actualValue = await fillNativeSelect(page, field, value);
        return { ...base, ok: true, strategy: 'native_select', actualValue };
      } catch {
        // 退化也失败，按原错误报告
      }
    }

    options.logger?.warn('字段填写失败', { selector: field.selector, error: message });
    return { ...base, ok: false, strategy: 'skipped', actualValue: '', error: message };
  }
}

export interface FillSummary {
  readonly results: readonly FillResult[];
  readonly filled: number;
  readonly failed: number;
  readonly skipped: number;
}

/**
 * 按 FormPlan 填写整个表单。
 *
 * 只填 status === 'filled' 的字段。`ask_user` 与 `skipped` 一律不碰 ——
 * 它们的存在本身就是结论，不该在这里被「顺手」猜一个值填进去。
 */
export async function fillForm(
  page: Page,
  mappings: readonly FieldMapping[],
  options: FillOptions = {},
): Promise<FillSummary> {
  const results: FillResult[] = [];
  let skipped = 0;

  for (const mapping of mappings) {
    if (mapping.status !== 'filled') {
      skipped += 1;
      continue;
    }
    if (mapping.field.disabled) {
      skipped += 1;
      continue;
    }

    results.push(await fillField(page, mapping.field, mapping.value, options));
  }

  const failed = results.filter((result) => !result.ok).length;
  return { results, filled: results.length - failed, failed, skipped };
}

// ————————————————————————————————————————————————
// Repeatable Section
// ————————————————————————————————————————————————

/** 「添加一条」按钮的常见文案 */
const ADD_BUTTON_PATTERN = /添加|新增|\+\s*增加|add\s+(more|another|item)/i;

/**
 * 在可重复区块中添加条目。
 *
 * **不用索引推算新条目的 selector** —— M2 已经验证过：
 * 删除中间条目后索引不重排，按顺序数第 N 条会拿错元素。
 * 正确做法是添加后重新解析 DOM，用真实存在的 selector。
 *
 * 返回添加后的条目数，调用方据此决定是否需要重新 parse。
 */
export async function addRepeatableEntries(
  page: Page,
  containerSelector: string,
  count: number,
  options: FillOptions = {},
): Promise<number> {
  const container = page.locator(containerSelector);
  const addButton = container.locator('button, a').filter({ hasText: ADD_BUTTON_PATTERN }).first();

  const itemSelector = `${containerSelector} > *`;
  const before = await page.locator(itemSelector).count();

  for (let index = 0; index < count; index += 1) {
    await addButton.click({ timeout: options.timeoutMs ?? DEFAULT_TIMEOUT });
    await page.waitForTimeout(120); // 给动态插入留出渲染时间
  }

  const after = await page.locator(itemSelector).count();
  options.logger?.info('可重复区块已添加条目', {
    container: containerSelector,
    before,
    after,
  });

  return after;
}
