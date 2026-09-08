import { describe, expect, it } from 'vitest';
import { classifyField, summarize } from '../src/classifier.js';
import { confidenceAction } from '../src/form-field.js';
import { SEMANTIC_TO_EXPERIENCE_TARGET, isSensitiveType } from '../src/semantic-type.js';
import type { RawField } from '../src/raw-field.js';

/** 构造 RawField 的便捷函数，默认走最理想的 label[for] 路径 */
function raw(overrides: Partial<RawField> & { labelFor?: string }): RawField {
  return {
    selector: '#field',
    tagName: 'input',
    type: 'text',
    name: '',
    id: 'field',
    labelFor: '',
    wrappingLabel: '',
    ariaLabel: '',
    siblingText: '',
    placeholder: '',
    sectionTitle: '',
    nearbyText: '',
    required: false,
    disabled: false,
    maxLength: undefined,
    options: [],
    groupName: undefined,
    accept: undefined,
    visible: true,
    ...overrides,
  };
}

const classify = (
  labelFor: string,
  extra: Partial<RawField> = {},
): ReturnType<typeof classifyField> => classifyField(raw({ labelFor, ...extra }));

describe('核心难点：科研 vs 项目', () => {
  it('「科研经历」→ RESEARCH_EXPERIENCE', () => {
    expect(classify('科研经历').semanticType).toBe('RESEARCH_EXPERIENCE');
  });

  it('「课题经历」→ RESEARCH_EXPERIENCE', () => {
    expect(classify('课题经历').semanticType).toBe('RESEARCH_EXPERIENCE');
  });

  it('「研究经历」→ RESEARCH_EXPERIENCE', () => {
    expect(classify('研究经历').semanticType).toBe('RESEARCH_EXPERIENCE');
  });

  it('「Research Experience」→ RESEARCH_EXPERIENCE', () => {
    expect(classify('Research Experience').semanticType).toBe('RESEARCH_EXPERIENCE');
  });

  it('「研究项目」→ PROJECT_EXPERIENCE，不是科研', () => {
    // 字面上带「研究」，但它是项目栏 —— 这是 B 公司专门设的陷阱
    expect(classify('研究项目').semanticType).toBe('PROJECT_EXPERIENCE');
  });

  it('「项目经历」→ PROJECT_EXPERIENCE', () => {
    expect(classify('项目经历').semanticType).toBe('PROJECT_EXPERIENCE');
  });

  it('「项目简介」与「主要成果」细分为两种语义，避免两栏填同样内容', () => {
    // 都属于项目栏（映射目标相同，红线照常生效），但要填的侧面不同
    expect(classify('项目简介').semanticType).toBe('PROJECT_BRIEF');
    expect(classify('项目描述').semanticType).toBe('PROJECT_BRIEF');
    expect(classify('主要成果').semanticType).toBe('PROJECT_ACHIEVEMENT');
    expect(classify('个人贡献').semanticType).toBe('PROJECT_ACHIEVEMENT');
  });

  it('细分类型仍映射到 project_experience，红线不受影响', () => {
    expect(SEMANTIC_TO_EXPERIENCE_TARGET['PROJECT_BRIEF']).toBe('project_experience');
    expect(SEMANTIC_TO_EXPERIENCE_TARGET['PROJECT_ACHIEVEMENT']).toBe('project_experience');
  });

  it('科研与项目的判定都达到自动填写阈值', () => {
    expect(confidenceAction(classify('课题经历').confidence)).toBe('auto');
    expect(confidenceAction(classify('研究项目').confidence)).toBe('auto');
  });
});

describe('试金石：模糊字段必须转人工，绝不猜测（PRD §3.6）', () => {
  it('「实践经历」置信度低于 0.7，触发 ask_user', () => {
    const field = classify('实践经历');

    expect(field.semanticType).toBe('SOCIAL_PRACTICE');
    expect(field.confidence).toBeLessThan(0.7);
    expect(confidenceAction(field.confidence)).toBe('ask_user');
  });

  it('「社会实践」同样转人工', () => {
    expect(confidenceAction(classify('社会实践').confidence)).toBe('ask_user');
  });

  it('模糊字段绝不被硬判成实习或科研', () => {
    const field = classify('实践经历');
    expect(field.semanticType).not.toBe('INTERNSHIP');
    expect(field.semanticType).not.toBe('RESEARCH_EXPERIENCE');
  });

  it('开放式主观题转人工，不由系统代答', () => {
    const field = classify('请用三句话说明你为什么适合本岗位');
    expect(field.semanticType).toBe('QUESTION');
    expect(confidenceAction(field.confidence)).toBe('ask_user');
  });

  it('无法识别的字段置信度为 0', () => {
    const field = classify('请填写第七项补充说明栏');
    expect(field.semanticType).toBe('OTHER');
    expect(field.confidence).toBe(0);
    expect(confidenceAction(field.confidence)).toBe('ask_user');
  });
});

describe('奖项分类：奖学金 / 竞赛 / 荣誉不能混', () => {
  it('「奖学金情况」→ SCHOLARSHIP', () => {
    expect(classify('奖学金情况').semanticType).toBe('SCHOLARSHIP');
  });

  it('「竞赛获奖」「学科竞赛获奖」→ COMPETITION_AWARD', () => {
    expect(classify('竞赛获奖').semanticType).toBe('COMPETITION_AWARD');
    expect(classify('学科竞赛获奖').semanticType).toBe('COMPETITION_AWARD');
  });

  it('「荣誉称号」→ HONOR_TITLE', () => {
    expect(classify('荣誉称号').semanticType).toBe('HONOR_TITLE');
  });

  it('「荣誉奖励」→ AWARD 合并栏', () => {
    expect(classify('荣誉奖励').semanticType).toBe('AWARD');
  });

  it('奖学金不会被误判成竞赛，反之亦然', () => {
    expect(classify('奖学金').semanticType).not.toBe('COMPETITION_AWARD');
    expect(classify('竞赛获奖').semanticType).not.toBe('SCHOLARSHIP');
  });
});

describe('工作 vs 实习', () => {
  it('「工作经历」→ WORK_EXPERIENCE', () => {
    expect(classify('工作经历').semanticType).toBe('WORK_EXPERIENCE');
  });

  it('「实习经历」→ INTERNSHIP', () => {
    expect(classify('实习经历').semanticType).toBe('INTERNSHIP');
  });

  it('两者互不误判', () => {
    expect(classify('工作经历').semanticType).not.toBe('INTERNSHIP');
    expect(classify('实习经历').semanticType).not.toBe('WORK_EXPERIENCE');
  });
});

describe('label 来源影响置信度', () => {
  it('label[for] 来源不打折', () => {
    const field = classifyField(raw({ labelFor: '手机号码' }));
    expect(field.labelSource).toBe('label_for');
    expect(field.confidence).toBeCloseTo(0.96, 2);
    expect(confidenceAction(field.confidence)).toBe('auto');
  });

  it('相邻文本来源略打折，仍可自动填写但需标注', () => {
    const field = classifyField(raw({ siblingText: '手机号码' }));
    expect(field.labelSource).toBe('sibling_text');
    expect(confidenceAction(field.confidence)).toBe('auto_with_warning');
  });

  it('aria-label 来源接近满分', () => {
    const field = classifyField(raw({ ariaLabel: 'GitHub 地址', type: 'url' }));
    expect(field.labelSource).toBe('aria_label');
    expect(field.semanticType).toBe('GITHUB');
    expect(confidenceAction(field.confidence)).toBe('auto');
  });

  it('仅有 placeholder 时置信度下降到需标注区间', () => {
    const field = classifyField(raw({ placeholder: '请输入手机号', type: 'tel' }));
    expect(field.labelSource).toBe('placeholder');
    expect(field.semanticType).toBe('PHONE');
    expect(confidenceAction(field.confidence)).toBe('auto_with_warning');
  });

  it('label 装饰字符被清理', () => {
    expect(classifyField(raw({ labelFor: '姓名 *' })).label).toBe('姓名');
    expect(classifyField(raw({ labelFor: '1. 是否服从职位调剂？' })).label).toBe(
      '是否服从职位调剂？',
    );
    expect(classifyField(raw({ labelFor: '手机号：' })).label).toBe('手机号');
  });
});

describe('附件字段走独立规则表', () => {
  it('file input 的「作品集」是附件，不是链接', () => {
    const field = classifyField(raw({ labelFor: '个人作品集', type: 'file', tagName: 'input' }));
    expect(field.kind).toBe('file');
    expect(field.semanticType).toBe('PORTFOLIO_ATTACHMENT');
  });

  it('url input 的「作品集链接」是链接', () => {
    const field = classifyField(raw({ labelFor: '作品集链接', type: 'url' }));
    expect(field.semanticType).toBe('PORTFOLIO');
  });

  it('简历与成绩单上传能正确区分', () => {
    expect(classifyField(raw({ labelFor: '个人简历', type: 'file' })).semanticType).toBe(
      'RESUME_ATTACHMENT',
    );
    expect(classifyField(raw({ labelFor: '成绩单', type: 'file' })).semanticType).toBe(
      'TRANSCRIPT_ATTACHMENT',
    );
  });

  it('认不出类型的附件不瞎猜，标为 OTHER', () => {
    const field = classifyField(raw({ labelFor: '其他材料', type: 'file' }));
    expect(field.semanticType).toBe('OTHER');
    expect(confidenceAction(field.confidence)).toBe('ask_user');
  });
});

describe('上下文消歧', () => {
  it('label 命中优先于上下文命中', () => {
    const field = classifyField(raw({ labelFor: '毕业院校', sectionTitle: '项目经历' }));
    expect(field.semanticType).toBe('UNIVERSITY');
  });

  it('label 无法判定时才用区块标题，且置信度打折', () => {
    const field = classifyField(raw({ labelFor: '内容描述', sectionTitle: '科研经历' }));
    expect(field.semanticType).toBe('RESEARCH_EXPERIENCE');
    expect(field.reason).toContain('区块上下文');
    expect(field.confidence).toBeLessThan(0.7);
  });
});

describe('敏感字段标记', () => {
  it('手机 / 邮箱 / 身份证被标记为敏感', () => {
    expect(isSensitiveType(classify('手机号码').semanticType)).toBe(true);
    expect(isSensitiveType(classify('电子邮箱').semanticType)).toBe(true);
    expect(isSensitiveType(classify('身份证号').semanticType)).toBe(true);
  });

  it('经历类不属于敏感字段 —— 它们正是 LLM 需要看到的', () => {
    expect(isSensitiveType(classify('科研经历').semanticType)).toBe(false);
    expect(isSensitiveType(classify('项目经历').semanticType)).toBe(false);
  });
});

describe('字段属性透传', () => {
  it('maxLength / options / accept 被保留', () => {
    const field = classifyField(
      raw({
        labelFor: '项目简介',
        tagName: 'textarea',
        type: 'textarea',
        maxLength: 100,
      }),
    );
    expect(field.kind).toBe('textarea');
    expect(field.maxLength).toBe(100);
  });

  it('select 的选项被保留', () => {
    const field = classifyField(
      raw({
        labelFor: '学历',
        tagName: 'select',
        type: 'select',
        options: ['本科', '硕士', '博士'],
      }),
    );
    expect(field.kind).toBe('select');
    expect(field.options).toEqual(['本科', '硕士', '博士']);
  });
});

describe('summarize', () => {
  it('统计各置信度区间的字段数', () => {
    const fields = [
      classify('姓名'), // auto
      classifyField(raw({ placeholder: '请输入手机号', type: 'tel' })), // warning
      classify('实践经历'), // ask_user
      classify('无法识别的奇怪字段'), // ask_user + unrecognized
    ];

    const stats = summarize(fields);
    expect(stats.total).toBe(4);
    expect(stats.auto).toBe(1);
    expect(stats.autoWithWarning).toBe(1);
    expect(stats.askUser).toBe(2);
    expect(stats.unrecognized).toBe(1);
  });
});
