import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type AutoJobDatabase } from '../src/client.js';
import { ApplicationRepository, jobFingerprint } from '../src/repository.js';

let db: AutoJobDatabase;
let repo: ApplicationRepository;

beforeEach(() => {
  db = openDatabase({ path: ':memory:' });
  repo = new ApplicationRepository(db);
});

afterEach(() => {
  db.close();
});

/** 建一套「公司 + 岗位」的便捷函数 */
function seed(overrides: { title?: string; externalJobId?: string; company?: string } = {}) {
  const company = repo.upsertCompany({
    name: overrides.company ?? '某机器人公司',
    atsType: 'moka',
  });
  const job = repo.upsertJob({
    companyId: company.id,
    title: overrides.title ?? '具身智能算法工程师',
    url: 'https://example.com/job/1',
    ...(overrides.externalJobId === undefined ? {} : { externalJobId: overrides.externalJobId }),
  });
  return { company, job };
}

describe('岗位去重指纹（PRD §30）', () => {
  it('有网站 jobId 时优先使用它', () => {
    const fingerprint = jobFingerprint({
      companyId: 'co_1',
      externalJobId: 'J12345',
      title: '算法工程师',
    });
    expect(fingerprint).toBe('co_1:J12345');
  });

  it('无 jobId 时退到内容 hash', () => {
    const fingerprint = jobFingerprint({
      companyId: 'co_1',
      title: '算法工程师',
      location: '西安',
    });
    expect(fingerprint).toMatch(/^hash:[0-9a-f]{32}$/);
  });

  it('同一岗位的不同大小写与空格产生相同指纹', () => {
    const a = jobFingerprint({ companyId: 'co_1', title: ' 算法工程师 ', location: '西安' });
    const b = jobFingerprint({ companyId: 'co_1', title: '算法工程师', location: '西安' });
    expect(a).toBe(b);
  });

  it('不同岗位产生不同指纹', () => {
    const a = jobFingerprint({ companyId: 'co_1', title: '算法工程师' });
    const b = jobFingerprint({ companyId: 'co_1', title: '前端工程师' });
    expect(a).not.toBe(b);
  });
});

describe('公司与岗位', () => {
  it('同名公司不会重复创建', () => {
    const first = repo.upsertCompany({ name: '某公司' });
    const second = repo.upsertCompany({ name: '某公司' });
    expect(second.id).toBe(first.id);
  });

  it('ATS 类型可在后续识别中更新', () => {
    const first = repo.upsertCompany({ name: '某公司' });
    expect(first.atsType).toBe('unknown');

    const updated = repo.upsertCompany({ name: '某公司', atsType: 'feishu' });
    expect(updated.id).toBe(first.id);
    expect(updated.atsType).toBe('feishu');
  });

  it('相同指纹的岗位不会重复创建', () => {
    const company = repo.upsertCompany({ name: '某公司' });
    const a = repo.upsertJob({ companyId: company.id, title: '算法', url: 'u1' });
    const b = repo.upsertJob({ companyId: company.id, title: '算法', url: 'u2' });

    expect(b.id).toBe(a.id);
    expect(repo.countJobs(company.id)).toBe(1);
  });
});

describe('防重复投递（PRD §30）', () => {
  it('同一岗位第二次投递被拒绝，并说明上次投递情况', () => {
    const { company, job } = seed();
    repo.createApplication({
      companyId: company.id,
      jobId: job.id,
      runId: 'run_1',
      status: 'READY_TO_SUBMIT',
    });

    expect(() =>
      repo.createApplication({
        companyId: company.id,
        jobId: job.id,
        runId: 'run_2',
        status: 'READY_TO_SUBMIT',
      }),
    ).toThrow(/已于.*投递过/);
  });

  it('重复投递错误是 userActionable，需用户决定而非系统自行处理', () => {
    const { company, job } = seed();
    repo.createApplication({
      companyId: company.id,
      jobId: job.id,
      runId: 'run_1',
      status: 'SUBMITTED',
    });

    try {
      repo.createApplication({
        companyId: company.id,
        jobId: job.id,
        runId: 'run_2',
        status: 'READY_TO_SUBMIT',
      });
      expect.unreachable('应当抛出重复投递错误');
    } catch (error) {
      expect((error as { code: string }).code).toBe('DUPLICATE_APPLICATION');
      expect((error as { userActionable: boolean }).userActionable).toBe(true);
    }
  });

  it('填表前可主动查询是否已投递', () => {
    const { company, job } = seed();
    expect(repo.findApplicationByJob(job.id)).toBeUndefined();

    repo.createApplication({
      companyId: company.id,
      jobId: job.id,
      runId: 'run_1',
      status: 'READY_TO_SUBMIT',
    });
    expect(repo.findApplicationByJob(job.id)?.status).toBe('READY_TO_SUBMIT');
  });

  it('不同岗位可以分别投递', () => {
    const { company, job } = seed({ externalJobId: 'J1' });
    const secondJob = repo.upsertJob({
      companyId: company.id,
      title: '运动规划算法工程师',
      url: 'u2',
      externalJobId: 'J2',
    });

    repo.createApplication({
      companyId: company.id,
      jobId: job.id,
      runId: 'r1',
      status: 'SUBMITTED',
    });
    expect(() =>
      repo.createApplication({
        companyId: company.id,
        jobId: secondJob.id,
        runId: 'r2',
        status: 'SUBMITTED',
      }),
    ).not.toThrow();
  });
});

describe('状态变化必然留下时间线（PRD §37）', () => {
  it('创建时就记录一条事件', () => {
    const { company, job } = seed();
    const app = repo.createApplication({
      companyId: company.id,
      jobId: job.id,
      runId: 'run_1',
      status: 'FILLING',
    });

    const timeline = repo.timeline(app.id);
    expect(timeline).toHaveLength(1);
    expect(timeline[0]?.eventType).toBe('CREATED');
    expect(timeline[0]?.newStatus).toBe('FILLING');
  });

  it('每次状态变化都追加事件，记录前后状态', () => {
    const { company, job } = seed();
    const app = repo.createApplication({
      companyId: company.id,
      jobId: job.id,
      runId: 'run_1',
      status: 'FILLING',
    });

    repo.updateStatus(app.id, 'READY_TO_SUBMIT');
    repo.updateStatus(app.id, 'SUBMITTED', { confirmationText: '您的简历已提交成功' });
    repo.updateStatus(app.id, 'OA', { source: 'user', notes: '收到测评邮件' });

    const timeline = repo.timeline(app.id);
    expect(timeline).toHaveLength(4);
    expect(timeline.map((event) => event.newStatus)).toEqual([
      'FILLING',
      'READY_TO_SUBMIT',
      'SUBMITTED',
      'OA',
    ]);
    expect(timeline[3]?.oldStatus).toBe('SUBMITTED');
    expect(timeline[3]?.source).toBe('user');
  });

  it('提交时自动记录提交时间与确认文本', () => {
    const { company, job } = seed();
    const app = repo.createApplication({
      companyId: company.id,
      jobId: job.id,
      runId: 'run_1',
      status: 'READY_TO_SUBMIT',
    });

    const updated = repo.updateStatus(app.id, 'SUBMITTED', {
      confirmationText: '投递成功，感谢关注',
    });

    expect(updated.submittedAt).not.toBeNull();
    expect(updated.confirmationText).toBe('投递成功，感谢关注');
  });

  it('更新不存在的记录时报结构化错误', () => {
    expect(() => repo.updateStatus('app_not_exist', 'SUBMITTED')).toThrow(/投递记录不存在/);
  });
});

describe('Dashboard 统计（PRD §38）', () => {
  it('按状态汇总投递数', () => {
    const company = repo.upsertCompany({ name: '某公司' });
    const statuses = ['SUBMITTED', 'SUBMITTED', 'INTERVIEW', 'REJECTED'] as const;

    statuses.forEach((status, index) => {
      const job = repo.upsertJob({
        companyId: company.id,
        title: `岗位${index}`,
        url: `u${index}`,
        externalJobId: `J${index}`,
      });
      repo.createApplication({ companyId: company.id, jobId: job.id, runId: `r${index}`, status });
    });

    expect(repo.statusCounts()).toEqual({ SUBMITTED: 2, INTERVIEW: 1, REJECTED: 1 });
  });

  it('列表按更新时间倒序，并带出公司与岗位信息', () => {
    const { company, job } = seed({ title: '具身智能算法工程师' });
    repo.createApplication({
      companyId: company.id,
      jobId: job.id,
      runId: 'r1',
      status: 'SUBMITTED',
    });

    const rows = repo.listApplications();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.company.name).toBe('某机器人公司');
    expect(rows[0]?.job.title).toBe('具身智能算法工程师');
  });

  it('可按状态筛选', () => {
    const company = repo.upsertCompany({ name: '某公司' });
    (['SUBMITTED', 'INTERVIEW'] as const).forEach((status, index) => {
      const job = repo.upsertJob({
        companyId: company.id,
        title: `岗位${index}`,
        url: `u${index}`,
        externalJobId: `J${index}`,
      });
      repo.createApplication({ companyId: company.id, jobId: job.id, runId: `r${index}`, status });
    });

    expect(repo.listApplications({ status: 'INTERVIEW' })).toHaveLength(1);
  });
});

describe('Mapping Memory 持久化（补上 M4 的内存实现限制）', () => {
  it('规则存盘后可按 ATS 读回', () => {
    repo.saveMappingRule({
      id: 'rule_1',
      scope: 'ats',
      atsType: 'moka',
      fieldLabel: '实践经历',
      semanticType: 'SOCIAL_PRACTICE',
      allowedCandidateTypes: ['internship', 'research_project'],
      blockedCandidateTypes: [],
      origin: 'user',
      confidence: 1,
      note: '用户确认',
    });

    const loaded = repo.loadMappingRules({ atsType: 'moka' });
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.allowedCandidateTypes).toEqual(['internship', 'research_project']);
    expect(loaded[0]?.confidence).toBe(1);
  });

  it('ATS 级规则不会被其他 ATS 读到', () => {
    repo.saveMappingRule({
      id: 'rule_1',
      scope: 'ats',
      atsType: 'moka',
      fieldLabel: 'x',
      semanticType: 'OTHER',
      allowedCandidateTypes: [],
      blockedCandidateTypes: [],
      origin: 'user',
      confidence: 1,
    });

    expect(repo.loadMappingRules({ atsType: 'feishu' })).toHaveLength(0);
  });

  it('全局规则对任何上下文都可见', () => {
    repo.saveMappingRule({
      id: 'rule_global',
      scope: 'global',
      semanticType: 'WORK_EXPERIENCE',
      allowedCandidateTypes: [],
      blockedCandidateTypes: ['research_project'],
      origin: 'builtin',
      confidence: 1,
    });

    expect(repo.loadMappingRules({ atsType: 'anything' })).toHaveLength(1);
    expect(repo.loadMappingRules()[0]?.blockedCandidateTypes).toEqual(['research_project']);
  });

  it('重复 id 不会重复插入', () => {
    const rule = {
      id: 'rule_1',
      scope: 'global' as const,
      semanticType: 'OTHER',
      allowedCandidateTypes: [],
      blockedCandidateTypes: [],
      origin: 'user',
      confidence: 1,
    };
    repo.saveMappingRule(rule);
    repo.saveMappingRule(rule);

    expect(repo.loadMappingRules()).toHaveLength(1);
  });
});
