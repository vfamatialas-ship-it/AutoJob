/**
 * 表单校验 —— PRD §34「填写完成后不能直接 Submit，必须进行 Validation」。
 *
 * 这一步读的是**填写之后浏览器里的真实状态**，而不是我们以为填了什么。
 * 两者会不一致的常见原因：前端 JS 把值清空了、格式校验失败、
 * 自定义控件只改了显示文本没改真实值、上传被前端拒绝。
 *
 * 校验只报告不修复 —— 修复策略由上层决定（重填、转人工、还是放弃）。
 */

import type { Page } from 'playwright';
import type { FormField } from '@autojob/form-schema';

export const ValidationCode = {
  REQUIRED_EMPTY: 'REQUIRED_EMPTY',
  INVALID_DATE: 'INVALID_DATE',
  INVALID_PHONE: 'INVALID_PHONE',
  INVALID_EMAIL: 'INVALID_EMAIL',
  TOO_LONG: 'TOO_LONG',
  DROPDOWN_NOT_SELECTED: 'DROPDOWN_NOT_SELECTED',
  RADIO_NOT_SELECTED: 'RADIO_NOT_SELECTED',
  UPLOAD_MISSING: 'UPLOAD_MISSING',
  /** 页面上出现了前端渲染的错误提示 */
  SITE_REPORTED_ERROR: 'SITE_REPORTED_ERROR',
} as const;

export type ValidationCode = (typeof ValidationCode)[keyof typeof ValidationCode];

export interface ValidationIssue {
  readonly code: ValidationCode;
  readonly selector: string;
  readonly label: string;
  readonly message: string;
}

const PHONE_PATTERN = /^1[3-9]\d{9}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 读取字段在页面上的当前值 */
async function readValue(page: Page, field: FormField): Promise<string> {
  try {
    if (field.kind === 'radio' || field.kind === 'checkbox') {
      const groupName = field.groupName;
      if (groupName === undefined) return '';
      const values = await page
        .locator(`input[name="${groupName}"]:checked`)
        .evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).value));
      return values.join(',');
    }

    if (field.kind === 'file') {
      const names = await page
        .locator(field.selector)
        .evaluate((node) =>
          Array.from((node as HTMLInputElement).files ?? []).map((file) => file.name),
        );
      return names.join(',');
    }

    return await page.inputValue(field.selector);
  } catch {
    return '';
  }
}

export async function validateForm(
  page: Page,
  fields: readonly FormField[],
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];

  for (const field of fields) {
    if (field.disabled) continue;

    const value = (await readValue(page, field)).trim();
    const base = { selector: field.selector, label: field.label };

    if (field.required && value.length === 0) {
      const code =
        field.kind === 'file'
          ? ValidationCode.UPLOAD_MISSING
          : field.kind === 'select'
            ? ValidationCode.DROPDOWN_NOT_SELECTED
            : field.kind === 'radio'
              ? ValidationCode.RADIO_NOT_SELECTED
              : ValidationCode.REQUIRED_EMPTY;

      issues.push({ ...base, code, message: `必填项「${field.label}」为空` });
      continue;
    }

    if (value.length === 0) continue;

    if (field.maxLength !== undefined && value.length > field.maxLength) {
      issues.push({
        ...base,
        code: ValidationCode.TOO_LONG,
        message: `「${field.label}」长度 ${value.length} 超过上限 ${field.maxLength}`,
      });
    }

    if (field.semanticType === 'PHONE' && !PHONE_PATTERN.test(value)) {
      issues.push({
        ...base,
        code: ValidationCode.INVALID_PHONE,
        message: `「${field.label}」不是合法的手机号格式`,
      });
    }

    if (field.semanticType === 'EMAIL' && !EMAIL_PATTERN.test(value)) {
      issues.push({
        ...base,
        code: ValidationCode.INVALID_EMAIL,
        message: `「${field.label}」不是合法的邮箱格式`,
      });
    }

    if (field.kind === 'date' && !DATE_PATTERN.test(value)) {
      issues.push({
        ...base,
        code: ValidationCode.INVALID_DATE,
        message: `「${field.label}」日期格式应为 YYYY-MM-DD，实际「${value}」`,
      });
    }
  }

  issues.push(...(await collectSiteErrors(page)));
  return issues;
}

/**
 * 抓取页面上前端渲染的错误提示。
 *
 * 网站自己的校验往往比我们的规则更严（也更权威），
 * 它报的错必须被看见，不能因为「我们这边检查都过了」就忽略。
 */
async function collectSiteErrors(page: Page): Promise<ValidationIssue[]> {
  const texts = await page
    .locator('.error, .field-error, .form-error, [role="alert"], .el-form-item__error')
    .evaluateAll((nodes) =>
      nodes
        .map((node) => (node.textContent ?? '').trim())
        .filter((text) => text.length > 0 && text.length < 200),
    );

  return [...new Set(texts)].map((text) => ({
    code: ValidationCode.SITE_REPORTED_ERROR,
    selector: '',
    label: '',
    message: `网站提示：${text}`,
  }));
}

export const hasIssues = (issues: readonly ValidationIssue[]): boolean => issues.length > 0;

export function formatIssues(issues: readonly ValidationIssue[]): string {
  if (issues.length === 0) return '  ✓ 表单校验通过';
  return issues.map((issue) => `  ✗ [${issue.code}] ${issue.message}`).join('\n');
}
