/**
 * Mapping Rule 与优先级解析 —— PRD §21 / §54。
 *
 * ## 四级优先级
 *
 *   Company Rule  >  ATS Rule  >  Global Rule  >  LLM Guess
 *
 * 越具体的规则越优先。用户在某公司确认过的映射，只对那家公司生效；
 * 确认为「这个 ATS 的通用规律」的，则对所有用同一 ATS 的企业生效 ——
 * 这正是 Mapping Memory 的价值：投一次，后面同类网站都省事。
 *
 * ## 一条不可逾越的界线
 *
 * 规则可以**收紧**，但不能**放开 Experience 自身声明的 shouldNotMapTo**。
 *
 * 理由：shouldNotMapTo 是用户在自己的档案上做的声明（「我的课题绝不算工作经历」），
 * 而 MappingRule 是针对某个网站字段的局部规律。让后者覆盖前者，
 * 意味着一个网站级配置能悄悄改变用户对自己经历的定性 —— 这正是 PRD §74 要防的事。
 * 真想改，去改 Experience 本身，那是显式且全局可见的动作。
 */

import { z } from 'zod';
import { SemanticTypeSchema, type SemanticType } from '@autojob/form-schema';

/** 规则的作用范围，同时也是优先级 */
export const RuleScopeSchema = z.enum(['company', 'ats', 'global']);
export type RuleScope = z.infer<typeof RuleScopeSchema>;

/** 规则来源，用于区分「用户确认的」与「系统内置的」 */
export const RuleOriginSchema = z.enum(['builtin', 'user', 'llm']);
export type RuleOrigin = z.infer<typeof RuleOriginSchema>;

export const MappingRuleSchema = z.object({
  id: z.string().min(1),
  scope: RuleScopeSchema,
  /** scope=ats 时必填，例如 'moka' / 'feishu' */
  atsType: z.string().optional(),
  /** scope=company 时必填 */
  companyId: z.string().optional(),

  /** 命中条件：字段标签的精确文本。与 semanticType 至少给一个 */
  fieldLabel: z.string().optional(),
  /** 命中条件：字段语义类型 */
  semanticType: SemanticTypeSchema.optional(),

  /**
   * 允许进入该字段的候选类型（experienceType / award category）。
   * 留空表示不额外放开，沿用 Profile 自身的 canMapTo。
   */
  allowedCandidateTypes: z.array(z.string()).default([]),
  /** 禁止进入该字段的候选类型。**始终生效，且与 Profile 的 shouldNotMapTo 取并集。** */
  blockedCandidateTypes: z.array(z.string()).default([]),

  origin: RuleOriginSchema.default('user'),
  confidence: z.number().min(0).max(1).default(1),
  note: z.string().default(''),
  createdAt: z.string().datetime().optional(),
});

export type MappingRule = z.infer<typeof MappingRuleSchema>;

const SCOPE_PRIORITY: Record<RuleScope, number> = { company: 3, ats: 2, global: 1 };

export interface RuleContext {
  readonly atsType?: string | undefined;
  readonly companyId?: string | undefined;
}

/** 规则是否适用于当前上下文 */
function isApplicable(rule: MappingRule, context: RuleContext): boolean {
  switch (rule.scope) {
    case 'company':
      return rule.companyId !== undefined && rule.companyId === context.companyId;
    case 'ats':
      return rule.atsType !== undefined && rule.atsType === context.atsType;
    case 'global':
      return true;
  }
}

/** 规则是否命中该字段 */
function matchesField(rule: MappingRule, label: string, semanticType: SemanticType): boolean {
  if (rule.fieldLabel !== undefined && rule.fieldLabel !== label) return false;
  if (rule.semanticType !== undefined && rule.semanticType !== semanticType) return false;
  // 两个条件都没给的规则不匹配任何字段，避免误伤全场
  return rule.fieldLabel !== undefined || rule.semanticType !== undefined;
}

export interface ResolvedRules {
  /** 最高优先级的命中规则，没有则 undefined */
  readonly winner: MappingRule | undefined;
  /** 所有命中规则的 blockedCandidateTypes 并集 —— 阻断是叠加的，不因优先级被覆盖 */
  readonly blocked: ReadonlySet<string>;
  /** 胜出规则放开的类型 */
  readonly allowed: ReadonlySet<string>;
  readonly source: RuleScope | 'none';
}

/**
 * 规则存储。当前是内存实现；M9 接 SQLite 后换成持久化版本，接口不变。
 */
export class MappingRuleStore {
  private readonly rules: MappingRule[] = [];

  constructor(initial: readonly MappingRule[] = []) {
    this.rules.push(...initial);
  }

  add(rule: MappingRule): void {
    this.rules.push(rule);
  }

  all(): readonly MappingRule[] {
    return this.rules;
  }

  /**
   * 解析出对某字段生效的规则。
   *
   * 注意 blocked 取的是**所有命中规则的并集**而不是胜出规则的：
   * 阻断是安全约束，低优先级规则设的阻断不该被高优先级规则悄悄抹掉。
   * 放开（allowed）才遵循优先级，只取胜出者的。
   */
  resolve(label: string, semanticType: SemanticType, context: RuleContext): ResolvedRules {
    const hits = this.rules
      .filter((rule) => isApplicable(rule, context) && matchesField(rule, label, semanticType))
      .sort((a, b) => SCOPE_PRIORITY[b.scope] - SCOPE_PRIORITY[a.scope]);

    const blocked = new Set<string>();
    for (const rule of hits) {
      for (const type of rule.blockedCandidateTypes) blocked.add(type);
    }

    const winner = hits[0];
    return {
      winner,
      blocked,
      allowed: new Set(winner?.allowedCandidateTypes ?? []),
      source: winner?.scope ?? 'none',
    };
  }

  /**
   * Mapping Memory —— 把用户的一次确认沉淀成规则。
   *
   * `scope` 决定复用范围：
   * - 'company'：只对这家公司生效（字段措辞是这家公司独有的）
   * - 'ats'：对所有用同一 ATS 的企业生效（字段来自 ATS 模板，复用价值最大）
   *
   * 由调用方询问用户「以后遇到类似问题是否自动使用该答案」后再决定传哪个（PRD §18）。
   */
  remember(input: {
    scope: RuleScope;
    atsType?: string | undefined;
    companyId?: string | undefined;
    fieldLabel: string;
    semanticType: SemanticType;
    allowedCandidateTypes: readonly string[];
    blockedCandidateTypes?: readonly string[];
    note?: string;
  }): MappingRule {
    const rule = MappingRuleSchema.parse({
      id: `rule_${input.scope}_${input.fieldLabel}_${this.rules.length}`,
      scope: input.scope,
      atsType: input.atsType,
      companyId: input.companyId,
      fieldLabel: input.fieldLabel,
      semanticType: input.semanticType,
      allowedCandidateTypes: [...input.allowedCandidateTypes],
      blockedCandidateTypes: [...(input.blockedCandidateTypes ?? [])],
      origin: 'user',
      confidence: 1,
      note: input.note ?? `用户在「${input.fieldLabel}」上确认的映射`,
    });

    this.add(rule);
    return rule;
  }
}

/**
 * 内置全局规则。
 *
 * 目前只放**加固红线**的阻断规则 —— 即使某个网站把字段叫得再花哨，
 * 这些类型也绝不进受雇栏目。放开类的规则一律留给用户确认后生成，
 * 系统不预设「大概可以」。
 */
export const BUILTIN_GLOBAL_RULES: readonly MappingRule[] = [
  MappingRuleSchema.parse({
    id: 'builtin_work_experience_block',
    scope: 'global',
    semanticType: 'WORK_EXPERIENCE',
    blockedCandidateTypes: [
      'research',
      'research_project',
      'academic_project',
      'personal_project',
      'campus_activity',
      'volunteer',
      'internship',
    ],
    origin: 'builtin',
    note: '工作经历栏禁止填入科研、学术项目、个人项目、社团、志愿与实习',
  }),
  MappingRuleSchema.parse({
    id: 'builtin_internship_block',
    scope: 'global',
    semanticType: 'INTERNSHIP',
    blockedCandidateTypes: ['research', 'research_project', 'academic_project', 'full_time'],
    origin: 'builtin',
    note: '实习栏禁止填入科研与正式工作',
  }),
  MappingRuleSchema.parse({
    id: 'builtin_scholarship_block',
    scope: 'global',
    semanticType: 'SCHOLARSHIP',
    blockedCandidateTypes: ['competition_award', 'honor', 'sports_award'],
    origin: 'builtin',
    note: '奖学金栏禁止填入竞赛奖项与荣誉称号',
  }),
  MappingRuleSchema.parse({
    id: 'builtin_competition_block',
    scope: 'global',
    semanticType: 'COMPETITION_AWARD',
    blockedCandidateTypes: ['scholarship', 'honor'],
    origin: 'builtin',
    note: '竞赛获奖栏禁止填入奖学金与荣誉称号',
  }),
];
