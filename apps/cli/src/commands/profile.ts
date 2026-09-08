/**
 * autojob profile —— Candidate Profile 的校验与查看。
 *
 * 关键约束：**输出必须脱敏**。真实 Profile 里有手机号、邮箱、身份证，
 * 而终端输出可能被截图、贴进 issue、录进屏。所以这里一律走 @autojob/core 的
 * maskText，绝不原样打印敏感字段（PRD §44）。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  checkProfileIntegrity,
  checkExperienceConsistency,
  highestEducation,
  importProfile,
  toLLMSafeProfile,
  type CandidateProfile,
} from '@autojob/candidate-profile';
import { AutoJobError, ErrorCode, maskText } from '@autojob/core';
import type { Command } from 'commander';

function loadProfile(path: string): CandidateProfile {
  const absolute = resolve(path);
  let raw: string;
  try {
    raw = readFileSync(absolute, 'utf-8');
  } catch (cause) {
    throw new AutoJobError(ErrorCode.CONFIG_INVALID, `无法读取 Profile 文件：${absolute}`, {
      hint: '请确认路径正确。真实 Profile 建议放在 materials/profile.local.json（已 gitignore）',
      cause,
    });
  }
  return importProfile(raw);
}

/** 统计各集合的条目数与语义构成，不泄漏任何字段值 */
function renderSummary(profile: CandidateProfile): string {
  const lines: string[] = [];

  const experienceByType = new Map<string, number>();
  for (const experience of profile.experiences) {
    experienceByType.set(
      experience.experienceType,
      (experienceByType.get(experience.experienceType) ?? 0) + 1,
    );
  }

  const awardByCategory = new Map<string, number>();
  for (const award of profile.awards) {
    awardByCategory.set(award.category, (awardByCategory.get(award.category) ?? 0) + 1);
  }

  const assetByType = new Map<string, number>();
  for (const asset of profile.assets) {
    assetByType.set(asset.type, (assetByType.get(asset.type) ?? 0) + 1);
  }

  const top = highestEducation(profile.educations);

  lines.push(`姓名          ${maskText(profile.basicInfo.name)}`);
  lines.push(`手机          ${maskText(profile.basicInfo.phone ?? '(未填)')}`);
  lines.push(`邮箱          ${maskText(profile.basicInfo.email ?? '(未填)')}`);
  lines.push(
    `身份证        ${profile.basicInfo.idNumber === undefined ? '(未填)' : '(已填写，不显示)'}`,
  );
  lines.push(
    `最高学历      ${top === undefined ? '(无)' : `${top.institution} · ${top.major} · ${top.degreeType}`}`,
  );
  lines.push(`预计毕业      ${profile.basicInfo.expectedGraduationDate ?? '(未填)'}`);
  lines.push('');
  lines.push(`教育经历      ${profile.educations.length} 条`);
  lines.push(
    `经历          ${profile.experiences.length} 条  ${[...experienceByType]
      .map(([type, count]) => `${type}×${count}`)
      .join('  ')}`,
  );
  lines.push(`项目          ${profile.projects.length} 条`);
  lines.push(
    `奖项          ${profile.awards.length} 项  ${[...awardByCategory]
      .map(([category, count]) => `${category}×${count}`)
      .join('  ')}`,
  );
  lines.push(`技能          ${profile.skills.length} 项`);
  lines.push(
    `链接          ${profile.links.map((link) => link.semanticType).join('、') || '(无)'}`,
  );
  lines.push(
    `附件          ${profile.assets.length} 个  ${[...assetByType]
      .map(([type, count]) => `${type}×${count}`)
      .join('  ')}`,
  );
  lines.push(`简历版本      ${profile.resumeVersions.length} 个`);
  lines.push(`问答库        ${profile.questions.length} 条`);
  lines.push(`内推码        ${profile.referralCodes.length} 个`);

  return lines.join('\n');
}

/** 校验：schema 之外的引用完整性与四维标签一致性 */
function renderChecks(profile: CandidateProfile): { text: string; ok: boolean } {
  const lines: string[] = [];
  let ok = true;

  const integrity = checkProfileIntegrity(profile);
  if (integrity.length === 0) {
    lines.push('  ✓ 引用完整性  附件、经历、简历版本的相互引用均有效');
  } else {
    ok = false;
    lines.push(`  ✗ 引用完整性  ${integrity.length} 处问题：`);
    for (const issue of integrity) lines.push(`      · ${issue.path}：${issue.message}`);
  }

  const consistency = profile.experiences.flatMap((experience) =>
    checkExperienceConsistency(experience),
  );
  if (consistency.length === 0) {
    lines.push('  ✓ 语义标签    四维标签组合无可疑之处');
  } else {
    lines.push(`  ⚠ 语义标签    ${consistency.length} 处需确认（不阻断，但请复核）：`);
    for (const item of consistency) lines.push(`      · ${item.message}`);
  }

  // 附件路径是否真实存在 —— 填表时找不到文件会直接失败，提前查出来
  const missing = profile.assets.filter((asset) => {
    try {
      readFileSync(resolve(asset.path));
      return false;
    } catch {
      return true;
    }
  });
  if (missing.length === 0) {
    lines.push('  ✓ 附件文件    全部存在于磁盘');
  } else {
    ok = false;
    lines.push(`  ✗ 附件文件    ${missing.length} 个找不到：`);
    for (const asset of missing) lines.push(`      · ${asset.name} → ${asset.path}`);
  }

  return { text: lines.join('\n'), ok };
}

/** LLM 安全副本自检 —— 确认敏感值真的没被带出去（PRD §42） */
function renderLLMSafetyCheck(profile: CandidateProfile): { text: string; ok: boolean } {
  const serialized = JSON.stringify(toLLMSafeProfile(profile));
  const secrets: Array<[string, string | undefined]> = [
    ['手机号', profile.basicInfo.phone],
    ['邮箱', profile.basicInfo.email],
    ['微信', profile.basicInfo.wechat],
    ['身份证', profile.basicInfo.idNumber],
  ];

  const leaked = secrets.filter(
    ([, value]) => value !== undefined && value.length > 0 && serialized.includes(value),
  );

  if (leaked.length === 0) {
    return { text: '  ✓ LLM 安全副本  已剔除全部敏感字段，可安全用于字段语义理解', ok: true };
  }
  return {
    text: `  ✗ LLM 安全副本  泄漏了 ${leaked.map(([name]) => name).join('、')}`,
    ok: false,
  };
}

export function registerProfileCommand(program: Command): void {
  const profile = program.command('profile').description('管理 Candidate Profile');

  profile
    .command('check')
    .description('校验 Profile 并输出脱敏摘要')
    .argument('<path>', 'Profile JSON 路径，例如 materials/profile.local.json')
    .action((path: string) => {
      const loaded = loadProfile(path);

      const checks = renderChecks(loaded);
      const llmSafety = renderLLMSafetyCheck(loaded);

      process.stdout.write(
        [
          'Candidate Profile 校验',
          '',
          '── 摘要（敏感字段已脱敏）',
          renderSummary(loaded),
          '',
          '── 检查',
          checks.text,
          llmSafety.text,
          '',
          checks.ok && llmSafety.ok ? '全部检查通过。' : '存在未通过项，请修正后重试。',
          '',
        ].join('\n'),
      );

      if (!checks.ok || !llmSafety.ok) process.exitCode = 1;
    });
}
