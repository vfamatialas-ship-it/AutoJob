/// <reference lib="dom" />
/**
 * 岗位列表提取 —— 浏览器侧脚本。
 *
 * 本文件是本包内唯一允许使用浏览器全局的地方（ESLint 已就此设限）。
 *
 * ## 怎么在不认识网站的前提下找到「职位列表」
 *
 * 关键洞察：**职位列表一定是重复结构**。一个页面上会有导航链接、
 * 页脚链接、宣讲会推广链接，但只有职位是「同一种结构重复出现很多次」。
 *
 * 所以算法是：
 *   1. 收集全部带 href 的链接
 *   2. 对每个链接向上找「重复祖先」—— 有同结构兄弟节点的那一层
 *   3. 按结构签名分组
 *   4. 给每组打分，取最像职位列表的一组
 *
 * 打分维度刻意保守：宁可漏掉一个奇怪的列表，也不要把导航栏当成职位。
 * 漏掉了用户会发现（列表是空的），认错了用户可能不会发现。
 */

/** 一条候选列表项的原始形态 */
export interface RawJobItem {
  /** 链接文字，通常就是职位名 */
  readonly title: string;
  readonly url: string;
  /** 该条目内除标题外的全部文本，逗号分隔的片段 */
  readonly fields: readonly string[];
  /** 条目完整文本，供兜底解析 */
  readonly text: string;
}

export interface RawJobList {
  /** 该组的结构签名，用于调试与缓存 */
  readonly signature: string;
  readonly items: readonly RawJobItem[];
  /** 该组的得分，越高越像职位列表 */
  readonly score: number;
}

/**
 * 提取页面上所有「重复链接组」，按得分排序。
 *
 * **必须自包含**：会被序列化送进页面执行。
 */
export const EXTRACT_JOB_LIST_SCRIPT = function extractJobLists(): RawJobList[] {
  const clean = (value: string | null | undefined): string =>
    (value ?? '').replace(/\s+/g, ' ').trim();

  /** 元素的结构签名：标签名 + 类名（排序后） */
  const signatureOf = (element: Element): string => {
    const classes = Array.from(element.classList).sort().join('.');
    return classes.length > 0
      ? `${element.tagName.toLowerCase()}.${classes}`
      : element.tagName.toLowerCase();
  };

  /**
   * 向上找「重复祖先」，即列表中的一个条目。
   *
   * 判据不只是「有 >= 3 个同签名兄弟」，还要求**这些兄弟大多也含链接**。
   *
   * 少了后一条会在表格上翻车：一行里有 6 个 `<td>`，它们确实是同签名兄弟，
   * 于是 `td` 被当成条目 —— 结果只抓到职位名，部门、地点、学历全丢了。
   * 而真正的条目是 `<tr>`：它的兄弟（其他行）每一个都含职位链接。
   *
   * 「大多」取 60%：允许列表里夹杂一两个没链接的占位行或分隔行。
   */
  const findRepeatingAncestor = (anchor: Element): Element | undefined => {
    let current: Element | null = anchor;

    for (let depth = 0; depth < 6 && current !== null; depth += 1) {
      const parent: Element | null = current.parentElement;
      if (parent === null) break;

      const signature = signatureOf(current);
      const siblings = Array.from(parent.children).filter(
        (child) => signatureOf(child) === signature,
      );

      if (siblings.length >= 3) {
        const withLink = siblings.filter(
          (sibling) => sibling.querySelector('a[href]') !== null,
        ).length;

        if (withLink >= 3 && withLink / siblings.length >= 0.6) return current;
      }

      current = parent;
    }

    return undefined;
  };

  const groups = new Map<string, { element: Element; anchor: Element }[]>();

  for (const anchor of Array.from(document.querySelectorAll('a[href]'))) {
    const href = anchor.getAttribute('href') ?? '';
    // 锚点、JS 伪链接不是职位
    if (href.length === 0 || href.startsWith('#') || href.startsWith('javascript:')) continue;

    const item = findRepeatingAncestor(anchor);
    if (item === undefined) continue;

    // 分组键要带上父容器，避免不同区块的同类结构被混在一起
    const parentSignature = item.parentElement === null ? '' : signatureOf(item.parentElement);
    const key = `${parentSignature} > ${signatureOf(item)}`;

    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [{ element: item, anchor }]);
    else if (!bucket.some((entry) => entry.element === item)) {
      // 一个条目里可能有多个链接，只取第一个作为标题
      bucket.push({ element: item, anchor });
    }
  }

  const results: RawJobList[] = [];

  for (const [signature, entries] of groups) {
    if (entries.length < 3) continue;

    const items: RawJobItem[] = entries.map(({ element, anchor }) => {
      const title = clean(anchor.textContent);
      const fullText = clean(element.textContent);

      // 条目内除标题外的文本片段。用多种分隔符切，覆盖 td / span / div 各种排布
      const rest = fullText.replace(title, ' ');
      const fields = rest
        .split(/[·|｜/、,，\s]{1,}/)
        .map((part) => part.trim())
        .filter((part) => part.length > 0);

      return {
        title,
        url: anchor.getAttribute('href') ?? '',
        fields,
        text: fullText,
      };
    });

    /*
     * 打分。每一项都在回答「这组东西像不像职位列表」：
     * - 条目多 → 像列表（但边际收益递减，取对数式的分段加分）
     * - 标题长度落在 4–40 字 → 像职位名（导航链接通常 2–4 字，正文链接可能很长）
     * - 链接各不相同 → 像列表（导航栏常有重复 href）
     * - 条目内有额外文本 → 像职位（有地点/部门等元信息）
     */
    const distinctUrls = new Set(items.map((item) => item.url)).size;
    const titleLengths = items.map((item) => item.title.length);
    const plausibleTitles = titleLengths.filter((length) => length >= 4 && length <= 40).length;
    const withMetadata = items.filter((item) => item.fields.length > 0).length;

    const score =
      Math.min(entries.length, 20) * 2 +
      (plausibleTitles / items.length) * 40 +
      (distinctUrls / items.length) * 20 +
      (withMetadata / items.length) * 20;

    results.push({ signature, items, score: Math.round(score * 100) / 100 });
  }

  return results.sort((a, b) => b.score - a.score);
};

/**
 * 点击「加载更多」直到列表不再增长。
 *
 * 懒加载在招聘站很常见。不处理的话只能拿到首屏的几条，
 * 用户会以为这家公司只招 3 个人。
 *
 * **必须自包含**。返回本次点击后的条目总数，由 Node 侧决定是否继续。
 */
export const CLICK_LOAD_MORE_SCRIPT = function clickLoadMore(): {
  clicked: boolean;
  linkCount: number;
} {
  const PATTERN = /加载更多|查看更多|展开更多|更多职位|load\s*more|show\s*more/i;

  const candidates = Array.from(document.querySelectorAll('button, a, div[role="button"]'));
  const target = candidates.find((element) => {
    const text = (element.textContent ?? '').trim();
    if (!PATTERN.test(text)) return false;

    // 已隐藏的按钮说明加载完了
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });

  if (target === undefined) {
    return { clicked: false, linkCount: document.querySelectorAll('a[href]').length };
  }

  (target as HTMLElement).click();
  return { clicked: true, linkCount: document.querySelectorAll('a[href]').length };
};
