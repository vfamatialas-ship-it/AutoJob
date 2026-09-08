/**
 * Application Diff 的终端渲染 —— PRD §35 给出的展示形态。
 *
 * ## 渲染的取舍
 *
 * 一份申请表可能有几十个字段。全量平铺会让真正需要注意的东西淹没在
 * 一堆「✓ 姓名」里。所以默认视图**按需要注意的程度分层**：
 *
 *   先看结论（能不能提交）→ 再看警告（系统做了什么判断）
 *   → 再看待办（哪些需要你填）→ 最后才是逐字段明细
 *
 * `--verbose` 才展开全部字段的填写内容。
 */

import type { ApplicationDiff, DiffEntry } from './model.js';

const STATUS_MARK: Record<DiffEntry['status'], string> = {
  filled: '✓',
  skipped: '·',
  ask_user: '?',
};

const SEVERITY_MARK = { info: '·', warn: '⚠', blocker: '✗' } as const;

const RULE = '─'.repeat(58);

/** 单行预览：多行内容压成一行，过长省略 */
function preview(value: string, limit = 46): string {
  const single = value.replace(/\s+/g, ' ').trim();
  return single.length <= limit ? single : `${single.slice(0, limit)}…`;
}

export interface RenderOptions {
  /** 展开全部字段与内容，默认只展示需要注意的部分 */
  readonly verbose?: boolean;
}

export function renderDiff(diff: ApplicationDiff, options: RenderOptions = {}): string {
  const lines: string[] = [];

  lines.push(RULE);
  lines.push(`投递预览  ${diff.company} · ${diff.jobTitle}`);
  lines.push(RULE);
  lines.push('');
  lines.push(
    `字段 ${diff.stats.total} 个：将填写 ${diff.stats.filled}  留空 ${diff.stats.skipped}  待你确认 ${diff.stats.askUser}`,
  );

  // —— 系统做了哪些判断 ——
  const transformations = diff.sections
    .flatMap((section) => section.entries)
    .flatMap((entry) => entry.warnings.map((warning) => ({ entry, warning })));

  const all = [
    ...diff.formWarnings.map((warning) => ({ entry: undefined, warning })),
    ...transformations,
  ];

  if (all.length > 0) {
    lines.push('');
    lines.push(`── 系统做了这些判断（${all.length} 条）`);
    // 阻断级排最前，用户最该先看到
    const order = { blocker: 0, warn: 1, info: 2 } as const;
    for (const { warning } of [...all].sort(
      (a, b) => order[a.warning.severity] - order[b.warning.severity],
    )) {
      lines.push(`   ${SEVERITY_MARK[warning.severity]} ${warning.message}`);
    }
  }

  // —— 需要用户处理的 ——
  const pending = diff.sections
    .flatMap((section) => section.entries)
    .filter((entry) => entry.status === 'ask_user');

  if (pending.length > 0) {
    lines.push('');
    lines.push(`── 需要你确认（${pending.length} 项）`);
    for (const entry of pending) {
      lines.push(`   ? ${entry.fieldLabel}`);
      lines.push(`     ${entry.warnings[0]?.message ?? entry.reason}`);
    }
  }

  // —— 逐字段明细 ——
  lines.push('');
  lines.push('── 字段明细');

  for (const section of diff.sections) {
    lines.push('');
    lines.push(`  【${section.title}】`);

    for (const entry of section.entries) {
      const mark = STATUS_MARK[entry.status];

      if (entry.status === 'filled') {
        lines.push(`   ${mark} ${entry.fieldLabel}  ${preview(entry.value)}`);

        // 溯源：这段内容是从档案里哪几条来的
        if (entry.sources.length > 0) {
          const names = entry.sources.map((source) => `${source.kind}「${source.label}」`);
          lines.push(`       ← ${names.join('，')}`);
        }
      } else {
        lines.push(
          `   ${mark} ${entry.fieldLabel}  ${entry.status === 'skipped' ? '（留空）' : '（待确认）'}`,
        );
        lines.push(`       ${entry.reason}`);
      }

      // 被排除的记录：回答「为什么我的某条经历没出现在这」
      if (options.verbose === true && entry.excluded.length > 0) {
        for (const item of entry.excluded) {
          lines.push(`       ✗ ${item.source.kind}「${item.source.label}」：${item.reason}`);
        }
      }

      if (options.verbose === true && entry.status === 'filled' && entry.value.includes('\n')) {
        for (const line of entry.value.split('\n')) {
          lines.push(`       │ ${line}`);
        }
      }
    }
  }

  // —— 结论 ——
  lines.push('');
  lines.push(RULE);
  if (diff.submittable) {
    lines.push('可以提交。请在浏览器中核对后由你自己点击提交按钮。');
  } else {
    const reasons: string[] = [];
    if (diff.stats.blockers > 0) reasons.push(`${diff.stats.blockers} 个阻断问题`);
    if (diff.stats.askUser > 0) reasons.push(`${diff.stats.askUser} 个字段待确认`);
    lines.push(`暂不建议提交：${reasons.join('，')}。`);
  }
  lines.push(RULE);

  return lines.join('\n');
}

/**
 * 精简版：只列出「系统做了什么判断」。
 * 适合填写完成后的即时提示，不打断用户注意力。
 */
export function renderTransformationsOnly(diff: ApplicationDiff): string {
  const warnings = [
    ...diff.formWarnings,
    ...diff.sections.flatMap((section) => section.entries.flatMap((entry) => entry.warnings)),
  ];

  if (warnings.length === 0) return '所有字段均为直接映射，系统未做任何转换。';

  return warnings
    .map((warning) => `${SEVERITY_MARK[warning.severity]} ${warning.message}`)
    .join('\n');
}
