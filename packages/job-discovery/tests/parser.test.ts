/**
 * 岗位解析单元测试。
 *
 * 多数用例来自**真实站点上踩到的坑**，不是假想的边界情况。
 */
import { describe, expect, it } from 'vitest';
import { parseDegree, parseExternalJobId, parseJobType, parseLocation } from '../src/job.js';
import { parseJobList } from '../src/parser.js';
import type { RawJobList } from '../src/extract-script.js';

describe('parseExternalJobId', () => {
  it('hash 路由里的岗位 id 优先于路径末段', () => {
    /*
     * 真实踩坑：Moka 的 URL 形如 /campus-recruitment/dji/143359#/job/<uuid>。
     * 若先看路径末段会取到 143359 —— 那是页面 id，全站岗位都一样，
     * 结果 30 个岗位被去重成 1 个。
     */
    const url = 'https://apply.careers.dji.com/campus-recruitment/dji/143359#/job/093114fd-38fa';
    expect(parseExternalJobId(url)).toBe('093114fd-38fa');
  });

  it('纯锚点不当作岗位 id', () => {
    expect(parseExternalJobId('https://x.test/jobs#top')).toBe('');
  });

  it('query 参数形态', () => {
    expect(parseExternalJobId('https://x.test/job?id=J1001')).toBe('J1001');
    expect(parseExternalJobId('https://x.test/job?jid=K2001')).toBe('K2001');
  });

  it('路径末段形态', () => {
    expect(parseExternalJobId('https://x.test/position/12345')).toBe('12345');
  });

  it('无编号时返回空串而不是瞎猜', () => {
    expect(parseExternalJobId('https://x.test/about-us')).toBe('');
  });
});

describe('字段解析', () => {
  it('学历要求', () => {
    expect(parseDegree('硕士及以上')).toBe('master');
    expect(parseDegree('本科及以上')).toBe('bachelor');
    expect(parseDegree('博士')).toBe('doctor');
    expect(parseDegree('不限')).toBe('unknown');
  });

  it('招聘类型', () => {
    expect(parseJobType('校园招聘')).toBe('campus');
    expect(parseJobType('社会招聘')).toBe('social');
    expect(parseJobType('暑期实习')).toBe('intern');
  });

  it('地点用固定城市表，不会把部门名误判成地点', () => {
    expect(parseLocation('机器人研究院 北京 硕士')).toBe('北京');
    expect(parseLocation('智能中心 研究院')).toBe('');
  });
});

const group = (items: Array<{ title: string; url: string; text?: string }>): RawJobList[] => [
  {
    signature: 'div > div.card',
    score: 100,
    items: items.map((i) => ({ title: i.title, url: i.url, fields: [], text: i.text ?? i.title })),
  },
];

describe('去重', () => {
  it('同一岗位重复出现只保留一条', () => {
    const result = parseJobList(
      group([
        { title: '算法工程师', url: '/job?id=A1' },
        { title: '算法工程师', url: '/job?id=A1' },
      ]),
      { company: 'X', baseUrl: 'https://x.test' },
    );
    expect(result.jobs).toHaveLength(1);
  });

  it('整组编号相同时判定编号无效，改用标题+地点去重', () => {
    // 兜底防线：若编号提取出错导致全组同号，不该把整页压成一条
    const result = parseJobList(
      group([
        { title: '算法工程师', url: '/list/143359', text: '算法工程师 北京' },
        { title: '运动规划工程师', url: '/list/143359', text: '运动规划工程师 上海' },
        { title: '控制工程师', url: '/list/143359', text: '控制工程师 深圳' },
      ]),
      { company: 'X', baseUrl: 'https://x.test' },
    );

    expect(result.jobs).toHaveLength(3);
    expect(result.jobs.every((job) => job.externalJobId === '')).toBe(true);
  });

  it('编号各不相同时正常保留编号', () => {
    const result = parseJobList(
      group([
        { title: 'AAA 工程师', url: '/job?id=A1' },
        { title: 'BBB 工程师', url: '/job?id=B2' },
      ]),
      { company: 'X', baseUrl: 'https://x.test' },
    );
    expect(result.jobs.map((job) => job.externalJobId)).toEqual(['A1', 'B2']);
  });
});

describe('健壮性', () => {
  it('空候选返回空结果而不是崩溃', () => {
    const result = parseJobList([], { company: 'X', baseUrl: 'https://x.test' });
    expect(result.jobs).toEqual([]);
    expect(result.signature).toBe('');
  });

  it('标题过短或过长的条目被跳过', () => {
    const result = parseJobList(
      group([
        { title: '看', url: '/a' },
        { title: 'x'.repeat(80), url: '/b' },
        { title: '算法工程师', url: '/c' },
      ]),
      { company: 'X', baseUrl: 'https://x.test' },
    );

    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]?.title).toBe('算法工程师');
  });

  it('相对链接被补全为绝对链接', () => {
    const result = parseJobList(group([{ title: '算法工程师', url: '/job/1' }]), {
      company: 'X',
      baseUrl: 'https://x.test/careers',
    });
    expect(result.jobs[0]?.url).toBe('https://x.test/job/1');
  });
});
