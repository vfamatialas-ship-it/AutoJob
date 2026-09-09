/**
 * 浏览器会话 —— PRD §25。
 *
 * ## 三条硬约束
 *
 * 1. **Headful**：用户要能看见页面在做什么，随时可以接管。无头模式既不透明，
 *    也更容易被招聘网站的反自动化策略识别。
 * 2. **Persistent Context**：cookies / localStorage / sessionStorage 存在本地
 *    profile 目录，登录一次之后长期复用，避免反复扫码。
 * 3. **禁止绕过验证码**（PRD §74）。本文件只负责**检测**登录/验证码并转
 *    WAITING_USER，绝不实现任何自动识别或绕过逻辑。
 */

import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { BrowserContext, Page, chromium as ChromiumType } from 'playwright';
import { AutoJobError, ErrorCode, requireExternal, type Logger } from '@autojob/core';
import { READ_BODY_TEXT } from './page-scripts.js';

/** 默认的浏览器 profile 目录。个人数据留在本地（PRD §41） */
export const DEFAULT_PROFILE_DIR = join(homedir(), '.autojob', 'browser-profile');

export interface SessionOptions {
  readonly profileDir?: string;
  /** 默认 false（headful）。仅测试环境可设为 true */
  readonly headless?: boolean;
  readonly logger?: Logger;
  /** 单个操作的超时（毫秒） */
  readonly timeout?: number;
  readonly locale?: string;
}

export interface BrowserSession {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly profileDir: string;
  close(): Promise<void>;
}

/**
 * 启动持久化浏览器会话。
 *
 * 用 launchPersistentContext 而不是 launch + newContext：
 * 前者才会把登录态真正写进磁盘 profile，后者是内存的，进程一退就没了。
 */
export async function launchSession(options: SessionOptions = {}): Promise<BrowserSession> {
  const profileDir = options.profileDir ?? DEFAULT_PROFILE_DIR;
  await mkdir(profileDir, { recursive: true });

  /*
   * Playwright 带浏览器内核约 150MB，不打进单文件可执行程序 ——
   * 打包后从可执行文件旁边解析，开发时走正常模块解析。
   */
  const { chromium } = requireExternal<{ chromium: typeof ChromiumType }>(
    'playwright',
    import.meta.url,
  );

  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      headless: options.headless ?? false,
      locale: options.locale ?? 'zh-CN',
      viewport: { width: 1440, height: 900 },
      args: ['--disable-blink-features=AutomationControlled'],
    });
  } catch (cause) {
    throw new AutoJobError(ErrorCode.INTERNAL, '无法启动浏览器', {
      hint: '请先运行 pnpm exec playwright install chromium',
      cause,
    });
  }

  context.setDefaultTimeout(options.timeout ?? 15_000);

  /*
   * esbuild（tsx 的底层）在编译时会给函数包一层 `__name(fn, "name")` 以保留函数名。
   * 这个辅助函数只存在于 Node 侧的模块作用域里。
   *
   * 而我们的提取脚本会被**序列化后送进浏览器执行** —— 到了页面里，
   * `__name` 根本不存在，脚本一跑就 ReferenceError。
   *
   * 症状很有迷惑性：Playwright 自己的测试 runner 用另一套转换，E2E 里一切正常，
   * 只有走 tsx 的 CLI 路径才会炸。所以这里注入一个恒等实现兜底。
   */
  await context.addInitScript(() => {
    const scope = globalThis as { __name?: (fn: unknown, name?: string) => unknown };
    scope.__name ??= (fn) => fn;
  });

  const page = context.pages()[0] ?? (await context.newPage());
  options.logger?.info('浏览器会话已启动', { profileDir, headless: options.headless ?? false });

  return {
    context,
    page,
    profileDir,
    close: async (): Promise<void> => {
      await context.close();
      options.logger?.info('浏览器会话已关闭');
    },
  };
}

// ————————————————————————————————————————————————
// 登录与验证码检测
// ————————————————————————————————————————————————

/** 登录页的常见特征。命中任一即认为需要登录 */
const LOGIN_INDICATORS: readonly RegExp[] = [
  /请先登录/,
  /登录后查看/,
  /扫码登录/,
  /微信扫码/,
  /账号登录/,
  /手机号登录/,
  /please\s+(sign|log)\s*in/i,
];

/** 验证码特征。**只用于识别并交给用户，绝不用于绕过** */
const CAPTCHA_INDICATORS: readonly RegExp[] = [
  /验证码/,
  /人机验证/,
  /滑动验证/,
  /拖动滑块/,
  /captcha/i,
  /verify\s+you\s+are\s+human/i,
];

export type PageGate = 'none' | 'login' | 'captcha';

export interface GateDetection {
  readonly gate: PageGate;
  /** 命中的原文片段，供日志与提示使用 */
  readonly evidence: string;
}

/**
 * 检测页面是否被登录或验证码挡住。
 *
 * 策略保守：只看可见文本与表单控件，不做任何自动交互。
 * 宁可漏报（后续填写会失败并报错），也不要误报把正常页面判成需要登录。
 */
export async function detectGate(page: Page): Promise<GateDetection> {
  const text = await page.evaluate(READ_BODY_TEXT);

  for (const pattern of CAPTCHA_INDICATORS) {
    const match = pattern.exec(text);
    if (match) return { gate: 'captcha', evidence: match[0] };
  }

  // 密码框的存在是登录页的强信号
  const passwordCount = await page.locator('input[type="password"]').count();
  if (passwordCount > 0) return { gate: 'login', evidence: '页面存在密码输入框' };

  for (const pattern of LOGIN_INDICATORS) {
    const match = pattern.exec(text);
    if (match) return { gate: 'login', evidence: match[0] };
  }

  return { gate: 'none', evidence: '' };
}

/**
 * 把检测结果转成结构化错误。
 *
 * 两者都是 userActionable —— 上层据此转 WAITING_USER，把浏览器留给用户，
 * 而不是失败退出。用户在同一个浏览器窗口里完成登录后，
 * 登录态会写进 persistent profile，下次就不用再来一遍。
 */
export function gateToError(detection: GateDetection, url: string): AutoJobError | undefined {
  switch (detection.gate) {
    case 'captcha':
      return new AutoJobError(
        ErrorCode.CAPTCHA_REQUIRED,
        `页面需要完成人机验证：${detection.evidence}`,
        {
          hint: '请在已打开的浏览器窗口中手动完成验证，完成后回到终端继续',
          context: { url },
        },
      );
    case 'login':
      return new AutoJobError(ErrorCode.LOGIN_REQUIRED, `页面需要登录：${detection.evidence}`, {
        hint: '请在已打开的浏览器窗口中完成登录（扫码 / 短信验证码均可），登录态会被保存，下次无需重复',
        context: { url },
      });
    case 'none':
      return undefined;
  }
}

/**
 * 等待用户在浏览器里处理完登录或验证码。
 *
 * 做法是轮询检测：用户什么时候弄完我们不知道，只能反复看页面是否还被挡着。
 * 不设自动重试上限之外的任何「聪明」逻辑 —— 用户没弄完就是没弄完。
 */
export async function waitForUserToResolveGate(
  page: Page,
  options: { timeoutMs?: number; pollMs?: number; logger?: Logger } = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;
  const pollMs = options.pollMs ?? 2_000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const detection = await detectGate(page);
    if (detection.gate === 'none') {
      options.logger?.info('用户已完成登录/验证，继续执行');
      return true;
    }
    await page.waitForTimeout(pollMs);
  }

  options.logger?.warn('等待用户处理登录/验证超时');
  return false;
}
