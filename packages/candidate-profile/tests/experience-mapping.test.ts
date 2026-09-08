/**
 * Experience 映射红线测试 —— PRD §76 的两条红线之一。
 *
 * 用例原型取自真实经历结构（高校课题组研究项目 vs 企业实习），
 * 但**企业名与内部项目代号已做泛化处理**，避免公开仓库暴露实习期内部信息。
 * 完整真实数据放在 gitignore 的 materials/ 下。
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPERIENCE_MAPPING,
  ExperienceSchema,
  type Experience,
  type ExperienceTarget,
  type ExperienceType,
  canMapExperienceTo,
  checkExperienceConsistency,
  isEmploymentTarget,
  resolveMappingPolicy,
} from '../src/experience.js';

/** 高校课题组的研究项目 —— 最容易被招聘网站误判成工作经历的一类 */
const labResearch: Experience = ExperienceSchema.parse({
  id: 'exp-lab-vla',
  name: '面向复杂海底环境的水下双臂垃圾捡取 VLA 算法研究',
  organization: '某高校机器人研究所',
  role: '负责人',
  startDate: '2024-09',
  endDate: '2026-06',
  experienceType: 'research_project',
  organizationType: 'university_lab',
  employmentRelation: 'student',
  semanticTags: ['VLA', '强化学习', '双臂协同'],
});

/** 企业实习 —— 这个才是真正的受雇经历 */
const companyInternship: Experience = ExperienceSchema.parse({
  id: 'exp-internship',
  name: '双臂分拣装箱长程任务 VLA-RL 系统搭建',
  organization: '某科技公司',
  role: '算法实习生',
  startDate: '2026-05',
  endDate: '2026-08',
  experienceType: 'internship',
  organizationType: 'company',
  employmentRelation: 'intern',
});

describe('红线一：科研经历绝不能进入工作经历或实习', () => {
  it('课题组研究项目被拒绝映射到 full_time_work', () => {
    const result = canMapExperienceTo(labResearch, 'full_time_work');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('禁止映射');
  });

  it('课题组研究项目被拒绝映射到 internship', () => {
    expect(canMapExperienceTo(labResearch, 'internship').allowed).toBe(false);
  });

  it('穷举：所有非雇佣类 experienceType 都不得进入受雇栏目', () => {
    const nonEmployment: ExperienceType[] = [
      'research',
      'research_project',
      'engineering_project',
      'competition_project',
      'academic_project',
      'personal_project',
      'campus_activity',
      'volunteer',
    ];
    const employmentTargets: ExperienceTarget[] = ['full_time_work', 'internship'];

    for (const type of nonEmployment) {
      for (const target of employmentTargets) {
        const policy = DEFAULT_EXPERIENCE_MAPPING[type];
        expect(policy.shouldNotMapTo.includes(target), `${type} 必须硬阻断 ${target}`).toBe(true);
        expect(policy.canMapTo.includes(target), `${type} 不得允许 ${target}`).toBe(false);
      }
    }
  });
});

describe('科研经历的正当去处', () => {
  it('可以进入科研经历栏', () => {
    expect(canMapExperienceTo(labResearch, 'research_experience').allowed).toBe(true);
  });

  it('网站没有科研栏时，允许降级进入项目经历（M4 需据此产生 warning）', () => {
    expect(canMapExperienceTo(labResearch, 'project_experience').allowed).toBe(true);
  });

  it('「社会实践」这类模糊栏目默认允许，最终仍需用户确认', () => {
    expect(canMapExperienceTo(labResearch, 'social_practice').allowed).toBe(true);
  });
});

describe('实习经历', () => {
  it('可以进入实习栏', () => {
    expect(canMapExperienceTo(companyInternship, 'internship').allowed).toBe(true);
  });

  it('不得被当作正式工作', () => {
    expect(canMapExperienceTo(companyInternship, 'full_time_work').allowed).toBe(false);
  });

  it('不得被当作科研经历', () => {
    expect(canMapExperienceTo(companyInternship, 'research_experience').allowed).toBe(false);
  });
});

describe('未声明的目标按「不猜测」处理（PRD §3.6）', () => {
  it('既不在 canMapTo 也不在 shouldNotMapTo 时拒绝', () => {
    const result = canMapExperienceTo(companyInternship, 'entrepreneurial_experience');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('未声明');
  });
});

describe('逐条覆盖默认策略', () => {
  it('显式 canMapTo 覆盖默认值', () => {
    const custom = ExperienceSchema.parse({
      ...labResearch,
      canMapTo: ['research_experience'],
      shouldNotMapTo: ['full_time_work', 'internship', 'project_experience'],
    });

    expect(canMapExperienceTo(custom, 'project_experience').allowed).toBe(false);
    expect(canMapExperienceTo(custom, 'research_experience').allowed).toBe(true);
  });

  it('覆盖后依然不能打开受雇栏目的口子（由用户自行承担，schema 不阻止但默认安全）', () => {
    const policy = resolveMappingPolicy(labResearch);
    expect(policy.shouldNotMapTo).toContain('full_time_work');
  });

  it('canMapTo 与 shouldNotMapTo 冲突时 schema 拒绝', () => {
    expect(() =>
      ExperienceSchema.parse({
        ...labResearch,
        canMapTo: ['project_experience'],
        shouldNotMapTo: ['project_experience'],
      }),
    ).toThrow(/冲突/);
  });
});

describe('日期校验', () => {
  it('拒绝倒挂的日期', () => {
    expect(() =>
      ExperienceSchema.parse({ ...labResearch, startDate: '2026-06', endDate: '2024-09' }),
    ).toThrow();
  });

  it('接受 present 作为结束时间', () => {
    expect(ExperienceSchema.parse({ ...labResearch, endDate: 'present' }).endDate).toBe('present');
  });

  it('拒绝非规范日期格式', () => {
    expect(() => ExperienceSchema.parse({ ...labResearch, startDate: '2024/09' })).toThrow();
    expect(() => ExperienceSchema.parse({ ...labResearch, startDate: '2024-13' })).toThrow();
  });
});

describe('四维标签一致性检查', () => {
  it('课题项目带雇佣关系时告警（易被误填进工作经历）', () => {
    const suspicious = ExperienceSchema.parse({ ...labResearch, employmentRelation: 'employee' });
    const warnings = checkExperienceConsistency(suspicious);
    expect(warnings.some((w) => w.message.includes('容易被误填进工作经历'))).toBe(true);
  });

  it('标为实习但雇佣关系不是 intern 时告警', () => {
    const suspicious = ExperienceSchema.parse({
      ...companyInternship,
      employmentRelation: 'employee',
    });
    expect(checkExperienceConsistency(suspicious)).not.toHaveLength(0);
  });

  it('正常数据不产生告警', () => {
    expect(checkExperienceConsistency(labResearch)).toHaveLength(0);
    expect(checkExperienceConsistency(companyInternship)).toHaveLength(0);
  });
});

describe('isEmploymentTarget', () => {
  it('识别受雇性质的栏目', () => {
    expect(isEmploymentTarget('full_time_work')).toBe(true);
    expect(isEmploymentTarget('internship')).toBe(true);
    expect(isEmploymentTarget('research_experience')).toBe(false);
    expect(isEmploymentTarget('project_experience')).toBe(false);
  });
});
