/**
 * ContentAdapter —— PRD §31 内容自适应。
 *
 * 招聘网站对同一段经历的字数要求千差万别：100 字、300 字、不限。
 * Profile 里存的是完整规范内容，这里负责压到目标长度。
 *
 * ## 为什么用抽取式而不是生成式
 *
 * 抽取式 = 从已有句子里**挑**；生成式 = 让模型**写**。
 *
 * 选抽取式的理由不是省钱，而是**结构上不可能编造**：输出的每个字都来自
 * 用户亲手写下的 canonical 内容，不存在「模型顺手加了个 99%」的可能。
 * 生成式再怎么加校验，都是事后拦截；抽取式是从源头堵死。
 *
 * 代价是压缩后的文字可能不如生成式流畅。这个取舍是明确的：
 * **简历失真的代价远大于行文生硬。**
 *
 * 等 M12+ 真的接入 LLM 做改写时，fact-guard 就是那条防线 —— 但即便如此，
 * 抽取式仍会是默认路径，生成式需要用户显式开启。
 *
 * ## 绝不截断句子
 *
 * 宁可少放一句，也不要留下半截话。截断产生的「……成功率从 0.03% 提升」
 * 比信息缺失更糟 —— 它看起来像是完整的，实际却丢了结论。
 */

import { guardGeneratedContent, factSourceFrom, type GuardResult } from './fact-guard.js';

/** 一个可独立取舍的内容单元 */
interface ContentUnit {
  readonly text: string;
  /** 在原文中的位置，用于按原序重组，保证可读性 */
  readonly position: number;
  readonly score: number;
  readonly kind: 'description' | 'achievement' | 'responsibility';
}

/** 可被压缩的记录形态（Experience 与 Project 的公共子集） */
export interface AdaptableRecord {
  readonly id: string;
  readonly name: string;
  readonly organization?: string;
  readonly role?: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly descriptionCanonical: string;
  readonly responsibilities: readonly string[];
  readonly achievements: readonly string[];
  readonly canonicalFacts: ReadonlyArray<{
    id: string;
    statement: string;
    metrics: readonly string[];
  }>;
}

/**
 * 内容侧重。
 *
 * 网站常把项目拆成「项目简介」与「主要成果」两个框。若两边填一样的内容，
 * 既浪费字数又显得敷衍。emphasis 让同一条记录能按需要输出不同侧面。
 */
export type ContentEmphasis =
  /** 全部内容，按重要性取舍 */
  | 'full'
  /** 只要背景与做了什么（描述 + 职责） */
  | 'brief'
  /** 只要产出与量化结果（成果 + 带指标的句子） */
  | 'achievement';

export interface AdaptOptions {
  /** 目标岗位关键词，命中的内容会被优先保留（PRD §31「可以针对岗位强化表达」） */
  readonly targetKeywords?: readonly string[];
  readonly emphasis?: ContentEmphasis;
}

export interface AdaptedContent {
  readonly text: string;
  readonly length: number;
  /** 内容溯源到的 fact id，供 Diff 展示 */
  readonly sourceFactIds: readonly string[];
  /** 被舍弃的单元数，说明压缩强度 */
  readonly droppedUnits: number;
  /** 事实校验结果 —— 抽取式理应永远通过，作为回归防线 */
  readonly guard: GuardResult;
}

const SEPARATOR = '\n';
const ENTRY_SEPARATOR = '\n\n';

/** 中文与英文句子切分。保留句末标点，避免拼回去时读起来断气 */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？；.!?;])\s*/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** 该文本是否包含任一量化指标 */
function containsMetric(text: string, metrics: readonly string[]): boolean {
  const normalized = text.replace(/\s+/g, '');
  return metrics.some(
    (metric) => metric.length > 0 && normalized.includes(metric.replace(/\s+/g, '')),
  );
}

function keywordHits(text: string, keywords: readonly string[]): number {
  const lower = text.toLowerCase();
  return keywords.filter((keyword) => keyword.length > 0 && lower.includes(keyword.toLowerCase()))
    .length;
}

/**
 * 给内容单元打分。分数决定谁在预算紧张时留下。
 *
 * 排序逻辑背后的判断：招聘方最想看到的是**你做出了什么可衡量的结果**，
 * 其次是你负责了什么，最后才是项目背景介绍。
 */
function scoreUnits(record: AdaptableRecord, options: AdaptOptions): ContentUnit[] {
  const metrics = record.canonicalFacts.flatMap((fact) => fact.metrics);
  const keywords = options.targetKeywords ?? [];
  const emphasis = options.emphasis ?? 'full';
  const units: ContentUnit[] = [];
  let position = 0;

  // 成果侧重时不放项目背景描述 —— 那是「简介」栏该说的事
  if (emphasis !== 'achievement') {
    const sentences = splitSentences(record.descriptionCanonical);
    sentences.forEach((text, index) => {
      // 首句通常是项目概述，缺了它读者不知道这是什么，因此权重高于后续句子
      let score = index === 0 ? 50 : 25;
      if (containsMetric(text, metrics)) score += 100;
      score += keywordHits(text, keywords) * 30;
      units.push({ text, position: position++, score, kind: 'description' });
    });
  }

  // 简介侧重时不放成果 —— 那是「主要成果」栏该说的事
  if (emphasis !== 'brief') {
    for (const text of record.achievements) {
      let score = 60;
      if (containsMetric(text, metrics)) score += 100;
      score += keywordHits(text, keywords) * 30;
      units.push({ text: `· ${text}`, position: position++, score, kind: 'achievement' });
    }

    /*
     * 成果侧重时，带量化指标的 fact 陈述也补进来 —— 有些成果只写在 fact 里，
     * achievements 数组未必收录。
     *
     * 去重按**指标**而不是按文字：同一件事常有两种措辞
     * （「单臂抓取成功率 90.4%」与「单臂抓取成功率达到 90.4%」），
     * 字符串包含判不出来，但只要数字已经说过，这条 fact 就没有新信息。
     */
    if (emphasis === 'achievement') {
      const statedMetrics = new Set<string>();
      for (const text of record.achievements) {
        for (const metric of metrics) {
          if (containsMetric(text, [metric])) statedMetrics.add(metric.replace(/\s+/g, ''));
        }
      }

      for (const fact of record.canonicalFacts) {
        if (fact.metrics.length === 0) continue;

        const isRedundant = fact.metrics.every((metric) =>
          statedMetrics.has(metric.replace(/\s+/g, '')),
        );
        if (isRedundant) continue;

        for (const metric of fact.metrics) statedMetrics.add(metric.replace(/\s+/g, ''));
        units.push({
          text: `· ${fact.statement}`,
          position: position++,
          score: 90 + keywordHits(fact.statement, keywords) * 30,
          kind: 'achievement',
        });
      }
    }
  }

  for (const text of record.responsibilities) {
    let score = 40;
    if (containsMetric(text, metrics)) score += 100;
    score += keywordHits(text, keywords) * 30;
    units.push({ text: `· ${text}`, position: position++, score, kind: 'responsibility' });
  }

  return units;
}

const formatDates = (start: string, end: string): string =>
  `${start} — ${end === 'present' ? '至今' : end}`;

/**
 * 生成表头的若干降级版本，由详到简。
 * 预算不够时逐级降级，但**名称永远保留** —— 没有名称的经历等于没写。
 */
function headerVariants(record: AdaptableRecord): string[] {
  const parts = {
    name: record.name,
    org: record.organization ?? '',
    role: record.role ?? '',
    dates: formatDates(record.startDate, record.endDate),
  };

  const join = (items: string[]): string => items.filter((item) => item.length > 0).join(' | ');

  return [
    join([parts.name, parts.org, parts.role, parts.dates]),
    join([parts.name, parts.org, parts.dates]),
    join([parts.name, parts.org]),
    parts.name,
  ];
}

/**
 * 把单条记录压到 maxLength 以内。
 *
 * 返回 undefined 表示连最简形态（仅名称）都放不下 —— 这种情况下
 * 任何输出都是误导，交给调用方决定是整条丢弃还是转人工。
 */
export function adaptRecord(
  record: AdaptableRecord,
  maxLength: number,
  options: AdaptOptions = {},
): AdaptedContent | undefined {
  const headers = headerVariants(record);
  const header = headers.find((variant) => variant.length <= maxLength);
  if (header === undefined) return undefined;

  const units = scoreUnits(record, options);

  /*
   * 侧重模式下，一条记录可能压根没有对应侧面的内容 ——
   * 比如个人开源项目往往没有量化成果，放进「主要成果」栏就只剩一个孤零零的标题。
   * 那样既没信息量又白占字数，不如整条不纳入，把额度让给真有成果的记录。
   *
   * full 模式不做这个判断：那时表头本身（名称+机构+时间）就是有效信息。
   */
  const emphasis = options.emphasis ?? 'full';
  if (emphasis !== 'full' && units.length === 0) return undefined;

  const selected: ContentUnit[] = [];
  let used = header.length;

  // 按分数从高到低尝试装入。同分时短的优先 —— 同样的价值，占地越小越划算
  const ordered = [...units].sort((a, b) =>
    b.score !== a.score ? b.score - a.score : a.text.length - b.text.length,
  );

  for (const unit of ordered) {
    const cost = SEPARATOR.length + unit.text.length;
    if (used + cost > maxLength) continue; // 跳过放不下的，继续看后面更短的
    selected.push(unit);
    used += cost;
  }

  // 装完之后按原文顺序重排，保证读起来是连贯的而不是按重要性跳跃的
  selected.sort((a, b) => a.position - b.position);

  const text = [header, ...selected.map((unit) => unit.text)].join(SEPARATOR);

  // 溯源：输出里出现了哪些 fact 的指标，就记哪些 fact
  const sourceFactIds = record.canonicalFacts
    .filter((fact) => containsMetric(text, fact.metrics) || text.includes(fact.statement))
    .map((fact) => fact.id);

  return {
    text,
    length: text.length,
    sourceFactIds,
    droppedUnits: units.length - selected.length,
    guard: guardGeneratedContent(text, factSourceFrom(record)),
  };
}

export interface AdaptedEntries {
  readonly text: string;
  readonly length: number;
  /** 成功纳入的记录 id */
  readonly includedIds: readonly string[];
  /** 因预算不足被整条舍弃的记录 id */
  readonly droppedIds: readonly string[];
  readonly sourceFactIds: readonly string[];
  readonly guard: GuardResult;
}

/**
 * 把多条记录压进同一个字段。
 *
 * 预算分配策略：先按条数均分，再把用不完的额度回收给还没处理的记录。
 * 这样短记录不会浪费配额，长记录能拿到更多空间。
 *
 * 如果均分后连最简形态都放不下，就从**最旧的记录开始整条舍弃** ——
 * 舍弃整条并明确告知，好过每条都塞半句谁也看不懂。
 */
export function adaptEntries(
  records: readonly AdaptableRecord[],
  maxLength: number,
  options: AdaptOptions = {},
): AdaptedEntries {
  if (records.length === 0) {
    return {
      text: '',
      length: 0,
      includedIds: [],
      droppedIds: [],
      sourceFactIds: [],
      guard: { ok: true, violations: [], checkedCount: 0 },
    };
  }

  // 新的在前：预算紧张时优先保留近期经历
  const byRecency = [...records].sort((a, b) => {
    const value = (end: string): string => (end === 'present' ? '9999-99' : end);
    return value(b.endDate).localeCompare(value(a.endDate));
  });

  /*
   * 先决定「放几条」，再决定「每条放多少」。
   *
   * 早期版本直接把预算均分给全部记录，结果在 100 字的「项目简介」里塞进了
   * 3 条记录 —— 每条都只剩一个名称，通篇没有一句实质内容。三个名字的信息量
   * 还不如一条带成果的完整描述。
   *
   * 所以设一个「最小有用份额」：低于它就宁可少放几条。
   * 60 字大约够放下「名称 | 机构 | 时间」加一句话，是内容开始有意义的门槛。
   */
  const MIN_USEFUL_SHARE = 60;
  const affordable = Math.max(1, Math.floor(maxLength / MIN_USEFUL_SHARE));
  const selected = byRecency.slice(0, affordable);
  const preDropped = byRecency.slice(affordable).map((record) => record.id);

  const pieces: Array<{ id: string; text: string; factIds: readonly string[] }> = [];
  const dropped: string[] = [...preDropped];
  let remainingBudget = maxLength;
  let remainingCount = selected.length;

  for (const record of selected) {
    const separatorCost = pieces.length > 0 ? ENTRY_SEPARATOR.length : 0;
    const share = Math.floor((remainingBudget - separatorCost) / remainingCount);

    const adapted = adaptRecord(record, Math.max(share, 0), options);
    remainingCount -= 1;

    if (adapted === undefined) {
      dropped.push(record.id);
      continue;
    }

    pieces.push({ id: record.id, text: adapted.text, factIds: adapted.sourceFactIds });
    // 没用完的额度回收给后面的记录
    remainingBudget -= adapted.length + separatorCost;
  }

  const text = pieces.map((piece) => piece.text).join(ENTRY_SEPARATOR);

  // 汇总校验：拿全部记录的事实做语料，确认最终文本没有无出处的数字
  const combinedSource = {
    metrics: records.flatMap((record) => record.canonicalFacts.flatMap((fact) => fact.metrics)),
    statements: records.flatMap((record) => record.canonicalFacts.map((fact) => fact.statement)),
    canonicalTexts: records.flatMap((record) => [
      record.descriptionCanonical,
      ...record.responsibilities,
      ...record.achievements,
      record.name,
      record.organization ?? '',
      record.role ?? '',
    ]),
    structuralValues: records.flatMap((record) => [record.startDate, record.endDate]),
  };

  return {
    text,
    length: text.length,
    includedIds: pieces.map((piece) => piece.id),
    droppedIds: dropped,
    sourceFactIds: [...new Set(pieces.flatMap((piece) => piece.factIds))],
    guard: guardGeneratedContent(text, combinedSource),
  };
}
