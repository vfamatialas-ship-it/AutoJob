/**
 * Mock 站点清单 —— PRD §67。
 *
 * 每个 Mock 站不是随便写的页面，而是**针对性制造一类困难**。
 * manifest 声明了：这个站长什么样、刁难点在哪、字段应当被识别成什么语义。
 *
 * 用途：
 * - M2：E2E 测试据此断言页面结构确实包含预期字段
 * - M3：语义分类器的快照测试基准（分类结果必须等于 semanticType）
 * - M4：映射引擎的验收基准（哪些经历/奖项应该出现在哪个栏目）
 *
 * 关键点：**Mock 站必须真的难**。如果 Mock 站都是规规矩矩的 <label for>，
 * 那在它上面跑通不代表任何事情 —— 真实招聘网站不长这样。
 */

// 语义类型直接引用 form-schema 的权威定义，避免两处各维护一份导致漂移。
// M2 阶段这里曾复制过一份子集，M3 落地后统一到单一来源。
import type { SemanticType } from '../../../packages/form-schema/src/semantic-type.js';

export type { SemanticType };

/** 该字段用来考察分类器的什么能力 */
export type FieldChallenge =
  /** label 通过 <label for> 正常关联 —— 基线难度 */
  | 'plain_label'
  /** label 是相邻文本节点，没有 for 属性 */
  | 'sibling_text'
  /** label 藏在 placeholder 里 */
  | 'placeholder_only'
  /** 只有 aria-label */
  | 'aria_only'
  /** 字段名用了不常见的说法（课题经历 / 研究项目 / 实践经历） */
  | 'unusual_wording'
  /** 中英混排 */
  | 'mixed_language'
  /** 语义天然模糊，应进入 WAITING_USER */
  | 'ambiguous';

export interface MockField {
  /** CSS selector，E2E 测试用它定位 */
  readonly selector: string;
  /** 页面上显示的文案 */
  readonly label: string;
  readonly semanticType: SemanticType;
  readonly required: boolean;
  readonly challenge: FieldChallenge;
  readonly maxLength?: number;
  /** 期望分类器输出的最低置信度。ambiguous 字段应低于 0.7 触发 WAITING_USER */
  readonly expectAmbiguous?: boolean;
}

/** 该站提供哪些经历/奖项栏目 —— M4 据此决定往哪填、是否需要降级 */
export interface MockTargets {
  readonly experience: readonly string[];
  readonly award: readonly string[];
}

export interface MockSite {
  readonly id: string;
  readonly name: string;
  /** 这个站专门制造什么困难 */
  readonly quirks: readonly string[];
  readonly applyPath: string;
  readonly targets: MockTargets;
  readonly fields: readonly MockField[];
  /** 期望 M4 产生的 warning 关键词，为空表示不应有 warning */
  readonly expectedWarnings: readonly string[];
  /**
   * 页面被登录/验证码挡住，初始状态下表单不可见。
   * 通用的结构性断言（如「提交按钮可见」）对这类站不适用，由专项用例覆盖。
   */
  readonly gated?: boolean;
}

export const MOCK_SITES: readonly MockSite[] = [
  {
    id: 'mock_company_a',
    name: 'A 公司 · 只有工作经历栏',
    quirks: [
      '没有独立的科研经历栏目，科研课题只能降级进项目经历',
      '奖项只有一个「荣誉奖励」合并栏',
      '部分 label 用相邻文本节点，没有 for 属性',
    ],
    applyPath: '/mock_company_a/apply.html',
    targets: {
      experience: ['full_time_work', 'internship', 'project_experience'],
      award: ['combined_honors'],
    },
    fields: [
      {
        selector: '#name',
        label: '姓名',
        semanticType: 'PERSON_NAME',
        required: true,
        challenge: 'plain_label',
      },
      {
        selector: '#mobile',
        label: '手机号码',
        semanticType: 'PHONE',
        required: true,
        challenge: 'sibling_text',
      },
      {
        selector: '#mail',
        label: '电子邮箱',
        semanticType: 'EMAIL',
        required: true,
        challenge: 'sibling_text',
      },
      {
        selector: '#school',
        label: '毕业院校',
        semanticType: 'UNIVERSITY',
        required: true,
        challenge: 'plain_label',
      },
      {
        selector: '#major',
        label: '所学专业',
        semanticType: 'MAJOR',
        required: true,
        challenge: 'plain_label',
      },
      {
        selector: '#edu-level',
        label: '学历',
        semanticType: 'DEGREE',
        required: true,
        challenge: 'plain_label',
      },
      {
        selector: '#work-exp',
        label: '工作经历',
        semanticType: 'WORK_EXPERIENCE',
        required: false,
        challenge: 'plain_label',
      },
      {
        selector: '#project-exp',
        label: '项目经历',
        semanticType: 'PROJECT_EXPERIENCE',
        required: false,
        challenge: 'plain_label',
      },
      {
        selector: '#honors',
        label: '荣誉奖励',
        semanticType: 'AWARD',
        required: false,
        challenge: 'plain_label',
      },
      {
        selector: '#homepage',
        label: '个人主页',
        semanticType: 'PERSONAL_HOMEPAGE',
        required: false,
        challenge: 'plain_label',
      },
    ],
    expectedWarnings: ['科研', '项目经历'],
  },
  {
    id: 'mock_company_b',
    name: 'B 公司 · 科研/项目/实习三栏分开且用词生僻',
    quirks: [
      '科研栏叫「课题经历」，项目栏叫「研究项目」—— 考察同义词识别',
      '实习栏叫「实践经历」—— 语义模糊，应触发 WAITING_USER',
      '有 aria-label 但无可见 label 的字段',
    ],
    applyPath: '/mock_company_b/apply.html',
    targets: {
      experience: ['internship', 'research_experience', 'project_experience', 'social_practice'],
      award: ['scholarship', 'competition_award'],
    },
    fields: [
      {
        selector: '#applicant-name',
        label: '真实姓名',
        semanticType: 'PERSON_NAME',
        required: true,
        challenge: 'plain_label',
      },
      {
        selector: '#contact-phone',
        label: '联系电话',
        semanticType: 'PHONE',
        required: true,
        challenge: 'plain_label',
      },
      {
        selector: '#contact-email',
        label: 'Email',
        semanticType: 'EMAIL',
        required: true,
        challenge: 'mixed_language',
      },
      {
        selector: '#univ',
        label: '就读学校',
        semanticType: 'UNIVERSITY',
        required: true,
        challenge: 'plain_label',
      },
      {
        selector: '#gpa',
        label: '绩点 / GPA',
        semanticType: 'GPA',
        required: false,
        challenge: 'mixed_language',
      },
      {
        selector: '#topic-exp',
        label: '课题经历',
        semanticType: 'RESEARCH_EXPERIENCE',
        required: false,
        challenge: 'unusual_wording',
      },
      {
        selector: '#research-proj',
        label: '研究项目',
        semanticType: 'PROJECT_EXPERIENCE',
        required: false,
        challenge: 'unusual_wording',
      },
      {
        selector: '#practice-exp',
        label: '实践经历',
        semanticType: 'SOCIAL_PRACTICE',
        required: false,
        challenge: 'ambiguous',
        expectAmbiguous: true,
      },
      {
        selector: '#scholarship',
        label: '奖学金情况',
        semanticType: 'SCHOLARSHIP',
        required: false,
        challenge: 'plain_label',
      },
      {
        selector: '#competition',
        label: '竞赛获奖',
        semanticType: 'COMPETITION_AWARD',
        required: false,
        challenge: 'plain_label',
      },
      {
        selector: '#gh',
        label: 'GitHub 地址',
        semanticType: 'GITHUB',
        required: false,
        challenge: 'aria_only',
      },
    ],
    expectedWarnings: [],
  },
  {
    id: 'mock_company_c',
    name: 'C 公司 · 奖学金与竞赛严格分栏 + 字数限制',
    quirks: [
      '奖学金与竞赛获奖是两个独立栏目，混填即为错误',
      '项目描述限制 100 字，成果描述限制 300 字',
      '有 placeholder 但无 label 的字段',
    ],
    applyPath: '/mock_company_c/apply.html',
    targets: {
      experience: ['internship', 'research_experience', 'project_experience'],
      award: ['scholarship', 'competition_award', 'honor_title'],
    },
    fields: [
      {
        selector: '#c-name',
        label: '姓名',
        semanticType: 'PERSON_NAME',
        required: true,
        challenge: 'plain_label',
      },
      {
        selector: '#c-phone',
        label: '手机',
        semanticType: 'PHONE',
        required: true,
        challenge: 'placeholder_only',
      },
      {
        selector: '#c-research',
        label: '科研经历',
        semanticType: 'RESEARCH_EXPERIENCE',
        required: false,
        challenge: 'plain_label',
      },
      {
        selector: '#c-project-brief',
        label: '项目简介',
        semanticType: 'PROJECT_BRIEF',
        required: false,
        challenge: 'plain_label',
        maxLength: 100,
      },
      {
        selector: '#c-achievement',
        label: '主要成果',
        semanticType: 'PROJECT_ACHIEVEMENT',
        required: false,
        challenge: 'plain_label',
        maxLength: 300,
      },
      {
        selector: '#c-scholarship',
        label: '奖学金',
        semanticType: 'SCHOLARSHIP',
        required: false,
        challenge: 'plain_label',
      },
      {
        selector: '#c-competition',
        label: '学科竞赛获奖',
        semanticType: 'COMPETITION_AWARD',
        required: false,
        challenge: 'plain_label',
      },
      {
        selector: '#c-honor',
        label: '荣誉称号',
        semanticType: 'HONOR_TITLE',
        required: false,
        challenge: 'plain_label',
      },
      {
        selector: '#c-referral',
        label: '内推码',
        semanticType: 'REFERRAL_CODE',
        required: false,
        challenge: 'plain_label',
      },
    ],
    expectedWarnings: [],
  },
  {
    id: 'mock_widgets',
    name: 'D 公司 · 全是自定义控件',
    quirks: [
      '学历是 div 模拟的自定义下拉，选项点开才渲染，不能用 selectOption',
      '院校是 autocomplete，输入后延迟 250ms 才出候选',
      '性别与调剂用 radio，工作地点用 checkbox',
      '毕业时间是原生 date，格式必须 YYYY-MM-DD',
    ],
    applyPath: '/mock_widgets/apply.html',
    targets: { experience: [], award: [] },
    fields: [
      {
        selector: '#w-name',
        label: '姓名',
        semanticType: 'PERSON_NAME',
        required: true,
        challenge: 'plain_label',
      },
      {
        selector: '#w-graduation',
        label: '毕业时间',
        semanticType: 'GRADUATION_DATE',
        required: true,
        challenge: 'plain_label',
      },
      {
        // 真实值写在隐藏 input 里，label 靠行内相邻文本识别
        selector: '#w-degree',
        label: '最高学历',
        semanticType: 'DEGREE',
        required: true,
        challenge: 'sibling_text',
      },
      {
        selector: '#w-school',
        label: '毕业院校',
        semanticType: 'UNIVERSITY',
        required: true,
        challenge: 'plain_label',
      },
    ],
    expectedWarnings: [],
  },
  {
    id: 'mock_repeatable',
    name: 'E 公司 · Repeatable Section',
    quirks: [
      '教育/科研/项目三个分区初始都是 0 条，必须点「添加一条」才生成字段',
      'selector 带索引（edu-0-school / edu-1-school）',
      '删除某条后索引不重排，专门制造索引陷阱',
    ],
    applyPath: '/mock_repeatable/apply.html',
    targets: {
      experience: ['research_experience', 'project_experience'],
      award: [],
    },
    // 初始为空，字段由交互动态生成，因此 fields 留空，由专门的 E2E 用例覆盖
    fields: [],
    expectedWarnings: [],
  },
  {
    id: 'mock_upload',
    name: 'F 公司 · 三个上传位，限制各不相同',
    quirks: [
      '简历仅 PDF ≤2MB；成绩单 PDF/JPG/PNG ≤5MB；作品集仅 PDF ≤10MB',
      'input[type=file] 被 CSS 隐藏，只有 label 触发器',
      '前端真的会校验格式与大小并显示错误',
    ],
    applyPath: '/mock_upload/apply.html',
    targets: { experience: [], award: [] },
    fields: [
      {
        selector: '#up-resume',
        label: '个人简历',
        semanticType: 'RESUME_ATTACHMENT',
        required: true,
        challenge: 'sibling_text',
      },
      {
        selector: '#up-transcript',
        label: '成绩单',
        semanticType: 'TRANSCRIPT_ATTACHMENT',
        required: false,
        challenge: 'sibling_text',
      },
      {
        selector: '#up-portfolio',
        label: '个人作品集',
        semanticType: 'PORTFOLIO_ATTACHMENT',
        required: false,
        challenge: 'sibling_text',
      },
    ],
    expectedWarnings: [],
  },
  {
    id: 'mock_qa',
    name: 'G 公司 · 校招问答轰炸',
    quirks: [
      '「是否服从职位调剂」与标准问法不一致，需语义匹配',
      '问题用 <p> 承载，不用 <label for>',
      '第 10 题是公司特有开放题，Question Bank 必然匹配不上 → WAITING_USER',
    ],
    applyPath: '/mock_qa/apply.html',
    targets: { experience: [], award: [] },
    fields: [
      {
        selector: '#q-city',
        label: '你的期望工作城市是？',
        semanticType: 'EXPECTED_LOCATION',
        required: true,
        challenge: 'sibling_text',
      },
      {
        selector: '#q-salary',
        label: '期望年薪（税前，单位：万元）',
        semanticType: 'EXPECTED_SALARY',
        required: true,
        challenge: 'sibling_text',
      },
      {
        // 归为技能而非问答：Profile 的 skills 里有语言类技能，可直接取值，
        // 不必绕 Question Bank。（M2 初稿曾误标为 QUESTION，M3 分类器暴露了这一点）
        selector: '#q-english',
        label: '英语水平',
        semanticType: 'LANGUAGE_SKILL',
        required: true,
        challenge: 'sibling_text',
      },
      {
        selector: '#q-open',
        label: '请用三句话说明你为什么适合本岗位',
        semanticType: 'QUESTION',
        required: true,
        challenge: 'ambiguous',
        expectAmbiguous: true,
        maxLength: 500,
      },
    ],
    expectedWarnings: [],
  },
  {
    id: 'mock_login',
    name: 'H 公司 · 申请表被登录挡住',
    quirks: [
      '初始只显示扫码登录页，表单区域根本不在 DOM 中',
      '页面文本含「扫码登录」「验证码」等特征词，供登录检测识别',
      '登录态写入 localStorage，用于验证 Persistent Context 复用',
    ],
    applyPath: '/mock_login/apply.html',
    gated: true,
    targets: {
      experience: ['research_experience', 'project_experience'],
      award: [],
    },
    // 登录前字段不存在，登录后才可解析，因此由专门的 E2E 用例覆盖
    fields: [],
    expectedWarnings: [],
  },
];

export const findSite = (id: string): MockSite | undefined =>
  MOCK_SITES.find((site) => site.id === id);
