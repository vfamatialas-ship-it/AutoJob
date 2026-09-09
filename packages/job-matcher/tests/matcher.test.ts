import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { importProfile, type CandidateProfile } from '@autojob/candidate-profile';
import { JobSchema, type Job } from '@autojob/job-discovery';
import { DEFAULT_PREFERENCE, JobPreferenceSchema, satisfiesDegree } from '../src/preference.js';
import { hardFilter, matchJob, matchJobs, summarizeMatches } from '../src/matcher.js';

const profile: CandidateProfile = importProfile(
  readFileSync(
    fileURLToPath(
      new URL('../../candidate-profile/tests/fixtures/profile.sample.json', import.meta.url),
    ),
    'utf-8',
  ),
);

function job(overrides: Partial<Job> & { title: string }): Job {
  return JobSchema.parse({
    id: `job-${overrides.title}`,
    company: '某公司',
    url: 'https://example.test/job/1',
    ...overrides,
  });
}

const options = { preference: DEFAULT_PREFERENCE, profile };

describe('第一层 Hard Filter：明显不匹配的直接淘汰', () => {
  it('Java 后端被排除关键词挡掉', () => {
    const result = hardFilter(job({ title: 'Java 后端开发工程师' }), DEFAULT_PREFERENCE);

    expect(result.passed).toBe(false);
    expect(result.reason).toBe('EXCLUDED_KEYWORD');
    expect(result.detail).toContain('Java');
  });

  it('前端、销售、测试同样被挡掉', () => {
    for (const title of ['前端开发工程师', '销售管理培训生', '软件测试工程师']) {
      expect(hardFilter(job({ title }), DEFAULT_PREFERENCE).passed, title).toBe(false);
    }
  });

  it('具身智能算法工程师顺利通过', () => {
    expect(hardFilter(job({ title: '具身智能算法工程师' }), DEFAULT_PREFERENCE).passed).toBe(true);
  });

  it('学历不达标时淘汰，并说明差距', () => {
    const result = hardFilter(
      job({ title: '强化学习算法工程师', degreeRequirement: 'doctor' }),
      DEFAULT_PREFERENCE,
    );

    expect(result.passed).toBe(false);
    expect(result.reason).toBe('DEGREE_NOT_MET');
    expect(result.detail).toContain('doctor');
  });

  it('岗位未标注学历要求时不淘汰 —— 不因信息缺失而误杀', () => {
    expect(
      hardFilter(
        job({ title: '机器人算法工程师', degreeRequirement: 'unknown' }),
        DEFAULT_PREFERENCE,
      ).passed,
    ).toBe(true);
  });

  it('社招岗位默认不接受', () => {
    const result = hardFilter(
      job({ title: '具身智能算法专家', jobType: 'social' }),
      DEFAULT_PREFERENCE,
    );

    expect(result.passed).toBe(false);
    expect(result.reason).toBe('JOB_TYPE_NOT_ACCEPTED');
  });

  it('排除城市生效', () => {
    const preference = JobPreferenceSchema.parse({
      ...DEFAULT_PREFERENCE,
      excludedCities: ['广州'],
    });
    const result = hardFilter(job({ title: '机器人算法工程师', location: '广州' }), preference);

    expect(result.passed).toBe(false);
    expect(result.reason).toBe('EXCLUDED_CITY');
  });

  it('公司黑名单生效', () => {
    const preference = JobPreferenceSchema.parse({
      ...DEFAULT_PREFERENCE,
      companyBlacklist: ['某公司'],
    });
    expect(hardFilter(job({ title: '机器人算法工程师' }), preference).reason).toBe(
      'COMPANY_BLACKLISTED',
    );
  });
});

describe('satisfiesDegree', () => {
  it('硕士满足本科及硕士要求，不满足博士', () => {
    expect(satisfiesDegree('master', 'bachelor')).toBe(true);
    expect(satisfiesDegree('master', 'master')).toBe(true);
    expect(satisfiesDegree('master', 'doctor')).toBe(false);
  });

  it('要求未知时一律通过', () => {
    expect(satisfiesDegree('bachelor', 'unknown')).toBe(true);
  });
});

describe('第二层确定性打分', () => {
  it('高度相关的岗位得分显著高于边缘岗位', () => {
    const strong = matchJob(
      job({
        title: '具身智能算法工程师',
        description: '负责 VLA 模型训练与真机部署，强化学习后训练，双臂协同操作。',
        location: '北京',
      }),
      options,
    );
    const weak = matchJob(
      job({ title: '机械结构设计工程师', description: '负责机械结构设计与仿真。' }),
      options,
    );

    expect(strong.score).toBeGreaterThan(weak.score);
    expect(strong.score).toBeGreaterThan(60);
  });

  it('得分由多个可解释的维度构成', () => {
    const result = matchJob(
      job({ title: '具身智能算法工程师', description: 'VLA 强化学习 ROS2' }),
      options,
    );

    const names = result.components.map((item) => item.name);
    expect(names).toEqual(['技能匹配', '方向匹配', '岗位类型', '工作地点']);
    expect(result.components.every((item) => item.reason.length > 0)).toBe(true);
  });

  it('技能匹配点名具体命中了哪些技能', () => {
    const result = matchJob(
      job({ title: 'VLA 算法工程师', description: '使用 VLA 与强化学习，熟悉 ROS2。' }),
      options,
    );

    const skills = result.components.find((item) => item.name === '技能匹配');
    expect(skills?.reason).toContain('VLA');
    expect(skills?.score).toBeGreaterThan(0);
  });

  it('偏好城市命中时地点满分，不命中时零分', () => {
    const preference = JobPreferenceSchema.parse({
      ...DEFAULT_PREFERENCE,
      preferredCities: ['北京', '西安'],
    });

    const hit = matchJob(job({ title: '机器人算法工程师', location: '西安' }), {
      ...options,
      preference,
    });
    const miss = matchJob(job({ title: '机器人算法工程师', location: '成都' }), {
      ...options,
      preference,
    });

    const hitScore = hit.components.find((item) => item.name === '工作地点');
    const missScore = miss.components.find((item) => item.name === '工作地点');

    expect(hitScore?.score).toBe(hitScore?.max);
    expect(missScore?.score).toBe(0);
  });

  it('岗位未标注地点时按中性计分，不因信息缺失而扣光', () => {
    const preference = JobPreferenceSchema.parse({
      ...DEFAULT_PREFERENCE,
      preferredCities: ['北京'],
    });
    const result = matchJob(job({ title: '机器人算法工程师', location: '' }), {
      ...options,
      preference,
    });

    const location = result.components.find((item) => item.name === '工作地点');
    expect(location?.score).toBeGreaterThan(0);
    expect(location?.score).toBeLessThan(location?.max ?? 0);
  });

  it('摘要只挑最突出的两项，不堆砌', () => {
    const result = matchJob(
      job({ title: '具身智能算法工程师', description: 'VLA 强化学习', location: '北京' }),
      options,
    );

    expect(result.summary.split('；').length).toBeLessThanOrEqual(2);
  });

  it('被硬过滤的岗位得分为 0 且不计算维度', () => {
    const result = matchJob(job({ title: 'Java 后端开发工程师' }), options);

    expect(result.score).toBe(0);
    expect(result.passed).toBe(false);
    expect(result.components).toEqual([]);
    expect(result.summary).toContain('Java');
  });
});

describe('批量匹配与排序', () => {
  const jobs = [
    job({ title: 'Java 后端开发工程师' }),
    job({ title: '具身智能算法工程师', description: 'VLA 强化学习 双臂协同', location: '北京' }),
    job({ title: '机械结构设计工程师', description: '结构设计与仿真' }),
    job({ title: '运动规划算法工程师', description: '轨迹规划 运动控制', location: '上海' }),
    job({ title: '销售管理培训生' }),
  ];

  it('通过筛选的排在前面，被淘汰的排在最后', () => {
    const results = matchJobs(jobs, options);
    const firstRejectedIndex = results.findIndex((item) => !item.passed);

    expect(firstRejectedIndex).toBeGreaterThan(0);
    expect(results.slice(firstRejectedIndex).every((item) => !item.passed)).toBe(true);
  });

  it('通过的按分数倒序', () => {
    const passed = matchJobs(jobs, options).filter((item) => item.passed);
    const scores = passed.map((item) => item.score);

    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('最相关的岗位排第一', () => {
    expect(matchJobs(jobs, options)[0]?.job.title).toBe('具身智能算法工程师');
  });

  it('统计给出淘汰原因分布', () => {
    const summary = summarizeMatches(matchJobs(jobs, options));

    expect(summary.total).toBe(5);
    expect(summary.rejected).toBe(2);
    expect(summary.rejectionsByReason['EXCLUDED_KEYWORD']).toBe(2);
  });
});

describe('重复投递标记（PRD §30）', () => {
  it('已投递过的岗位被标出，但不影响打分', () => {
    const target = job({ title: '具身智能算法工程师', description: 'VLA' });
    const result = matchJob(target, { ...options, appliedJobIds: new Set([target.id]) });

    expect(result.alreadyApplied).toBe(true);
    expect(result.passed).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });

  it('未投递过时标记为 false', () => {
    const result = matchJob(job({ title: '机器人算法工程师' }), {
      ...options,
      appliedJobIds: new Set(['other']),
    });
    expect(result.alreadyApplied).toBe(false);
  });

  it('统计里单列已投递数量', () => {
    const target = job({ title: '具身智能算法工程师' });
    const summary = summarizeMatches(
      matchJobs([target], { ...options, appliedJobIds: new Set([target.id]) }),
    );
    expect(summary.alreadyApplied).toBe(1);
  });
});

describe('技能名限定词不影响匹配', () => {
  it('「VLA 模型」能匹配岗位描述里的裸「VLA」', () => {
    const result = matchJob(
      job({ title: '算法工程师', description: '负责 VLA 相关研发。' }),
      options,
    );

    const skills = result.components.find((item) => item.name === '技能匹配');
    expect(skills?.reason).toContain('VLA');
  });

  it('剥限定词后不足 2 字符的技能不参与，避免满页误命中', () => {
    const narrowProfile: CandidateProfile = {
      ...profile,
      skills: [
        {
          id: 's',
          name: 'C++ 开发',
          category: 'programming',
          level: 'proficient',
          evidence: [],
          keywords: [],
        },
      ],
    };

    // 「C++ 开发」剥掉「开发」剩 'C++'（3 字符），仍应能匹配
    const result = matchJob(job({ title: 'C++ 工程师', description: '熟悉 C++' }), {
      ...options,
      profile: narrowProfile,
    });
    expect(result.components.find((item) => item.name === '技能匹配')?.score).toBeGreaterThan(0);
  });
});
