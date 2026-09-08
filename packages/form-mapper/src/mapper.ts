/**
 * Field Mapping Engine —— PRD §20。
 *
 *   FormField → 理解 semanticType → 查询 Candidate Profile → 得到数据 → 转成网站格式
 *
 * ## 三道闸
 *
 * 一个候选记录要进入某个网页字段，必须同时过三关：
 *   1. Profile 自身的 shouldNotMapTo（M1 定的，规则不可解除）
 *   2. MappingRule 的 blockedCandidateTypes（各级规则的并集）
 *   3. 字段语义置信度 >= 0.7（M3 算的，低了转人工）
 *
 * 任何一关不过就不填，并给出可读的原因 —— 原因会进 Application Diff，
 * 让用户看到「为什么这条没填」，而不是默默消失。
 */

import {
  canMapAwardTo,
  canMapExperienceTo,
  findReferralCode,
  findLink,
  highestEducation,
  isQuestionApplicable,
  pickHomepageLink,
  pickVariantForLimit,
  queryAwards,
  queryExperiences,
  selectAsset,
  sortAwardsByWeight,
  type Award,
  type AwardTarget,
  type CandidateProfile,
  type Experience,
  type ExperienceTarget,
  type Project,
} from '@autojob/candidate-profile';
import {
  SEMANTIC_TO_AWARD_TARGET,
  SEMANTIC_TO_EXPERIENCE_TARGET,
  confidenceAction,
  type AssetTypeHint,
  type FormField,
} from './semantic-bridge.js';
import { MappingRuleStore, type RuleContext } from './mapping-rule.js';
import { joinEntries, renderAward, renderExperience, renderProject } from './value-renderer.js';
import { warn, type MappingWarning } from './warnings.js';
import { adaptEntries, type AdaptableRecord, type ContentEmphasis } from '@autojob/content-adapter';

/**
 * Experience / Project → ContentAdapter 能吃的形态。
 * 两者字段名略有出入（techStack vs technologies），在这里抹平。
 */
function toAdaptable(record: Experience | Project): AdaptableRecord {
  return {
    id: record.id,
    name: record.name,
    ...(record.organization === undefined || record.organization.length === 0
      ? {}
      : { organization: record.organization }),
    ...(record.role === undefined || record.role.length === 0 ? {} : { role: record.role }),
    startDate: record.startDate,
    endDate: record.endDate,
    descriptionCanonical: record.descriptionCanonical,
    responsibilities: record.responsibilities,
    achievements: record.achievements,
    canonicalFacts: record.canonicalFacts,
  };
}

/**
 * 从岗位名里抽关键词，用于压缩时的侧重（PRD §31「可以针对岗位强化表达」）。
 * 只做切分，不做语义扩展 —— 强化的是「保留哪句」，不是「写什么」。
 */
/** 细分语义 → 内容侧重。未列出的按 full 处理 */
const EMPHASIS_BY_SEMANTIC: Readonly<Partial<Record<string, ContentEmphasis>>> = {
  PROJECT_BRIEF: 'brief',
  PROJECT_ACHIEVEMENT: 'achievement',
};

function extractKeywords(jobTitle: string): string[] {
  return jobTitle
    .split(/[\s\-—·/、,，()（）]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}

export type MappingStatus = 'filled' | 'skipped' | 'ask_user';

export interface FieldMapping {
  readonly field: FormField;
  readonly status: MappingStatus;
  /** 待填入的文本。status !== 'filled' 时为空 */
  readonly value: string;
  /** 数据来自 Profile 的哪些记录 —— Diff 的溯源依据 */
  readonly sourceRecordIds: readonly string[];
  /** 被排除的记录及原因 */
  readonly excluded: ReadonlyArray<{ recordId: string; reason: string }>;
  readonly warnings: readonly MappingWarning[];
  readonly reason: string;
  /** 生效的规则来源 */
  readonly ruleSource: string;
}

export interface FormPlan {
  readonly mappings: readonly FieldMapping[];
  /** 跨字段的全局警告（如「本站没有科研栏」） */
  readonly formWarnings: readonly MappingWarning[];
}

export interface MapContext extends RuleContext {
  readonly profile: CandidateProfile;
  readonly rules?: MappingRuleStore;
  /** 用于内推码有效期判断，格式 YYYY-MM-DD */
  readonly today?: string;
  /** 目标岗位名，用于挑简历版本 */
  readonly jobTitle?: string;
}

// ————————————————————————————————————————————————
// 经历类
// ————————————————————————————————————————————————

function mapExperienceField(
  field: FormField,
  context: MapContext,
  target: ExperienceTarget,
): FieldMapping {
  const { profile } = context;
  const rules = context.rules ?? new MappingRuleStore();
  const resolved = rules.resolve(field.label, field.semanticType, context);

  const { matched, rejected } = queryExperiences(profile, target);
  const excluded = rejected.map((item) => ({ recordId: item.experience.id, reason: item.reason }));
  const warnings: MappingWarning[] = [];

  // 规则层的阻断与 Profile 层的阻断取并集
  const allowedByRule: Experience[] = [];
  for (const experience of matched) {
    if (resolved.blocked.has(experience.experienceType)) {
      excluded.push({
        recordId: experience.id,
        reason: `被规则「${resolved.winner?.note ?? '内置规则'}」阻断：${experience.experienceType} 不得进入 ${field.semanticType}`,
      });
      continue;
    }
    allowedByRule.push(experience);
  }

  if (excluded.some((item) => item.reason.includes('被规则'))) {
    warnings.push(
      warn('BLOCKED_BY_RULE', `「${field.label}」有记录被映射规则阻断，未填入`, {
        fieldSelector: field.selector,
      }),
    );
  }

  // 项目经历栏还要合入 Project 集合 —— 它们天然属于项目
  const projects: Project[] = target === 'project_experience' ? [...profile.projects] : [];

  if (allowedByRule.length === 0 && projects.length === 0) {
    return {
      field,
      status: 'skipped',
      value: '',
      sourceRecordIds: [],
      excluded,
      warnings: [
        ...warnings,
        field.required
          ? warn('REQUIRED_FIELD_EMPTY', `必填字段「${field.label}」没有可填的记录`, {
              fieldSelector: field.selector,
            })
          : warn('NO_MATCHING_DATA', `「${field.label}」没有匹配的经历，已留空`, {
              fieldSelector: field.selector,
            }),
      ],
      reason: `Profile 中没有可映射到 ${target} 的记录`,
      ruleSource: resolved.source,
    };
  }

  const entries = [
    ...allowedByRule.map((experience) => renderExperience(experience)),
    ...projects.map((project) => renderProject(project)),
  ];
  const recordIds = [...allowedByRule.map((e) => e.id), ...projects.map((p) => p.id)];
  let value = joinEntries(entries);
  /** 实际填进字段的记录。压缩后可能少于候选集 */
  let includedRecordIds: readonly string[] = recordIds;

  let reason = `映射到 ${target}，共 ${recordIds.length} 条记录`;

  // 超长处理（PRD §31）：先看有没有现成的压缩变体，没有就现场做抽取式压缩
  if (field.maxLength !== undefined && value.length > field.maxLength) {
    const limit = field.maxLength;

    // 1. Project 可能已经存了针对该字数的变体，优先用用户认可过的版本
    const variantEntries = [
      ...allowedByRule.map((experience) => renderExperience(experience)),
      ...projects.map(
        (project) => pickVariantForLimit(project, limit)?.content ?? renderProject(project),
      ),
    ];
    const compact = joinEntries(variantEntries);

    if (compact.length <= limit) {
      value = compact;
      reason = `映射到 ${target}，使用已有的压缩变体`;
    } else {
      // 2. 现场压缩。抽取式，只挑已有句子，结构上不可能编造
      const adapted = adaptEntries(
        [...allowedByRule.map(toAdaptable), ...projects.map(toAdaptable)],
        limit,
        {
          emphasis: EMPHASIS_BY_SEMANTIC[field.semanticType] ?? 'full',
          ...(context.jobTitle === undefined
            ? {}
            : { targetKeywords: extractKeywords(context.jobTitle) }),
        },
      );

      // 事实校验兜底。抽取式理论上必然通过，但这条防线不能省 ——
      // 万一将来换成生成式实现，这里就是唯一拦得住编造的地方（PRD §3.5）
      if (!adapted.guard.ok) {
        return {
          field,
          status: 'ask_user',
          value: '',
          sourceRecordIds: recordIds,
          excluded,
          warnings: [
            ...warnings,
            warn(
              'CONTENT_TOO_LONG',
              `「${field.label}」的压缩结果出现了无出处的数值（${adapted.guard.violations
                .map((item) => item.numeric)
                .join('、')}），已拒绝使用，请手动填写`,
              { fieldSelector: field.selector, recordIds },
            ),
          ],
          reason: '压缩结果未通过 Canonical Facts 校验',
          ruleSource: resolved.source,
        };
      }

      if (adapted.includedIds.length === 0) {
        return {
          field,
          status: 'ask_user',
          value: '',
          sourceRecordIds: recordIds,
          excluded,
          warnings: [
            ...warnings,
            warn(
              'CONTENT_TOO_LONG',
              `「${field.label}」限 ${limit} 字，连最简形态都放不下，需要你手动填写`,
              { fieldSelector: field.selector, recordIds },
            ),
          ],
          reason: '字数限制过紧，无法在不误导的前提下压缩',
          ruleSource: resolved.source,
        };
      }

      value = adapted.text;
      // 溯源必须反映**实际填进去的**记录，而不是映射阶段的候选集。
      // 早期版本直接沿用候选集，导致 Diff 声称内容来自 4 条记录、实际只有 1 条。
      includedRecordIds = adapted.includedIds;
      reason = `映射到 ${target}，原文 ${compact.length} 字已压缩至 ${adapted.length} 字（限 ${limit}）`;

      warnings.push(
        warn(
          'CONTENT_COMPRESSED',
          `「${field.label}」限 ${limit} 字，已按重要性抽取压缩（保留量化成果，未改写任何文字）`,
          { fieldSelector: field.selector, recordIds: adapted.includedIds },
        ),
      );

      if (adapted.droppedIds.length > 0) {
        warnings.push(
          warn(
            'ITEMS_TRUNCATED',
            `「${field.label}」字数不足以容纳全部 ${recordIds.length} 条记录，已省略 ${adapted.droppedIds.length} 条`,
            { fieldSelector: field.selector, recordIds: adapted.droppedIds },
          ),
        );
      }
    }
  }

  return {
    field,
    status: 'filled',
    value,
    sourceRecordIds: includedRecordIds,
    excluded,
    warnings,
    reason,
    ruleSource: resolved.source,
  };
}

// ————————————————————————————————————————————————
// 奖项类
// ————————————————————————————————————————————————

function mapAwardField(field: FormField, context: MapContext, target: AwardTarget): FieldMapping {
  const { profile } = context;
  const rules = context.rules ?? new MappingRuleStore();
  const resolved = rules.resolve(field.label, field.semanticType, context);

  const { matched, rejected } = queryAwards(profile, target);
  const excluded = rejected.map((item) => ({ recordId: item.award.id, reason: item.reason }));
  const warnings: MappingWarning[] = [];

  const allowed: Award[] = [];
  for (const award of matched) {
    if (resolved.blocked.has(award.category)) {
      excluded.push({
        recordId: award.id,
        reason: `被规则阻断：${award.category} 不得进入 ${field.semanticType}`,
      });
      continue;
    }
    allowed.push(award);
  }

  if (allowed.length === 0) {
    return {
      field,
      status: 'skipped',
      value: '',
      sourceRecordIds: [],
      excluded,
      warnings: [
        warn('NO_MATCHING_DATA', `「${field.label}」没有匹配的奖项，已留空`, {
          fieldSelector: field.selector,
        }),
      ],
      reason: `Profile 中没有可映射到 ${target} 的奖项`,
      ruleSource: resolved.source,
    };
  }

  // 合并栏：多个类别被塞进同一个框，要告诉用户
  if (target === 'combined_honors') {
    const categories = new Set(allowed.map((award) => award.category));
    if (categories.size > 1) {
      warnings.push(
        warn(
          'MERGED_INTO_COMBINED_FIELD',
          `本站只有一个「${field.label}」栏，已将 ${[...categories].join('、')} 共 ${allowed.length} 项合并填入`,
          { fieldSelector: field.selector, recordIds: allowed.map((a) => a.id) },
        ),
      );
    }
  }

  const sorted = sortAwardsByWeight(allowed);
  const value = sorted.map(renderAward).join('\n');

  return {
    field,
    status: 'filled',
    value,
    sourceRecordIds: sorted.map((award) => award.id),
    excluded,
    warnings,
    reason: `映射到 ${target}，共 ${sorted.length} 项`,
    ruleSource: resolved.source,
  };
}

// ————————————————————————————————————————————————
// 标量字段（基本信息 / 教育 / 链接 / 意向）
// ————————————————————————————————————————————————

function scalarValue(field: FormField, context: MapContext): string | undefined {
  const { profile } = context;
  const basic = profile.basicInfo;
  const top = highestEducation(profile.educations);

  switch (field.semanticType) {
    case 'PERSON_NAME':
      return basic.name;
    case 'PHONE':
      return basic.phone;
    case 'EMAIL':
      return basic.email;
    case 'WECHAT':
      return basic.wechat;
    case 'ID_NUMBER':
      return basic.idNumber;
    case 'GENDER':
      return basic.gender === 'male' ? '男' : basic.gender === 'female' ? '女' : undefined;
    case 'BIRTHDAY':
      return basic.birthday;
    case 'ETHNICITY':
      return basic.ethnicity;
    case 'HOMETOWN':
      return basic.hometown;
    case 'LOCATION':
      return basic.location;
    case 'AVAILABLE_DATE':
      return basic.availableDate;

    case 'UNIVERSITY':
      return top?.institution;
    case 'COLLEGE':
      return top?.college;
    case 'MAJOR':
      return top?.major;
    case 'MINOR':
      return top?.secondMajor ?? top?.minor;
    case 'DEGREE':
      return top === undefined ? undefined : degreeLabel(top.degreeType);
    case 'GPA':
      return top?.gpa === undefined ? undefined : String(top.gpa);
    case 'GRADUATION_DATE':
      return top?.graduationDate ?? basic.expectedGraduationDate;
    case 'ENROLLMENT_DATE':
      return top?.startDate;
    case 'COURSEWORK':
      return top === undefined || top.coursework.length === 0
        ? undefined
        : top.coursework.join('、');
    case 'RANKING':
      return top?.ranking === undefined ? undefined : `${top.ranking}/${top.rankingTotal ?? '?'}`;

    case 'GITHUB':
      return findLink(profile.links, 'github')?.url;
    case 'PERSONAL_HOMEPAGE':
      return pickHomepageLink(profile.links)?.url;
    case 'PORTFOLIO':
      return findLink(profile.links, 'portfolio')?.url;
    case 'BLOG':
      return findLink(profile.links, 'blog')?.url;

    default:
      return undefined;
  }
}

const DEGREE_LABELS: Record<string, string> = {
  associate: '专科',
  bachelor: '本科',
  master: '硕士',
  doctor: '博士',
  other: '其他',
};
const degreeLabel = (type: string): string => DEGREE_LABELS[type] ?? type;

/** 下拉/单选字段要把值对到网站给的选项上，对不上就不能硬填 */
function matchOption(value: string, options: readonly string[]): string | undefined {
  if (options.length === 0) return value;
  const exact = options.find((option) => option === value);
  if (exact) return exact;
  const fuzzy = options.find((option) => option.includes(value) || value.includes(option));
  return fuzzy;
}

// ————————————————————————————————————————————————
// 主入口
// ————————————————————————————————————————————————

export function mapField(field: FormField, context: MapContext): FieldMapping {
  const rules = context.rules ?? new MappingRuleStore();
  const resolved = rules.resolve(field.label, field.semanticType, context);

  // 第一道闸：语义置信度不足，一律转人工（PRD §3.6）
  if (confidenceAction(field.confidence) === 'ask_user') {
    return {
      field,
      status: 'ask_user',
      value: '',
      sourceRecordIds: [],
      excluded: [],
      warnings: [
        warn(
          'LOW_CONFIDENCE',
          `「${field.label}」语义无法确定（置信度 ${field.confidence}），需要你确认它指什么`,
          { fieldSelector: field.selector },
        ),
      ],
      reason: field.reason,
      ruleSource: resolved.source,
    };
  }

  const experienceTarget = SEMANTIC_TO_EXPERIENCE_TARGET[field.semanticType];
  if (experienceTarget !== undefined) {
    return mapExperienceField(field, context, experienceTarget as ExperienceTarget);
  }

  const awardTarget = SEMANTIC_TO_AWARD_TARGET[field.semanticType];
  if (awardTarget !== undefined) {
    return mapAwardField(field, context, awardTarget as AwardTarget);
  }

  if (field.kind === 'file') return mapAttachmentField(field, context, resolved.source);
  if (field.semanticType === 'REFERRAL_CODE')
    return mapReferralField(field, context, resolved.source);
  if (field.semanticType === 'QUESTION') return mapQuestionField(field, context, resolved.source);

  return mapScalarField(field, context, resolved.source);
}

function mapScalarField(field: FormField, context: MapContext, ruleSource: string): FieldMapping {
  const raw = scalarValue(field, context);

  if (raw === undefined || raw.length === 0) {
    return {
      field,
      status: 'skipped',
      value: '',
      sourceRecordIds: [],
      excluded: [],
      warnings: [
        field.required
          ? warn('REQUIRED_FIELD_EMPTY', `必填字段「${field.label}」在 Profile 中没有对应数据`, {
              fieldSelector: field.selector,
            })
          : warn('NO_MATCHING_DATA', `「${field.label}」在 Profile 中没有对应数据，已留空`, {
              fieldSelector: field.selector,
            }),
      ],
      reason: `Profile 中没有 ${field.semanticType} 的值`,
      ruleSource,
    };
  }

  // 下拉与单选必须落在网站给出的选项上
  if (field.kind === 'select' || field.kind === 'radio') {
    const option = matchOption(
      raw,
      field.options.filter((item) => item !== '请选择'),
    );
    if (option === undefined) {
      return {
        field,
        status: 'ask_user',
        value: '',
        sourceRecordIds: [],
        excluded: [],
        warnings: [
          warn(
            'LOW_CONFIDENCE',
            `「${field.label}」的值「${raw}」不在网站选项 [${field.options.join('、')}] 中，需要你选择`,
            { fieldSelector: field.selector },
          ),
        ],
        reason: '取值无法对应到网站选项',
        ruleSource,
      };
    }
    return {
      field,
      status: 'filled',
      value: option,
      sourceRecordIds: [],
      excluded: [],
      warnings: [],
      reason: `选中选项「${option}」`,
      ruleSource,
    };
  }

  return {
    field,
    status: 'filled',
    value: raw,
    sourceRecordIds: [],
    excluded: [],
    warnings: [],
    reason: `取自 Profile 的 ${field.semanticType}`,
    ruleSource,
  };
}

const ATTACHMENT_TYPE_MAP: Record<string, AssetTypeHint> = {
  RESUME_ATTACHMENT: 'resume',
  TRANSCRIPT_ATTACHMENT: 'transcript',
  PORTFOLIO_ATTACHMENT: 'portfolio',
  CERTIFICATE_ATTACHMENT: 'certificate',
  PHOTO_ATTACHMENT: 'photo',
};

function mapAttachmentField(
  field: FormField,
  context: MapContext,
  ruleSource: string,
): FieldMapping {
  const assetType = ATTACHMENT_TYPE_MAP[field.semanticType];

  if (assetType === undefined) {
    return {
      field,
      status: 'ask_user',
      value: '',
      sourceRecordIds: [],
      excluded: [],
      warnings: [
        warn('LOW_CONFIDENCE', `无法确定「${field.label}」需要什么类型的附件`, {
          fieldSelector: field.selector,
        }),
      ],
      reason: '附件类型未识别，不能随意上传文件',
      ruleSource,
    };
  }

  const extensions = field.accept
    ?.split(',')
    .map((item) => item.trim().replace(/^\./, '').toLowerCase())
    .filter((item) => item.length > 0);

  const selection = selectAsset(context.profile.assets, {
    type: assetType,
    ...(extensions === undefined || extensions.length === 0
      ? {}
      : { allowedExtensions: extensions }),
  });

  if (selection.asset === undefined) {
    return {
      field,
      status: 'ask_user',
      value: '',
      sourceRecordIds: [],
      excluded: selection.rejected.map((item) => ({
        recordId: item.asset.id,
        reason: item.reason,
      })),
      warnings: [
        warn('NO_SUITABLE_ASSET', `「${field.label}」找不到符合要求的附件：${selection.reason}`, {
          fieldSelector: field.selector,
        }),
      ],
      reason: selection.reason,
      ruleSource,
    };
  }

  return {
    field,
    status: 'filled',
    value: selection.asset.path,
    sourceRecordIds: [selection.asset.id],
    excluded: selection.rejected.map((item) => ({ recordId: item.asset.id, reason: item.reason })),
    warnings: [],
    reason: selection.reason,
    ruleSource,
  };
}

function mapReferralField(field: FormField, context: MapContext, ruleSource: string): FieldMapping {
  const today = context.today ?? '1970-01-01';
  const code =
    context.companyId === undefined
      ? undefined
      : findReferralCode(context.profile.referralCodes, context.companyId, today);

  if (code === undefined) {
    return {
      field,
      status: 'skipped',
      value: '',
      sourceRecordIds: [],
      excluded: [],
      warnings: [
        warn('NO_REFERRAL_CODE', `没有该公司的有效内推码，「${field.label}」留空`, {
          fieldSelector: field.selector,
        }),
      ],
      reason: '无可用内推码',
      ruleSource,
    };
  }

  return {
    field,
    status: 'filled',
    value: code.code,
    sourceRecordIds: [code.id],
    excluded: [],
    warnings: [],
    reason: `使用 ${code.companyName} 的内推码`,
    ruleSource,
  };
}

/** 极简的问题匹配：标准问法与已见过的问法都参与比对。完整语义匹配在 Question Bank 里做。 */
function mapQuestionField(field: FormField, context: MapContext, ruleSource: string): FieldMapping {
  const normalize = (text: string): string => text.replace(/[\s？?。.，,、]/g, '');
  const target = normalize(field.label);

  const question = context.profile.questions.find((item) => {
    if (!isQuestionApplicable(item, [])) return false;
    const candidates = [item.canonicalQuestion, ...item.observedPhrasings].map(normalize);
    return candidates.some(
      (candidate) =>
        candidate === target || target.includes(candidate) || candidate.includes(target),
    );
  });

  if (question === undefined) {
    return {
      field,
      status: 'ask_user',
      value: '',
      sourceRecordIds: [],
      excluded: [],
      warnings: [
        warn('UNANSWERED_QUESTION', `问题「${field.label}」在问答库中没有匹配答案，需要你回答`, {
          fieldSelector: field.selector,
        }),
      ],
      reason: '问答库无匹配',
      ruleSource,
    };
  }

  const answer =
    question.answerType === 'boolean'
      ? question.answer === 'true'
        ? '是'
        : '否'
      : question.answer;

  if (field.kind === 'radio' || field.kind === 'select') {
    const option = matchOption(answer, field.options);
    if (option === undefined) {
      return {
        field,
        status: 'ask_user',
        value: '',
        sourceRecordIds: [question.id],
        excluded: [],
        warnings: [
          warn(
            'UNANSWERED_QUESTION',
            `答案「${answer}」不在选项 [${field.options.join('、')}] 中，需要你选择`,
            { fieldSelector: field.selector },
          ),
        ],
        reason: '答案无法对应到网站选项',
        ruleSource,
      };
    }
    return {
      field,
      status: 'filled',
      value: option,
      sourceRecordIds: [question.id],
      excluded: [],
      warnings: [],
      reason: `问答库命中「${question.canonicalQuestion}」`,
      ruleSource,
    };
  }

  return {
    field,
    status: 'filled',
    value: answer,
    sourceRecordIds: [question.id],
    excluded: [],
    warnings: [],
    reason: `问答库命中「${question.canonicalQuestion}」`,
    ruleSource,
  };
}

// ————————————————————————————————————————————————
// 整表映射
// ————————————————————————————————————————————————

/**
 * 映射整个表单，并检测跨字段的问题。
 *
 * 最重要的跨字段检测是**降级**：本站没有科研栏，
 * 用户的课题会被填进项目经历栏 —— 这必须明确告诉用户（PRD §35）。
 */
export function mapForm(fields: readonly FormField[], context: MapContext): FormPlan {
  const mappings = fields.map((field) => mapField(field, context));
  const formWarnings: MappingWarning[] = [];

  const semanticTypes = new Set(fields.map((field) => field.semanticType));
  const hasResearchField = semanticTypes.has('RESEARCH_EXPERIENCE');
  const hasProjectField = semanticTypes.has('PROJECT_EXPERIENCE');

  if (!hasResearchField && hasProjectField) {
    const downgraded = context.profile.experiences.filter(
      (experience) =>
        ['research', 'research_project'].includes(experience.experienceType) &&
        canMapExperienceTo(experience, 'project_experience').allowed,
    );

    if (downgraded.length > 0) {
      formWarnings.push(
        warn(
          'DOWNGRADED_TO_BROADER_FIELD',
          `本站没有独立的科研经历栏目，已将 ${downgraded.map((e) => `《${e.name}》`).join('、')} 归入项目经历`,
          { recordIds: downgraded.map((e) => e.id) },
        ),
      );
    }
  }

  // 科研经历彻底无处安放的情况：既没科研栏也没项目栏
  if (!hasResearchField && !hasProjectField) {
    const orphaned = context.profile.experiences.filter((experience) =>
      ['research', 'research_project'].includes(experience.experienceType),
    );
    if (orphaned.length > 0) {
      formWarnings.push(
        warn(
          'NO_MATCHING_DATA',
          `本站既无科研栏也无项目栏，${orphaned.length} 段科研经历无处填写`,
          { recordIds: orphaned.map((e) => e.id) },
        ),
      );
    }
  }

  // 奖项被合并的情况已在字段级处理，这里只补一句整体提示
  const awardTargets = fields
    .map((field) => SEMANTIC_TO_AWARD_TARGET[field.semanticType])
    .filter((target): target is string => target !== undefined);

  if (awardTargets.length === 1 && awardTargets[0] === 'combined_honors') {
    const categories = new Set(context.profile.awards.map((award) => award.category));
    if (categories.size > 1) {
      formWarnings.push(
        warn(
          'MERGED_INTO_COMBINED_FIELD',
          `本站奖项只有一个合并栏，奖学金与竞赛获奖等 ${categories.size} 类已合并填写`,
        ),
      );
    }
  }

  return { mappings, formWarnings };
}

/** 汇总整个表单的所有警告，供 Diff 展示 */
export function allWarnings(plan: FormPlan): MappingWarning[] {
  return [...plan.formWarnings, ...plan.mappings.flatMap((mapping) => mapping.warnings)];
}

/** 需要用户处理的字段 */
export const pendingFields = (plan: FormPlan): FieldMapping[] =>
  plan.mappings.filter((mapping) => mapping.status === 'ask_user');

export function summarizePlan(plan: FormPlan): {
  total: number;
  filled: number;
  skipped: number;
  askUser: number;
} {
  let filled = 0;
  let skipped = 0;
  let askUser = 0;
  for (const mapping of plan.mappings) {
    if (mapping.status === 'filled') filled += 1;
    else if (mapping.status === 'skipped') skipped += 1;
    else askUser += 1;
  }
  return { total: plan.mappings.length, filled, skipped, askUser };
}

export { queryExperiences, queryAwards, canMapAwardTo };
