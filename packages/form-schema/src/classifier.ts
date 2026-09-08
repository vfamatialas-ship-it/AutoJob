/**
 * 语义分类器 —— RawField → FormField。
 *
 * 纯函数，不碰 DOM，因此可以完整单元测试。
 *
 * ## 置信度是怎么算出来的
 *
 *   最终置信度 = 规则置信度 × label 来源可信度
 *
 * 两个乘数缺一不可：
 * - 规则再确定，如果 label 是从 placeholder 猜的，整体就该打折
 * - label 再可靠，如果规则本身就模糊（「实践经历」），照样低
 *
 * 举例：C 公司的手机号只有 placeholder「请输入手机号」
 *   规则 0.96（PHONE 很明确）× 来源 0.8（placeholder）= 0.77 → auto_with_warning
 * 结果是「填，但在 Diff 里标出来让用户看一眼」—— 正是想要的行为。
 */

import { ATTACHMENT_RULES, CLASSIFICATION_RULES, type ClassificationRule } from './rules.js';
import { buildClassificationContext, resolveLabel } from './label.js';
import {
  computePageSignature,
  type FieldKind,
  type FormField,
  type ParsedForm,
} from './form-field.js';
import type { RawField } from './raw-field.js';
import type { SemanticType } from './semantic-type.js';

/** RawField 的 type → FormField.kind */
function toFieldKind(raw: RawField): FieldKind {
  if (raw.tagName === 'textarea') return 'textarea';
  if (raw.tagName === 'select') return 'select';

  switch (raw.type) {
    case 'radio':
      return 'radio';
    case 'checkbox':
      return 'checkbox';
    case 'date':
    case 'month':
      return 'date';
    case 'number':
      return 'number';
    case 'file':
      return 'file';
    case 'url':
      return 'url';
    case 'email':
      return 'email';
    case 'tel':
      return 'tel';
    case 'text':
      return 'text';
    default:
      return 'unknown';
  }
}

interface RuleMatch {
  readonly semanticType: SemanticType;
  readonly confidence: number;
  readonly note: string;
}

/**
 * 在规则表中查找第一个命中的规则。
 *
 * 先只拿 label 匹配，没命中再带上区块标题等上下文重试。
 * 分两轮是为了避免上下文里的无关词抢先命中 ——
 * 例如「项目经历」区块下的「名称」字段，如果一上来就拼上下文，
 * 会被 PROJECT_EXPERIENCE 吃掉，但它其实只是个项目名称输入框。
 */
function matchRules(
  label: string,
  context: string,
  rules: readonly ClassificationRule[],
): { match: RuleMatch; matchedOn: 'label' | 'context' } | undefined {
  for (const rule of rules) {
    if (rule.pattern.test(label)) {
      return {
        match: { semanticType: rule.semanticType, confidence: rule.confidence, note: rule.note },
        matchedOn: 'label',
      };
    }
  }

  for (const rule of rules) {
    if (rule.pattern.test(context)) {
      return {
        // 靠上下文命中的，可信度打七折 —— 它是推断而非直接读到
        match: {
          semanticType: rule.semanticType,
          confidence: rule.confidence * 0.7,
          note: `${rule.note}（依据区块上下文推断）`,
        },
        matchedOn: 'context',
      };
    }
  }

  return undefined;
}

export interface ClassifyOptions {
  /** 该字段是否位于可重复区块内 */
  readonly repeatable?: boolean;
}

/** 单个字段的分类。 */
export function classifyField(raw: RawField, options: ClassifyOptions = {}): FormField {
  const label = resolveLabel(raw);
  const context = buildClassificationContext(raw);
  const kind = toFieldKind(raw);

  // 附件字段走独立规则表：同样是「作品集」，file input 是附件，url input 是链接
  const rules = kind === 'file' ? ATTACHMENT_RULES : CLASSIFICATION_RULES;
  const found = matchRules(label.text, context, rules);

  let semanticType: SemanticType = 'OTHER';
  let ruleConfidence = 0;
  let reason: string;

  if (found) {
    semanticType = found.match.semanticType;
    ruleConfidence = found.match.confidence;
    reason = `${found.match.note}｜label「${label.text}」来自 ${label.source}`;
  } else if (kind === 'file') {
    // 是附件但认不出类型，不能瞎传文件
    semanticType = 'OTHER';
    reason = `未能识别附件类型｜label「${label.text}」来自 ${label.source}`;
  } else {
    reason = `无规则命中｜label「${label.text}」来自 ${label.source}`;
  }

  const confidence = Number((ruleConfidence * label.confidence).toFixed(4));

  return {
    id: raw.selector,
    selector: raw.selector,
    label: label.text,
    labelSource: label.source,
    kind,
    semanticType,
    confidence,
    reason,
    required: raw.required,
    disabled: raw.disabled,
    visible: raw.visible,
    section: raw.sectionTitle,
    options: [...raw.options],
    ...(raw.maxLength === undefined ? {} : { maxLength: raw.maxLength }),
    ...(raw.accept === undefined ? {} : { accept: raw.accept }),
    ...(raw.groupName === undefined ? {} : { groupName: raw.groupName }),
    repeatable: options.repeatable ?? false,
  };
}

/** 批量分类并组装成 ParsedForm。 */
export function classifyForm(url: string, rawFields: readonly RawField[]): ParsedForm {
  const fields = rawFields.map((raw) => classifyField(raw));
  return { url, fields, pageSignature: computePageSignature(fields) };
}

/**
 * 分类结果统计 —— 供 CLI 与 Diff 展示「这个页面解析得怎么样」。
 */
export interface ClassificationSummary {
  readonly total: number;
  readonly auto: number;
  readonly autoWithWarning: number;
  readonly askUser: number;
  readonly unrecognized: number;
}

export function summarize(fields: readonly FormField[]): ClassificationSummary {
  let auto = 0;
  let autoWithWarning = 0;
  let askUser = 0;
  let unrecognized = 0;

  for (const field of fields) {
    if (field.semanticType === 'OTHER') unrecognized += 1;
    if (field.confidence >= 0.9) auto += 1;
    else if (field.confidence >= 0.7) autoWithWarning += 1;
    else askUser += 1;
  }

  return { total: fields.length, auto, autoWithWarning, askUser, unrecognized };
}
