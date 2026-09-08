import { describe, expect, it } from 'vitest';
import { checkNodeVersion, checkPlaywrightBrowsers, formatChecks } from '../src/commands/doctor.js';

describe('checkNodeVersion', () => {
  it('Node 20 以上通过', () => {
    expect(checkNodeVersion('v22.23.0').ok).toBe(true);
    expect(checkNodeVersion('v20.0.0').ok).toBe(true);
  });

  it('Node 低于 20 不通过并给出修复建议', () => {
    const result = checkNodeVersion('v18.19.0');
    expect(result.ok).toBe(false);
    expect(result.fix).toContain('升级 Node');
  });
});

describe('checkPlaywrightBrowsers', () => {
  it('目录不存在时不通过，并给出安装命令', () => {
    const result = checkPlaywrightBrowsers('/definitely/not/a/real/path');
    expect(result.ok).toBe(false);
    expect(result.fix).toContain('playwright install');
  });

  it('目录存在时通过', () => {
    expect(checkPlaywrightBrowsers(process.cwd()).ok).toBe(true);
  });
});

describe('formatChecks', () => {
  it('全部通过时给出通过结论', () => {
    const output = formatChecks([{ name: 'X', ok: true, detail: 'fine' }]);
    expect(output).toContain('✓');
    expect(output).toContain('全部检查通过');
  });

  it('存在失败项时统计数量并展示修复建议', () => {
    const output = formatChecks([
      { name: 'X', ok: true, detail: 'fine' },
      { name: 'Y', ok: false, detail: 'missing', fix: '装一下' },
    ]);
    expect(output).toContain('✗');
    expect(output).toContain('1 项未通过');
    expect(output).toContain('装一下');
  });
});
