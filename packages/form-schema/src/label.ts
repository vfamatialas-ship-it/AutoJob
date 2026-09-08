/**
 * label 归因 —— 决定「这个输入框到底叫什么」。
 *
 * 这是整个解析链路里最容易翻车的一环。Mock 站里三种真实写法各不相同：
 *   A 公司：<span>手机号码</span><input>        没有 label for
 *   B 公司：<input aria-label="GitHub 地址">     页面上完全看不到文字
 *   C 公司：<input placeholder="请输入手机号">   只有占位符
 *
 * 策略是**带出处的多级回退**：不仅给出 label 文本，还标明它是从哪儿来的，
 * 以及这个来源有多可信。后者会乘进最终置信度 ——
 * 从 placeholder 猜出来的语义，天然就该比从 <label for> 读出来的更不自信。
 */

import type { LabelSource, RawField } from './raw-field.js';

/** 各来源的可信度。数值不是拍脑袋，而是按「误判概率」排的。 */
export const LABEL_SOURCE_CONFIDENCE: Readonly<Record<LabelSource, number>> = {
  label_for: 1.0, // HTML 规范的正解，几乎不会错
  wrapping_label: 0.98, // 同样是规范用法
  aria_label: 0.95, // 明确的无障碍标注，作者是有意写的
  sibling_text: 0.88, // 靠位置推断，可能夹带无关文字
  placeholder: 0.8, // 常是示例值而非字段名（如「张三」）
  attribute: 0.4, // name="f1" 这种毫无信息量
  none: 0,
};

export interface ResolvedLabel {
  readonly text: string;
  readonly source: LabelSource;
  readonly confidence: number;
}

/**
 * 动作词 / 状态词 —— 它们是按钮文案或状态提示，不是字段名。
 *
 * 上传控件的典型写法是：
 *   <span>个人简历</span>
 *   <label class="trigger" for="up-resume">选择文件</label>
 *   <input type="file" id="up-resume" hidden>
 *
 * 这里的 `<label for>` 虽然符合规范，文本却是「选择文件」——
 * 如果照单全收，字段名就成了「选择文件」，语义完全丢失。
 * 所以命中这个列表的候选一律跳过，继续向下一级回退。
 */
const ACTION_LABEL_PATTERN =
  /^(选择文件|选择|上传文件|上传|浏览|添加|点击上传|未选择文件|choose\s*file|browse|upload|select)$/i;

/** 从相邻文本里剔除按钮与状态文案，避免「个人简历 选择文件 未选择文件」这种噪声 */
const NOISE_FRAGMENT_PATTERN = /(选择文件|未选择文件|点击上传|上传文件|choose file|browse)/gi;

export const isActionLabel = (text: string): boolean => ACTION_LABEL_PATTERN.test(text.trim());

/** 清掉必填星号、冒号、序号等装饰，只留字段名本身 */
export function normalizeLabelText(raw: string): string {
  return raw
    .replace(/[*＊]/g, '')
    .replace(/^\s*\d+\s*[.、）)]\s*/, '') // 「1. 是否服从职位调剂？」→「是否服从职位调剂？」
    .replace(/[:：]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 相邻文本经常把提示语一起带进来，例如
 *   「手机号码 请输入 11 位手机号」
 * 这里做保守裁剪：只取第一段（按空格/换行切分后的首个有效片段）。
 * 保守是有意的 —— 宁可少截，也不要把真正的字段名切掉。
 */
function trimSiblingNoise(text: string): string {
  const denoised = text.replace(NOISE_FRAGMENT_PATTERN, ' ');
  const normalized = normalizeLabelText(denoised);
  if (normalized.length <= 12) return normalized;

  const firstSegment = normalized.split(/\s{2,}|[，。；]/)[0]?.trim() ?? normalized;
  return firstSegment.length > 0 ? firstSegment : normalized;
}

/**
 * 按可靠性依次尝试各来源，第一个非空的胜出。
 *
 * 顺序固定且不可配置 —— 这是规范优先级，不是偏好问题。
 */
export function resolveLabel(field: RawField): ResolvedLabel {
  const candidates: ReadonlyArray<readonly [LabelSource, string]> = [
    ['label_for', field.labelFor],
    ['wrapping_label', field.wrappingLabel],
    ['aria_label', field.ariaLabel],
    ['sibling_text', trimSiblingNoise(field.siblingText)],
    ['placeholder', field.placeholder],
  ];

  for (const [source, raw] of candidates) {
    const text = normalizeLabelText(raw);
    // 命中动作词说明这是按钮文案而非字段名，继续向下回退
    if (text.length > 0 && !isActionLabel(text)) {
      return { text, source, confidence: LABEL_SOURCE_CONFIDENCE[source] };
    }
  }

  // 最后退到属性名。英文缩写信息量低，但聊胜于无
  const attribute = normalizeLabelText(field.name || field.id);
  if (attribute.length > 0) {
    return { text: attribute, source: 'attribute', confidence: LABEL_SOURCE_CONFIDENCE.attribute };
  }

  return { text: '', source: 'none', confidence: 0 };
}

/**
 * 分类时可参考的完整文本上下文。
 *
 * 区块标题很关键：同样是「名称」，在「教育背景」区块下是学校名，
 * 在「项目经历」区块下是项目名。单看 label 无法区分。
 */
export function buildClassificationContext(field: RawField): string {
  const label = resolveLabel(field);
  return [label.text, field.sectionTitle, field.nearbyText, field.placeholder]
    .filter((part) => part.length > 0)
    .join(' | ');
}
