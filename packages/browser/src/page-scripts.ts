/// <reference lib="dom" />
/**
 * 浏览器侧脚本集中处。
 *
 * 这些函数会被序列化后送进页面执行，因此：
 * - **必须自包含**，不能引用模块作用域的任何变量
 * - 是本包内唯一允许使用 document / window 的地方（ESLint 已就此设限）
 *
 * 把它们集中在一个文件而不是散落在各处，是为了让「哪些代码跑在页面里」
 * 一目了然 —— 这类代码的调试成本远高于 Node 侧，值得单独隔离。
 */

/** 读取页面可见文本，用于登录/验证码检测。截断以免超大页面拖慢序列化。 */
export const READ_BODY_TEXT = (): string => document.body?.innerText?.slice(0, 4000) ?? '';

/** 读取页面标题与 URL，用于日志与截图命名 */
export const READ_PAGE_META = (): { title: string; url: string } => ({
  title: document.title,
  url: window.location.href,
});

/** 页面是否还有进行中的网络请求指示器（骨架屏 / loading 遮罩），用于判断是否加载完 */
export const HAS_LOADING_INDICATOR = (): boolean =>
  document.querySelector('.loading, .spinner, .skeleton, [aria-busy="true"]') !== null;
