/**
 * 用真实结构的示例 Profile 做端到端验证。
 *
 * PRD §52 的验收标准：「同一个 Candidate Profile 能根据不同字段结构生成不同输出。」
 * 这里覆盖的核心场景：同一份数据，面对「有科研栏」与「无科研栏」两种网站，
 * 以及「奖项合并栏」与「奖学金/竞赛拆分栏」两种网站，都能给出正确结果。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { toSafeBasicInfo } from '../src/basic-info.js';
import { highestEducation, normalizedGpa, rankingPercentile } from '../src/education.js';
import { pickHomepageLink } from '../src/links.js';
import { checkProfileIntegrity, createEmptyProfile, toLLMSafeProfile } from '../src/profile.js';
import { exportProfile, importProfile } from '../src/io.js';
import { findDowngradedExperiences, queryAwards, queryExperiences } from '../src/query.js';
import { pickResumeVersion, selectAsset } from '../src/asset.js';
import type { CandidateProfile } from '../src/profile.js';

const sampleJson = readFileSync(
  fileURLToPath(new URL('./fixtures/profile.sample.json', import.meta.url)),
  'utf-8',
);
const profile: CandidateProfile = importProfile(sampleJson);

describe('示例 Profile 加载', () => {
  it('通过 schema 校验', () => {
    expect(profile.basicInfo.name).toBe('示例候选人');
    expect(profile.experiences).toHaveLength(2);
    expect(profile.awards).toHaveLength(8);
  });

  it('引用完整性无问题', () => {
    expect(checkProfileIntegrity(profile)).toEqual([]);
  });
});

describe('场景一：网站有独立科研栏', () => {
  it('科研经历进科研栏，实习不进', () => {
    const { matched } = queryExperiences(profile, 'research_experience');
    expect(matched.map((e) => e.id)).toEqual(['exp-underwater-vla']);
  });

  it('实习进实习栏，科研课题不进', () => {
    const { matched, rejected } = queryExperiences(profile, 'internship');
    expect(matched.map((e) => e.id)).toEqual(['exp-internship-sorting']);
    expect(rejected.map((r) => r.experience.id)).toContain('exp-underwater-vla');
  });

  it('工作经历栏收不到任何一条 —— 候选人尚无正式工作', () => {
    const { matched } = queryExperiences(profile, 'full_time_work');
    expect(matched).toHaveLength(0);
  });
});

describe('场景二：网站没有科研栏（PRD §35 的降级 + warning）', () => {
  const availableTargets = ['full_time_work', 'internship', 'project_experience'] as const;

  it('科研课题降级进入项目经历', () => {
    const { matched } = queryExperiences(profile, 'project_experience');
    expect(matched.map((e) => e.id)).toContain('exp-underwater-vla');
  });

  it('识别出发生了降级，供 Diff 生成 warning', () => {
    const downgraded = findDowngradedExperiences(profile, availableTargets);
    expect(downgraded).toHaveLength(1);
    expect(downgraded[0]?.experience.id).toBe('exp-underwater-vla');
    expect(downgraded[0]?.preferred).toBe('research_experience');
    expect(downgraded[0]?.actual).toBe('project_experience');
  });

  it('有科研栏时不产生降级', () => {
    expect(
      findDowngradedExperiences(profile, ['research_experience', 'project_experience']),
    ).toHaveLength(0);
  });

  it('降级到项目经历，但绝不降级到工作经历', () => {
    const { matched } = queryExperiences(profile, 'full_time_work');
    expect(matched.map((e) => e.id)).not.toContain('exp-underwater-vla');
  });
});

describe('场景三：奖项合并栏 vs 拆分栏', () => {
  it('合并栏收到全部 8 项', () => {
    expect(queryAwards(profile, 'combined_honors').matched).toHaveLength(8);
  });

  it('奖学金栏只收到 3 项奖学金', () => {
    const { matched } = queryAwards(profile, 'scholarship');
    expect(matched).toHaveLength(3);
    expect(matched.every((a) => a.category === 'scholarship')).toBe(true);
  });

  it('竞赛栏只收到 4 项竞赛', () => {
    const { matched } = queryAwards(profile, 'competition_award');
    expect(matched).toHaveLength(4);
    expect(matched.every((a) => a.category === 'competition_award')).toBe(true);
  });

  it('荣誉称号栏只收到「优秀研究生」', () => {
    const { matched } = queryAwards(profile, 'honor_title');
    expect(matched.map((a) => a.id)).toEqual(['aw-honor-excellent']);
  });

  it('网站限制只填 3 项时，取最高级别的', () => {
    const { matched } = queryAwards(profile, 'combined_honors', { limit: 3 });
    expect(matched).toHaveLength(3);
    expect(matched.every((a) => a.level === 'national')).toBe(true);
  });
});

describe('教育经历派生值', () => {
  it('取最高学历为硕士，不会误取本科', () => {
    expect(highestEducation(profile.educations)?.degreeType).toBe('master');
  });

  it('排名百分比换算正确', () => {
    const master = profile.educations.find((e) => e.id === 'edu-master');
    expect(master && rankingPercentile(master)).toBe(1);
  });

  it('未填 GPA 时返回 undefined，不臆造数值', () => {
    const master = profile.educations.find((e) => e.id === 'edu-master');
    expect(master && normalizedGpa(master)).toBeUndefined();
  });
});

describe('链接与附件选择', () => {
  it('网站只有一个「个人主页」框时填 GitHub（已标记 primary）', () => {
    expect(pickHomepageLink(profile.links)?.semanticType).toBe('github');
  });

  it('按岗位名挑简历版本', () => {
    expect(pickResumeVersion(profile.resumeVersions, '具身智能算法工程师')?.id).toBe('rv-robotics');
  });

  it('岗位名匹配不上时返回 undefined，不隐式兜底', () => {
    expect(pickResumeVersion(profile.resumeVersions, 'Java 后端开发')).toBeUndefined();
  });

  it('附件超过网站大小上限时被排除并说明原因', () => {
    const selection = selectAsset(profile.assets, { type: 'portfolio', maxFileSize: 1024 * 1024 });
    expect(selection.asset).toBeUndefined();
    expect(selection.rejected[0]?.reason).toContain('超过网站上限');
  });

  it('格式不被允许时被排除', () => {
    const selection = selectAsset(profile.assets, {
      type: 'award_certificate',
      allowedExtensions: ['pdf'],
    });
    expect(selection.asset).toBeUndefined();
    expect(selection.rejected[0]?.reason).toContain('格式 .jpg');
  });

  it('符合要求时选出简历', () => {
    const selection = selectAsset(profile.assets, {
      type: 'resume',
      language: 'zh',
      allowedExtensions: ['pdf'],
      maxFileSize: 10 * 1024 * 1024,
    });
    expect(selection.asset?.id).toBe('asset-resume-robotics-zh');
  });
});

describe('LLM 数据最小化（PRD §42）', () => {
  const safe = toLLMSafeProfile(profile);
  const serialized = JSON.stringify(safe);

  it('剔除手机号与邮箱', () => {
    expect(serialized).not.toContain('13800000000');
    expect(serialized).not.toContain('candidate@example.com');
    expect(safe.basicInfo).not.toHaveProperty('phone');
    expect(safe.basicInfo).not.toHaveProperty('email');
  });

  it('剔除身份证字段', () => {
    expect(safe.basicInfo).not.toHaveProperty('idNumber');
  });

  it('剔除内推码与问答库（含个人偏好答案）', () => {
    expect(safe).not.toHaveProperty('referralCodes');
    expect(safe).not.toHaveProperty('questions');
  });

  it('保留职业信息 —— 这才是 LLM 做语义理解需要的', () => {
    expect(safe.experiences).toHaveLength(2);
    expect(safe.skills).toHaveLength(5);
    expect(serialized).toContain('VLA');
  });

  it('toSafeBasicInfo 保留非敏感字段', () => {
    const safeBasic = toSafeBasicInfo(profile.basicInfo);
    expect(safeBasic.name).toBe('示例候选人');
    expect(safeBasic.expectedGraduationDate).toBe('2027-06');
  });
});

describe('导入 / 导出', () => {
  it('导出后重新导入，数据一致', () => {
    expect(importProfile(exportProfile(profile))).toEqual(profile);
  });

  it('脱敏导出时敏感字段被替换为占位符', () => {
    const redacted = exportProfile(profile, { redactSensitive: true });
    expect(redacted).not.toContain('13800000000');
    expect(redacted).toContain('<REDACTED>');
  });

  it('非法 JSON 抛结构化错误', () => {
    expect(() => importProfile('{ 坏掉的 json')).toThrow(/无法解析/);
  });

  it('schema 校验失败时错误信息带字段路径', () => {
    const broken = JSON.stringify({ schemaVersion: 1, basicInfo: { name: '' } });
    expect(() => importProfile(broken)).toThrow(/basicInfo\.name/);
  });

  it('版本高于当前支持时拒绝导入', () => {
    const future = JSON.stringify({ schemaVersion: 999, basicInfo: { name: 'x' } });
    expect(() => importProfile(future)).toThrow(/高于当前支持/);
  });
});

describe('createEmptyProfile', () => {
  it('生成可用的空白 Profile', () => {
    const empty = createEmptyProfile('张三');
    expect(empty.basicInfo.name).toBe('张三');
    expect(empty.experiences).toEqual([]);
    expect(checkProfileIntegrity(empty)).toEqual([]);
  });
});

describe('引用完整性检查能抓出坏数据', () => {
  it('检出不存在的附件引用', () => {
    const broken: CandidateProfile = {
      ...profile,
      awards: profile.awards.map((a) =>
        a.id === 'aw-honor-excellent' ? { ...a, certificateAsset: 'asset-not-exist' } : a,
      ),
    };
    const issues = checkProfileIntegrity(broken);
    expect(issues.some((i) => i.message.includes('asset-not-exist'))).toBe(true);
  });

  it('检出重复 id', () => {
    const first = profile.experiences[0];
    if (!first) throw new Error('fixture 缺少经历');
    const broken: CandidateProfile = { ...profile, experiences: [first, first] };
    expect(checkProfileIntegrity(broken).some((i) => i.message.includes('重复 id'))).toBe(true);
  });
});
