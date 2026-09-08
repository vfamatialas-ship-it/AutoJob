/**
 * 规则层语义分类 —— PRD §53「优先规则，规则无法判断才用 LLM」。
 *
 * ## 为什么规则优先
 *
 * 校招表单的字段名高度收敛：姓名、手机、学校、专业、工作经历……
 * 这些用规则能覆盖绝大多数，且**确定、免费、可解释、可测试**。
 * 把 LLM 当第一道防线既慢又贵，出了错还查不出原因。
 *
 * ## 规则顺序即优先级
 *
 * 规则表**从具体到宽泛**排列，第一个命中的胜出。顺序不是随意的，典型例子：
 *
 *   「研究项目」 → PROJECT_EXPERIENCE   （不是科研！）
 *   「课题经历」 → RESEARCH_EXPERIENCE
 *
 * 两者都含「研究/课题」字样，靠的是 RESEARCH 的模式要求「经历/情况/工作」后缀，
 * 而不是裸的「研究」二字。这类区分是本文件存在的全部意义。
 *
 * ## 模糊字段绝不硬判
 *
 * 「实践经历」可能指实习、社团、科研或志愿服务。这类字段给低置信度，
 * 由上层转入 WAITING_USER 问用户（PRD §3.6）。**宁可问，不可猜。**
 */

import type { SemanticType } from './semantic-type.js';

export interface ClassificationRule {
  readonly semanticType: SemanticType;
  readonly pattern: RegExp;
  /** 规则本身的把握程度。与 label 来源可信度相乘得到最终置信度 */
  readonly confidence: number;
  /** 为什么这么判，出现在 Diff 与日志里 */
  readonly note: string;
}

/** 附件字段专用规则（仅对 input[type=file] 生效） */
export const ATTACHMENT_RULES: readonly ClassificationRule[] = [
  {
    semanticType: 'RESUME_ATTACHMENT',
    pattern: /简历|resume|cv\b/i,
    confidence: 0.97,
    note: '附件字段且提及简历',
  },
  {
    semanticType: 'TRANSCRIPT_ATTACHMENT',
    pattern: /成绩单|成绩证明|transcript/i,
    confidence: 0.97,
    note: '附件字段且提及成绩单',
  },
  {
    semanticType: 'PORTFOLIO_ATTACHMENT',
    pattern: /作品集|作品|portfolio/i,
    confidence: 0.95,
    note: '附件字段且提及作品集',
  },
  {
    semanticType: 'CERTIFICATE_ATTACHMENT',
    pattern: /证书|证明材料|获奖证明|certificate/i,
    confidence: 0.93,
    note: '附件字段且提及证书',
  },
  {
    semanticType: 'PHOTO_ATTACHMENT',
    pattern: /照片|头像|证件照|photo/i,
    confidence: 0.95,
    note: '附件字段且提及照片',
  },
];

/**
 * 通用规则表。**顺序即优先级，改动前先想清楚会不会影响上下文相邻的规则。**
 */
export const CLASSIFICATION_RULES: readonly ClassificationRule[] = [
  // ============ 链接类（要在「作品集」等词被经历类规则吃掉之前判定）============
  {
    semanticType: 'GITHUB',
    pattern: /github|码云|gitee/i,
    confidence: 0.98,
    note: '明确提及 GitHub / Gitee',
  },
  {
    semanticType: 'PORTFOLIO',
    pattern: /作品集链接|作品链接|portfolio\s*(url|link|地址)/i,
    confidence: 0.95,
    note: '作品集链接',
  },
  {
    semanticType: 'BLOG',
    pattern: /博客|blog/i,
    confidence: 0.92,
    note: '博客地址',
  },
  {
    semanticType: 'PERSONAL_HOMEPAGE',
    pattern: /个人主页|个人网站|个人首页|homepage|personal\s*(site|page)/i,
    confidence: 0.95,
    note: '个人主页',
  },

  // ============ 内推码 ============
  {
    semanticType: 'REFERRAL_CODE',
    pattern: /内推码|推荐码|内推编码|referral\s*code/i,
    confidence: 0.98,
    note: '内推码',
  },

  // ============ 经历类 —— 本文件最关键的部分 ============
  {
    semanticType: 'WORK_EXPERIENCE',
    pattern: /工作经历|工作经验|工作履历|任职经历|职业经历|work\s*experience|employment\s*history/i,
    confidence: 0.96,
    note: '工作经历',
  },
  {
    semanticType: 'INTERNSHIP',
    pattern: /实习经历|实习经验|实习情况|实习信息|internship/i,
    confidence: 0.96,
    note: '实习经历',
  },
  {
    // 注意：要求「经历/情况/工作/背景」后缀，避免把「研究项目」误吞
    semanticType: 'RESEARCH_EXPERIENCE',
    pattern:
      /科研经历|科研情况|科研工作|科研背景|课题经历|课题研究|课题情况|研究经历|研究工作|学术经历|research\s*experience/i,
    confidence: 0.95,
    note: '科研 / 课题经历',
  },
  {
    // 「研究项目」落在这里而不是上一条 —— 它是项目栏，不是科研栏
    semanticType: 'PROJECT_EXPERIENCE',
    pattern:
      /项目经历|项目经验|研究项目|科研项目|项目简介|项目描述|项目情况|项目名称|主要成果|个人贡献|project\s*(experience|description)/i,
    confidence: 0.95,
    note: '项目经历',
  },
  {
    semanticType: 'COMPETITION_EXPERIENCE',
    pattern: /竞赛经历|比赛经历|参赛经历/i,
    confidence: 0.93,
    note: '竞赛经历',
  },
  {
    semanticType: 'CAMPUS_ACTIVITY',
    pattern: /校园经历|社团经历|学生工作|校内活动|社团活动|campus\s*activity/i,
    confidence: 0.93,
    note: '校园经历',
  },
  {
    semanticType: 'VOLUNTEER_EXPERIENCE',
    pattern: /志愿|公益|volunteer/i,
    confidence: 0.93,
    note: '志愿服务',
  },
  {
    semanticType: 'ENTREPRENEURIAL_EXPERIENCE',
    pattern: /创业经历|创业项目/i,
    confidence: 0.93,
    note: '创业经历',
  },
  {
    /**
     * 「实践经历」「社会实践」语义天然模糊 —— 可能指实习、社团、科研或志愿。
     * 置信度刻意压到 0.7 以下，强制转入 WAITING_USER（PRD §3.6）。
     * 这条规则的价值不是「判对」，而是「明确承认判不了」。
     */
    semanticType: 'SOCIAL_PRACTICE',
    pattern: /实践经历|社会实践|实践情况|实践活动/i,
    confidence: 0.55,
    note: '「实践经历」含义模糊，可能指实习/社团/科研/志愿，需用户确认',
  },

  // ============ 奖项类（具体在前，合并栏在后）============
  {
    semanticType: 'SCHOLARSHIP',
    pattern: /奖学金|scholarship/i,
    confidence: 0.97,
    note: '奖学金',
  },
  {
    semanticType: 'COMPETITION_AWARD',
    pattern: /竞赛获奖|学科竞赛|比赛获奖|竞赛奖项|获奖竞赛|competition\s*award/i,
    confidence: 0.96,
    note: '竞赛获奖',
  },
  {
    semanticType: 'ACADEMIC_AWARD',
    pattern: /学术奖励|论文奖|科研奖励|学术成果奖/i,
    confidence: 0.93,
    note: '学术 / 科研奖励',
  },
  {
    semanticType: 'HONOR_TITLE',
    pattern: /荣誉称号|荣誉称谓|个人荣誉/i,
    confidence: 0.94,
    note: '荣誉称号',
  },
  {
    // 合并栏：网站只给一个框，各类奖项都往里填
    semanticType: 'AWARD',
    pattern: /荣誉奖励|获奖情况|奖励情况|所获奖项|获奖经历|荣誉与获奖|奖励与荣誉|awards?\b/i,
    confidence: 0.92,
    note: '合并的荣誉奖励栏',
  },

  // ============ 教育类 ============
  {
    semanticType: 'UNIVERSITY',
    pattern: /毕业院校|就读学校|学校名称|院校名称|毕业学校|学校|大学|university|school/i,
    confidence: 0.94,
    note: '学校',
  },
  {
    semanticType: 'COLLEGE',
    pattern: /学院|院系|系别|faculty|department/i,
    confidence: 0.92,
    note: '学院 / 院系',
  },
  {
    semanticType: 'DEGREE',
    pattern: /学历|学位|最高学历|培养层次|degree|education\s*level/i,
    confidence: 0.95,
    note: '学历 / 学位',
  },
  {
    semanticType: 'MINOR',
    pattern: /辅修|双学位|second\s*major|minor/i,
    confidence: 0.93,
    note: '辅修 / 双学位',
  },
  {
    semanticType: 'MAJOR',
    pattern: /专业|所学专业|major/i,
    confidence: 0.94,
    note: '专业',
  },
  {
    semanticType: 'GPA',
    pattern: /gpa|绩点|平均学分绩|平均成绩/i,
    confidence: 0.96,
    note: 'GPA / 绩点',
  },
  {
    semanticType: 'RANKING',
    pattern: /排名|专业排名|年级排名|rank/i,
    confidence: 0.93,
    note: '排名',
  },
  {
    semanticType: 'GRADUATION_DATE',
    pattern: /毕业时间|毕业年份|毕业日期|预计毕业|graduation\s*(date|year)/i,
    confidence: 0.96,
    note: '毕业时间',
  },
  {
    semanticType: 'ENROLLMENT_DATE',
    pattern: /入学时间|入学年份|enrollment/i,
    confidence: 0.94,
    note: '入学时间',
  },
  {
    semanticType: 'COURSEWORK',
    pattern: /主修课程|核心课程|相关课程|coursework/i,
    confidence: 0.92,
    note: '课程',
  },

  // ============ 基本信息 ============
  {
    semanticType: 'PERSON_NAME',
    pattern: /^姓名$|真实姓名|申请人姓名|中文姓名|姓\s*名|full\s*name|^name$/i,
    confidence: 0.97,
    note: '姓名',
  },
  {
    semanticType: 'ID_NUMBER',
    pattern: /身份证|证件号码|身份证件号|id\s*(card|number)/i,
    confidence: 0.98,
    note: '身份证号（敏感字段）',
  },
  {
    semanticType: 'PHONE',
    pattern: /手机|电话|联系方式|联系电话|移动电话|phone|mobile|tel\b/i,
    confidence: 0.96,
    note: '手机号（敏感字段）',
  },
  {
    semanticType: 'EMAIL',
    pattern: /邮箱|电子邮件|电子邮箱|e-?mail/i,
    confidence: 0.97,
    note: '邮箱（敏感字段）',
  },
  {
    semanticType: 'WECHAT',
    pattern: /微信|wechat/i,
    confidence: 0.96,
    note: '微信（敏感字段）',
  },
  {
    semanticType: 'GENDER',
    pattern: /^性别$|性\s*别|gender|^sex$/i,
    confidence: 0.97,
    note: '性别',
  },
  {
    semanticType: 'BIRTHDAY',
    pattern: /出生日期|出生年月|生日|birth/i,
    confidence: 0.95,
    note: '出生日期（敏感字段）',
  },
  {
    semanticType: 'ETHNICITY',
    pattern: /民族|ethnic/i,
    confidence: 0.95,
    note: '民族',
  },
  {
    semanticType: 'POLITICAL_STATUS',
    pattern: /政治面貌|党团情况/i,
    confidence: 0.97,
    note: '政治面貌',
  },
  {
    semanticType: 'HOMETOWN',
    pattern: /籍贯|生源地|户籍/i,
    confidence: 0.95,
    note: '籍贯（敏感字段）',
  },
  {
    semanticType: 'LOCATION',
    pattern: /现居|居住地|通讯地址|常住地址|现住址/i,
    confidence: 0.93,
    note: '现居地（敏感字段）',
  },

  // ============ 求职意向 ============
  {
    semanticType: 'EXPECTED_LOCATION',
    pattern: /期望(工作)?(城市|地点|地区)|意向城市|工作地点|可接受.*地点|preferred\s*location/i,
    confidence: 0.95,
    note: '期望工作地点',
  },
  {
    semanticType: 'EXPECTED_SALARY',
    pattern: /期望(年薪|月薪|薪资|薪酬)|薪资要求|expected\s*salary/i,
    confidence: 0.96,
    note: '期望薪资',
  },
  {
    semanticType: 'AVAILABLE_DATE',
    pattern: /到岗时间|可入职时间|最快.*到岗|available\s*date/i,
    confidence: 0.95,
    note: '到岗时间',
  },
  {
    semanticType: 'SOURCE_CHANNEL',
    pattern: /招聘信息.*渠道|了解到.*招聘|信息来源|获知渠道/i,
    confidence: 0.93,
    note: '招聘信息渠道',
  },

  // ============ 技能 ============
  {
    semanticType: 'LANGUAGE_SKILL',
    pattern: /英语(水平|等级|能力)|外语(水平|能力)|语言能力|cet|雅思|托福|ielts|toefl/i,
    confidence: 0.94,
    note: '语言能力',
  },
  {
    semanticType: 'SKILL',
    pattern: /专业技能|技能特长|掌握技能|技术栈|skills?\b/i,
    confidence: 0.93,
    note: '技能',
  },

  // ============ 常见问答（具体问题在前，开放题兜底）============
  {
    semanticType: 'QUESTION',
    pattern: /服从.*调剂|接受.*调剂|岗位调剂|职位调剂|地点调配|工作地点调剂/i,
    confidence: 0.94,
    note: '调剂类问题，交由 Question Bank 应答',
  },
  {
    semanticType: 'QUESTION',
    pattern: /亲属|亲戚|家属.*本公司/i,
    confidence: 0.93,
    note: '亲属关系问题',
  },
  {
    semanticType: 'QUESTION',
    pattern: /加班|出差|竞业|犯罪记录|违纪/i,
    confidence: 0.92,
    note: '常见是非类问题',
  },
  {
    semanticType: 'AGREEMENT',
    pattern: /同意|承诺|授权|隐私政策|用户协议|已阅读/i,
    confidence: 0.9,
    note: '协议勾选',
  },
  {
    /**
     * 开放式主观题（「请说明」「谈谈你的看法」）。
     * Question Bank 不可能有现成答案，也不该由 LLM 代写 —— 置信度压低转人工。
     */
    semanticType: 'QUESTION',
    pattern: /请(简述|说明|阐述|谈谈)|为什么|你认为|如何看待|三句话/i,
    confidence: 0.5,
    note: '开放式主观题，需用户亲自作答',
  },
];
