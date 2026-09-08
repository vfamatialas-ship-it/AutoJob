/**
 * Canonical Facts 校验器 —— PRD §3.5 / §11 / §31 的执行点。
 *
 * 「LLM 不得编造技能、经历、工作时间、奖项、量化成果、证书。」
 *
 * ## 为什么盯着数字
 *
 * 简历失真有很多种，但**编造量化成果**是后果最严重的一种：
 * 「成功率 90.4%」写成「99%」，面试时一问就穿帮，且性质接近造假。
 * 而数字恰好是最容易机械校验的 —— 它要么在事实库里，要么不在。
 *
 * 所以本文件的核心是：**生成文本里出现的每一个数字，都必须能在
 * Canonical Facts 中找到出处**。找不到就是违规，拒绝使用该内容。
 *
 * ## 这不是万能的
 *
 * 校验器管不住「把实习说成正职」这类不含数字的失真 —— 那由 M1 的
 * 语义标签与 M4 的映射红线负责。三者各管一段，不重叠也不互相替代。
 */

/** 从文本中抽取所有数值形态的片段 */
export function extractNumerics(text: string): string[] {
  const found = new Set<string>();

  // 百分比、小数、整数、带单位的数量（含中文单位）
  const patterns: readonly RegExp[] = [
    /\d+(?:\.\d+)?%/g, // 90.4%
    /\d+(?:\.\d+)?\s*(?:倍|万|亿|千|百|条|项|个|次|人|天|月|年|篇|件)/g, // 200 条
    /\d+(?:\.\d+)?/g, // 裸数字兜底
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      found.add(match[0].replace(/\s+/g, ''));
    }
  }

  return [...found];
}

/** 事实来源：可信文本的集合。生成内容中的数字必须在这些文本里出现过。 */
export interface FactSource {
  /** canonicalFacts 的 metrics，最权威 */
  readonly metrics: readonly string[];
  /** canonicalFacts 的原始陈述 */
  readonly statements: readonly string[];
  /** 规范描述、职责、成果等用户亲自写下的文本 */
  readonly canonicalTexts: readonly string[];
  /** 日期等结构化字段，它们含数字但显然不是编造 */
  readonly structuralValues: readonly string[];
}

export interface FactViolation {
  /** 找不到出处的数值片段 */
  readonly numeric: string;
  /** 该片段所在的句子，便于定位 */
  readonly context: string;
}

export interface GuardResult {
  readonly ok: boolean;
  readonly violations: readonly FactViolation[];
  /** 校验覆盖到的数值个数，用于确认校验确实跑了 */
  readonly checkedCount: number;
}

/** 把所有可信文本拼成一个可搜索的语料 */
function buildCorpus(source: FactSource): string {
  return [
    ...source.metrics,
    ...source.statements,
    ...source.canonicalTexts,
    ...source.structuralValues,
  ]
    .join('\n')
    .replace(/\s+/g, '');
}

/**
 * 校验生成内容是否只使用了已有事实中的数字。
 *
 * 比较时去掉全部空白 —— 「200 条」与「200条」是同一个事实，
 * 不该因为排版差异被判成编造。
 */
export function guardGeneratedContent(generated: string, source: FactSource): GuardResult {
  const corpus = buildCorpus(source);
  const numerics = extractNumerics(generated);
  const violations: FactViolation[] = [];

  for (const numeric of numerics) {
    if (corpus.includes(numeric)) continue;

    // 找出它所在的句子，让报错能直接定位
    const sentence =
      generated
        .split(/[。；\n]/)
        .find((part) => part.replace(/\s+/g, '').includes(numeric))
        ?.trim() ?? generated.slice(0, 60);

    violations.push({ numeric, context: sentence });
  }

  return { ok: violations.length === 0, violations, checkedCount: numerics.length };
}

/** 从 Profile 记录构造事实来源 */
export function factSourceFrom(record: {
  canonicalFacts?: ReadonlyArray<{ statement: string; metrics: readonly string[] }>;
  descriptionCanonical?: string;
  responsibilities?: readonly string[];
  achievements?: readonly string[];
  name?: string;
  organization?: string;
  role?: string;
  startDate?: string;
  endDate?: string;
}): FactSource {
  const facts = record.canonicalFacts ?? [];

  return {
    metrics: facts.flatMap((fact) => fact.metrics),
    statements: facts.map((fact) => fact.statement),
    canonicalTexts: [
      record.descriptionCanonical ?? '',
      ...(record.responsibilities ?? []),
      ...(record.achievements ?? []),
      record.name ?? '',
      record.organization ?? '',
      record.role ?? '',
    ].filter((text) => text.length > 0),
    structuralValues: [record.startDate ?? '', record.endDate ?? ''].filter(
      (value) => value.length > 0,
    ),
  };
}

export function formatViolations(violations: readonly FactViolation[]): string {
  return violations
    .map((item) => `  ✗ 数值「${item.numeric}」在 Canonical Facts 中找不到出处：${item.context}`)
    .join('\n');
}
