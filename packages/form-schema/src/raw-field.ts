/// <reference lib="dom" />
/**
 * RawField —— DOM 提取的原始产物，尚未做语义判断。
 *
 * 本文件是**唯一**允许使用浏览器全局（document / window / Element）的地方，
 * 因为 EXTRACT_FIELDS_SCRIPT 会被送进页面里执行。
 * ESLint 已禁止其他文件使用这些全局，避免 Node 侧代码误用后在运行时才炸。
 *
 * ## 为什么要分成两步
 *
 * 提取必须在**真实浏览器**里做（页面可能是 JS 渲染的，HTML 字符串解析拿不到），
 * 但分类是纯逻辑，应该能脱离浏览器做单元测试。
 *
 * 所以切成：
 *   浏览器侧：DOM → RawField[]        （靠 E2E 测，因为需要真实 DOM）
 *   Node 侧：RawField[] → FormField[]  （纯函数，靠单元测试）
 *
 * RawField 刻意**不做任何判断**，只是把所有可能有用的线索都收集齐，
 * 让分类器在 Node 侧有足够信息可用。
 */

/** label 文本的可能来源，按可靠性从高到低 */
export type LabelSource =
  /** <label for="id"> —— 最可靠，是 HTML 规范的正解 */
  | 'label_for'
  /** <label>文字<input></label> 包裹关系 */
  | 'wrapping_label'
  /** aria-label 属性 */
  | 'aria_label'
  /** 同一行/同一容器内的相邻文本节点 —— 国内招聘站极常见 */
  | 'sibling_text'
  /** placeholder，只在没有任何 label 时才用 */
  | 'placeholder'
  /** 退到 name / id 属性，通常是英文缩写，可信度低 */
  | 'attribute'
  /** 什么都没找到 */
  | 'none';

export interface RawField {
  /** 稳定定位符，供后续填写使用 */
  readonly selector: string;
  readonly tagName: string;
  /** input 的 type，或 'select' / 'textarea' / 'radio-group' / 'checkbox-group' */
  readonly type: string;
  readonly name: string;
  readonly id: string;

  // —— label 的各路候选，全都收集，不在浏览器侧做取舍 ——
  readonly labelFor: string;
  readonly wrappingLabel: string;
  readonly ariaLabel: string;
  readonly siblingText: string;
  readonly placeholder: string;

  /** 所属 fieldset 的 legend，或最近的区块标题 —— 消歧的重要上下文 */
  readonly sectionTitle: string;
  /** 字段附近的提示文字（.hint 之类），常含格式与限制说明 */
  readonly nearbyText: string;

  readonly required: boolean;
  readonly disabled: boolean;
  readonly maxLength: number | undefined;
  /** select 的选项，或 radio/checkbox 组的候选值 */
  readonly options: readonly string[];
  /** radio / checkbox 组名 */
  readonly groupName: string | undefined;
  /** file input 的 accept 属性 */
  readonly accept: string | undefined;
  /** 元素是否可见。隐藏的 file input 仍需保留（PRD：上传控件常被 CSS 藏起来） */
  readonly visible: boolean;
}

/**
 * 浏览器侧提取脚本。
 *
 * **必须自包含**：这个函数会被序列化后送进页面执行，
 * 不能引用模块作用域的任何变量，也不能用 import。
 * 看起来啰嗦，但这是 page.evaluate 的硬约束。
 *
 * 用法：`await page.evaluate(EXTRACT_FIELDS_SCRIPT)`
 */
export const EXTRACT_FIELDS_SCRIPT = function extractRawFields(): RawField[] {
  const clean = (value: string | null | undefined): string =>
    (value ?? '').replace(/\s+/g, ' ').trim();

  /** 生成稳定 selector：id 优先，其次 name，最后退到结构路径 */
  const buildSelector = (element: Element): string => {
    if (element.id) return `#${CSS.escape(element.id)}`;

    const name = element.getAttribute('name');
    if (name) return `${element.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;

    const path: string[] = [];
    let current: Element | null = element;
    while (current && current.tagName !== 'BODY') {
      const parent: Element | null = current.parentElement;
      if (!parent) break;
      const siblings = Array.from(parent.children).filter((c) => c.tagName === current?.tagName);
      const index = siblings.indexOf(current) + 1;
      path.unshift(`${current.tagName.toLowerCase()}:nth-of-type(${index})`);
      current = parent;
    }
    return path.join(' > ');
  };

  /** 取包裹该控件的 <label> 的文本（排除控件自身的值） */
  const getWrappingLabel = (element: Element): string => {
    const label = element.closest('label');
    if (!label) return '';
    const clone = label.cloneNode(true) as HTMLElement;
    for (const control of Array.from(clone.querySelectorAll('input, select, textarea'))) {
      control.remove();
    }
    return clean(clone.textContent);
  };

  /**
   * 找相邻文本。国内招聘站最常见的写法是
   *   <div class="row"><span>手机号码</span><input></div>
   * 所以策略是：向上找到最近的「行」容器，取其中不属于控件的文本。
   */
  const getSiblingText = (element: Element): string => {
    // 「选择文件」这类按钮文案不是字段名，遇到就跳过，改用行容器文本
    const actionWords =
      /^(选择文件|选择|上传文件|上传|浏览|添加|点击上传|未选择文件|choose\s*file|browse|upload)$/i;

    // 先看紧邻的前一个兄弟元素。
    // 要排除 legend 与标题：区块里第一个字段的前一个兄弟往往是 <legend>，
    // 但它是**区块标题**而非字段名（已由 getSectionTitle 单独提取）。
    // 早期版本漏了这一条，导致「可接受的工作地点」被误读成「求职意向」。
    const previous = element.previousElementSibling;
    if (previous && !previous.matches('input, select, textarea, legend, h1, h2, h3, h4')) {
      const text = clean(previous.textContent);
      if (text && !actionWords.test(text)) return text;
    }

    // 再看行容器里剔除控件后剩下的文本
    const row = element.closest('.row, .form-item, .field, li, tr, .q');
    if (!row) return '';
    const clone = row.cloneNode(true) as HTMLElement;
    for (const control of Array.from(clone.querySelectorAll('input, select, textarea, button'))) {
      control.remove();
    }
    return clean(clone.textContent);
  };

  /** 所属区块标题：fieldset legend 优先，否则向上找最近的标题元素 */
  const getSectionTitle = (element: Element): string => {
    const legend = element.closest('fieldset')?.querySelector('legend');
    if (legend) return clean(legend.textContent);

    let current: Element | null = element.parentElement;
    while (current && current.tagName !== 'BODY') {
      const heading = current.querySelector('h1, h2, h3, h4, legend');
      if (heading) return clean(heading.textContent);
      current = current.parentElement;
    }
    return '';
  };

  /** 字段附近的提示文字，常含「限 100 字」「仅支持 PDF」这类关键信息 */
  const getNearbyText = (element: Element): string => {
    const row = element.closest('.row, .form-item, .field, .q');
    const next = row?.nextElementSibling;
    if (next && next.matches('.hint, .tip, .desc, small, p')) return clean(next.textContent);
    return '';
  };

  const isVisible = (element: Element): boolean => {
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return (element as HTMLElement).offsetParent !== null || style.position === 'fixed';
  };

  const fields: RawField[] = [];
  const seenGroups = new Set<string>();

  const controls = Array.from(document.querySelectorAll('input, select, textarea'));

  for (const element of controls) {
    const tagName = element.tagName.toLowerCase();
    const inputType = (element.getAttribute('type') ?? 'text').toLowerCase();
    const name = element.getAttribute('name') ?? '';

    // 跳过无意义的控件
    if (inputType === 'hidden' && !element.id) continue;
    if (inputType === 'submit' || inputType === 'button' || inputType === 'reset') continue;

    // radio / checkbox 按组合并成一个字段
    const isGrouped = inputType === 'radio' || inputType === 'checkbox';
    if (isGrouped && name) {
      if (seenGroups.has(name)) continue;
      seenGroups.add(name);
    }

    let options: string[] = [];
    if (tagName === 'select') {
      options = Array.from(element.querySelectorAll('option'))
        .map((option) => clean(option.textContent))
        .filter((text) => text.length > 0);
    } else if (isGrouped && name) {
      options = Array.from(document.querySelectorAll(`input[name="${CSS.escape(name)}"]`))
        .map((input) => input.getAttribute('value') ?? '')
        .filter((value) => value.length > 0);
    }

    // 分组控件的 label 应取整组的，而不是某一个选项的
    const labelAnchor =
      isGrouped && name ? (element.closest('.row, .q, .form-item') ?? element) : element;

    const labelForElement = element.id
      ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`)
      : null;

    const maxLengthAttr = element.getAttribute('maxlength');
    const maxLength = maxLengthAttr === null ? undefined : Number(maxLengthAttr);

    fields.push({
      selector: buildSelector(element),
      tagName,
      type: tagName === 'input' ? inputType : tagName,
      name,
      id: element.id,
      labelFor: clean(labelForElement?.textContent),
      wrappingLabel: isGrouped ? '' : getWrappingLabel(element),
      ariaLabel: clean(element.getAttribute('aria-label')),
      siblingText: getSiblingText(labelAnchor),
      placeholder: clean(element.getAttribute('placeholder')),
      sectionTitle: getSectionTitle(element),
      nearbyText: getNearbyText(element),
      required:
        element.hasAttribute('required') || Boolean(labelForElement?.classList.contains('req')),
      disabled: element.hasAttribute('disabled'),
      maxLength: maxLength !== undefined && Number.isFinite(maxLength) ? maxLength : undefined,
      options,
      groupName: isGrouped && name ? name : undefined,
      accept: element.getAttribute('accept') ?? undefined,
      visible: isVisible(element),
    });
  }

  return fields;
};
