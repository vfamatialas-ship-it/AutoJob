/**
 * 浏览器会话集成测试。
 *
 * 这些用例需要真实 Chromium，比纯逻辑测试慢，但覆盖的是**只有真跑才会暴露**的问题：
 * 序列化脚本进页面执行时的运行时环境差异。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectGate, gateToError, launchSession, type BrowserSession } from '../src/session.js';

let session: BrowserSession;

beforeAll(async () => {
  session = await launchSession({ headless: true, profileDir: '/tmp/autojob-test-profile' });
}, 60_000);

afterAll(async () => {
  await session?.close();
});

/** 用 data URL 构造页面，避免依赖 Mock 服务器 */
const dataUrl = (html: string): string =>
  `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><meta charset="utf-8">${html}`)}`;

describe('esbuild __name 兼容垫片', () => {
  it('页面里存在 __name，序列化进去的脚本不会 ReferenceError', async () => {
    /*
     * 回归防线。tsx/esbuild 会把函数编译成 `__name(fn, "name")`，
     * 而 __name 只存在于 Node 侧。脚本序列化进页面后就找不到它，直接抛
     * ReferenceError: __name is not defined。
     *
     * 迷惑之处在于：Playwright 自己的测试 runner 用另一套转换，E2E 全绿，
     * 只有走 tsx 的 CLI 路径才炸。所以这里直接断言垫片已注入。
     *
     * 用字符串形式 evaluate，绕开本测试自身的编译转换。
     */
    await session.page.goto(dataUrl('<p>hi</p>'));
    const kind = await session.page.evaluate('typeof globalThis.__name');
    expect(kind).toBe('function');
  });

  it('垫片是恒等函数，不会改变被包裹函数的行为', async () => {
    await session.page.goto(dataUrl('<p>hi</p>'));
    const result = await session.page.evaluate('globalThis.__name(() => 42, "answer")()');
    expect(result).toBe(42);
  });
});

describe('登录与验证码检测（只识别，绝不绕过）', () => {
  it('识别扫码登录页', async () => {
    await session.page.goto(dataUrl('<h1>请先登录</h1><p>请使用微信扫码登录后查看职位</p>'));

    const detection = await detectGate(session.page);
    expect(detection.gate).toBe('login');
  });

  it('密码输入框是登录页的强信号', async () => {
    await session.page.goto(dataUrl('<form><input type="password" name="p"></form>'));

    const detection = await detectGate(session.page);
    expect(detection.gate).toBe('login');
    expect(detection.evidence).toContain('密码输入框');
  });

  it('识别人机验证并优先于登录判定', async () => {
    // 同时含登录与验证码特征时，应报验证码 —— 它是更紧迫的阻塞
    await session.page.goto(dataUrl('<h1>请先登录</h1><div>请完成滑动验证</div>'));

    const detection = await detectGate(session.page);
    expect(detection.gate).toBe('captcha');
  });

  it('正常表单页不误报', async () => {
    await session.page.goto(
      dataUrl('<form><label for="n">姓名</label><input id="n"><button>提交</button></form>'),
    );

    expect((await detectGate(session.page)).gate).toBe('none');
  });

  it('两种拦截都转成需用户处理的结构化错误', async () => {
    const loginError = gateToError({ gate: 'login', evidence: '扫码登录' }, 'https://x.test');
    expect(loginError?.code).toBe('LOGIN_REQUIRED');
    expect(loginError?.userActionable).toBe(true);
    expect(loginError?.hint).toContain('浏览器窗口');

    const captchaError = gateToError({ gate: 'captcha', evidence: '滑动验证' }, 'https://x.test');
    expect(captchaError?.code).toBe('CAPTCHA_REQUIRED');
    expect(captchaError?.userActionable).toBe(true);

    expect(gateToError({ gate: 'none', evidence: '' }, 'https://x.test')).toBeUndefined();
  });
});

describe('持久化会话', () => {
  it('使用指定的 profile 目录，登录态得以落盘复用', () => {
    expect(session.profileDir).toBe('/tmp/autojob-test-profile');
  });
});
