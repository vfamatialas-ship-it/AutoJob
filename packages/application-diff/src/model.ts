/**
 * Application Diff 数据模型 —— PRD §35 / §59。
 *
 * 「这是核心 UI。」「用户能够明确知道系统做了哪些转换。」
 *
 * ## Diff 到底在回答什么
 *
 * 不是「表单里现在是什么」—— 那看页面就行。Diff 要回答的是**三个更难的问题**：
 *
 *   1. 这一栏的内容，是从我档案里的**哪条记录**来的？
 *   2. 我的某条经历，**为什么没有**出现在我以为该出现的地方？
 *   3. 系统**擅自做了什么判断**？（降级、合并、压缩、省略）
 *
 * 前两个靠 sourceRecordIds / excluded 的双向溯源，第三个靠 warning。
 * 三者齐了，用户点「确认提交」时才是真的知情。
 *
 * ## 为什么不做成文本差异
 *
 * 传统 diff 比较两个版本的文本。这里没有「旧版本」——
 * 要比较的是**候选人档案**与**网页表单**这两个异构结构。
 * 所以它本质是一张对照表：左边 Profile 记录，右边网页字段，中间是转换说明。
 */

import type { FieldMapping, FormPlan, MappingWarning } from '@autojob/form-mapper';
import type { CandidateProfile } from '@autojob/candidate-profile';

/** 一条 Profile 记录在 Diff 中的展示形态 */
export interface DiffSource {
  readonly recordId: string;
  /** 人能看懂的名称，例如「国家奖学金」 */
  readonly label: string;
  /** 记录类型：经历 / 项目 / 奖项 / 附件 / 问答 */
  readonly kind: string;
}

/** 一个网页字段的 Diff 条目 */
export interface DiffEntry {
  readonly fieldLabel: string;
  readonly selector: string;
  readonly semanticType: string;
  readonly section: string;
  readonly status: FieldMapping['status'];
  /** 将要填入的内容。ask_user / skipped 时为空 */
  readonly value: string;
  /** 内容来自哪些 Profile 记录 */
  readonly sources: readonly DiffSource[];
  /** 哪些记录被排除了，以及为什么 */
  readonly excluded: ReadonlyArray<{ source: DiffSource; reason: string }>;
  readonly warnings: readonly MappingWarning[];
  readonly reason: string;
}

export interface ApplicationDiff {
  readonly company: string;
  readonly jobTitle: string;
  readonly url: string;
  /** 按页面区块分组的条目 */
  readonly sections: ReadonlyArray<{ title: string; entries: readonly DiffEntry[] }>;
  /** 跨字段的整体说明（如「本站没有科研栏」） */
  readonly formWarnings: readonly MappingWarning[];
  readonly stats: {
    readonly total: number;
    readonly filled: number;
    readonly skipped: number;
    readonly askUser: number;
    readonly blockers: number;
  };
  /** 是否可以进入提交流程 */
  readonly submittable: boolean;
}

/** 把 Profile 里的各类记录建成 id → 展示信息的索引 */
function buildSourceIndex(profile: CandidateProfile): Map<string, DiffSource> {
  const index = new Map<string, DiffSource>();

  for (const item of profile.experiences) {
    index.set(item.id, { recordId: item.id, label: item.name, kind: '经历' });
  }
  for (const item of profile.projects) {
    index.set(item.id, { recordId: item.id, label: item.name, kind: '项目' });
  }
  for (const item of profile.awards) {
    index.set(item.id, { recordId: item.id, label: item.name, kind: '奖项' });
  }
  for (const item of profile.assets) {
    index.set(item.id, { recordId: item.id, label: item.name, kind: '附件' });
  }
  for (const item of profile.questions) {
    index.set(item.id, { recordId: item.id, label: item.canonicalQuestion, kind: '问答' });
  }
  for (const item of profile.referralCodes) {
    index.set(item.id, { recordId: item.id, label: `${item.companyName} 内推码`, kind: '内推码' });
  }

  return index;
}

const unknownSource = (recordId: string): DiffSource => ({
  recordId,
  label: recordId,
  kind: '未知',
});

export interface BuildDiffOptions {
  readonly company: string;
  readonly jobTitle: string;
  readonly url: string;
}

export function buildDiff(
  plan: FormPlan,
  profile: CandidateProfile,
  options: BuildDiffOptions,
): ApplicationDiff {
  const index = buildSourceIndex(profile);
  const resolve = (id: string): DiffSource => index.get(id) ?? unknownSource(id);

  const entries: DiffEntry[] = plan.mappings.map((mapping) => ({
    fieldLabel: mapping.field.label,
    selector: mapping.field.selector,
    semanticType: mapping.field.semanticType,
    section: mapping.field.section,
    status: mapping.status,
    value: mapping.value,
    sources: mapping.sourceRecordIds.map(resolve),
    excluded: mapping.excluded.map((item) => ({
      source: resolve(item.recordId),
      reason: item.reason,
    })),
    warnings: mapping.warnings,
    reason: mapping.reason,
  }));

  // 按页面区块分组，顺序沿用字段在页面上的出现顺序
  const grouped = new Map<string, DiffEntry[]>();
  for (const entry of entries) {
    const title = entry.section.length > 0 ? entry.section : '其他';
    const bucket = grouped.get(title);
    if (bucket === undefined) grouped.set(title, [entry]);
    else bucket.push(entry);
  }

  const allWarnings = [...plan.formWarnings, ...entries.flatMap((entry) => entry.warnings)];
  const blockers = allWarnings.filter((item) => item.severity === 'blocker').length;

  const stats = {
    total: entries.length,
    filled: entries.filter((entry) => entry.status === 'filled').length,
    skipped: entries.filter((entry) => entry.status === 'skipped').length,
    askUser: entries.filter((entry) => entry.status === 'ask_user').length,
    blockers,
  };

  return {
    company: options.company,
    jobTitle: options.jobTitle,
    url: options.url,
    sections: [...grouped].map(([title, sectionEntries]) => ({ title, entries: sectionEntries })),
    formWarnings: plan.formWarnings,
    stats,
    // 有阻断级问题或有待确认字段时，不该进入提交流程（PRD §3.7）
    submittable: blockers === 0 && stats.askUser === 0,
  };
}

/** 找出所有「非直接映射」的条目 —— 这些是最需要用户过目的 */
export function findTransformations(diff: ApplicationDiff): DiffEntry[] {
  return diff.sections
    .flatMap((section) => section.entries)
    .filter((entry) => entry.warnings.length > 0);
}
