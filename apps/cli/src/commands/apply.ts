/**
 * autojob apply <url> —— PRD Phase 0 的最终形态。
 *
 * 编排完整链路，**并在提交前停住**（PRD §3.7）：
 *
 *   打开页面 → 检测登录/验证码 → 解析字段 → 语义分类 → 映射 Profile
 *   → 填写 → 校验 → 截图 → 落库 →【停止，等用户确认】
 *
 * 本命令**没有也不会有** `--submit` 参数。真正的提交动作留到 M9，
 * 且必须走 Application Diff 确认流程。现在这一步的产出是「填好但没交」的表单，
 * 用户在浏览器里核对无误后自己点提交。
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { importProfile, type CandidateProfile } from '@autojob/candidate-profile';
import { AutoJobError, ErrorCode, createLogger, createRunId, type Logger } from '@autojob/core';
import {
  TaskMachine,
  TaskState,
  createRunArtifacts,
  detectGate,
  fillForm,
  formatIssues,
  gateToError,
  launchSession,
  validateForm,
  waitForUserToResolveGate,
  COLLECT_RESOURCE_URLS,
} from '@autojob/browser';
import { classifyForm, summarize, EXTRACT_FIELDS_SCRIPT } from '@autojob/form-schema';
import {
  BUILTIN_GLOBAL_RULES,
  MappingRuleStore,
  allWarnings,
  mapForm,
  summarizePlan,
} from '@autojob/form-mapper';
import { ApplicationRepository, openDatabase } from '@autojob/database';
import { buildDiff, renderDiff } from '@autojob/application-diff';
import {
  AdapterRegistry,
  detectAts,
  shouldUseAdapter,
  type ATSAdapter,
} from '@autojob/ats-detector';
import { mokaAdapter } from '@autojob/adapter-moka';
import { genericAdapter } from '@autojob/adapter-generic';
import { createInterface } from 'node:readline/promises';

/** 已实现的 Adapter。新增 ATS 时在这里注册即可 */
const REGISTRY = new AdapterRegistry();
REGISTRY.register(mokaAdapter);

/**
 * 问用户一个是非题。
 *
 * 提交是不可逆的，必须由人明确点头（PRD §3.7）。默认答案是「否」——
 * 用户直接回车不会误提交。
 */
async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${question} [y/N] `);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}
import type { Command } from 'commander';

interface ApplyOptions {
  readonly profile: string;
  readonly company?: string;
  readonly job?: string;
  readonly headless?: boolean;
  readonly db?: string;
  readonly runsDir?: string;
  readonly dryRun?: boolean;
  readonly verbose?: boolean;
  /** 允许在用户确认后由程序点击提交按钮。缺省时只填不交 */
  readonly allowSubmit?: boolean;
}

function loadProfile(path: string): CandidateProfile {
  try {
    return importProfile(readFileSync(resolve(path), 'utf-8'));
  } catch (cause) {
    if (cause instanceof AutoJobError) throw cause;
    throw new AutoJobError(ErrorCode.CONFIG_INVALID, `无法读取 Profile：${path}`, {
      hint: '真实 Profile 建议放在 materials/profile.local.json（已 gitignore）',
      cause,
    });
  }
}

/** 从 URL 猜公司名 —— 只是个默认值，用户可用 --company 覆盖 */
function guessCompanyName(url: string): string {
  try {
    const host = new URL(url).hostname;
    const parts = host
      .split('.')
      .filter((part) => !['www', 'com', 'cn', 'net', 'org'].includes(part));
    return parts[0] ?? host;
  } catch {
    return 'unknown';
  }
}

const write = (text: string): void => void process.stdout.write(`${text}\n`);

export async function runApply(url: string, options: ApplyOptions): Promise<number> {
  const runId = createRunId();
  const log: Logger = createLogger('apply', { runId });

  const profile = loadProfile(options.profile);
  const artifacts = await createRunArtifacts(runId, {
    ...(options.runsDir === undefined ? {} : { baseDir: options.runsDir }),
    logger: log,
  });

  const machine = new TaskMachine({
    onTransition: (transition) =>
      log.info(`状态 ${transition.from} → ${transition.to}`, { note: transition.note }),
  });

  const session = await launchSession({
    ...(options.headless === undefined ? {} : { headless: options.headless }),
    logger: log,
  });

  try {
    // ── 打开页面
    machine.to(TaskState.OPENING, url);
    await session.page.goto(url, { waitUntil: 'domcontentloaded' });
    await artifacts.screenshot(session.page, 'opened');

    // ── 识别 ATS。资源来源比域名可靠：企业能换域名，换不掉供应商的 CDN
    const resourceUrls = await session.page.evaluate(COLLECT_RESOURCE_URLS).catch(() => []);
    const detection = detectAts({ url, resourceUrls });
    const adapter: ATSAdapter = shouldUseAdapter(detection)
      ? (REGISTRY.get(detection.ats) ?? genericAdapter)
      : genericAdapter;

    write('');
    write(`── 招聘系统：${detection.label}（置信度 ${detection.confidence}）`);
    if (detection.evidence.length > 0) write(`   依据：${detection.evidence.join('；')}`);
    write(`   使用 ${adapter === genericAdapter ? '通用解析' : `${adapter.label} 专用适配器`}`);

    // ── 登录 / 验证码：只检测，不绕过（PRD §74）
    const gate = await detectGate(session.page);
    if (gate.gate !== 'none') {
      const error = gateToError(gate, url);
      machine.to(TaskState.LOGIN_REQUIRED, gate.evidence);
      machine.to(TaskState.WAITING_USER, '等待用户在浏览器中处理');

      write('');
      write(`⏸  ${error?.message ?? '页面被拦截'}`);
      write(`   ${error?.hint ?? ''}`);
      write('   正在等待……（最多 5 分钟）');

      const resolved = await waitForUserToResolveGate(session.page, { logger: log });
      if (!resolved) {
        machine.to(TaskState.FAILED, '用户未在超时时间内完成');
        write('✗ 超时，未检测到登录完成。请重新运行本命令。');
        return 2;
      }
      await artifacts.screenshot(session.page, 'after-login');
    }

    // ── 解析字段
    machine.to(TaskState.FORM_LOADING, '加载申请表');

    // SPA 的表单是异步渲染的，不等就会解析到空页面
    if (adapter.waitForForm !== undefined) {
      const ready = await adapter.waitForForm(session.page);
      if (!ready) write('   （提示：等待表单渲染超时，将按当前页面内容解析）');
    }

    machine.to(TaskState.FORM_PARSING, '解析字段');

    const rawFields = await session.page.evaluate(EXTRACT_FIELDS_SCRIPT);
    const parsed = classifyForm(url, rawFields);
    const classification = summarize(parsed.fields);

    write('');
    write(`── 字段解析（${parsed.fields.length} 个）`);
    write(
      `   自动 ${classification.auto}  需标注 ${classification.autoWithWarning}  ` +
        `转人工 ${classification.askUser}  未识别 ${classification.unrecognized}`,
    );

    if (parsed.fields.length === 0) {
      machine.to(TaskState.FAILED, '页面上没有解析到任何表单字段');
      write('✗ 页面上没有找到表单字段。可能需要先进入具体岗位的申请页。');
      return 1;
    }

    await artifacts.screenshot(session.page, 'parsed');

    // ── 映射 Profile
    const db = openDatabase(options.db === undefined ? {} : { path: options.db });
    const repo = new ApplicationRepository(db);

    const companyName = options.company ?? guessCompanyName(url);
    const company = repo.upsertCompany({
      name: companyName,
      careerUrl: url,
      atsType: detection.ats,
    });
    const job = repo.upsertJob({
      companyId: company.id,
      title: options.job ?? '未指定岗位',
      url,
    });

    // 防重复投递：填表之前就问（PRD §30）
    const existing = repo.findApplicationByJob(job.id);
    if (existing !== undefined) {
      machine.to(TaskState.FAILED, '重复投递');
      write('');
      write(`✗ 该岗位已于 ${existing.createdAt.slice(0, 10)} 投递过（状态：${existing.status}）`);
      write('   如需重投，请先撤回原记录。');
      db.close();
      return 2;
    }

    const rules = new MappingRuleStore([
      ...BUILTIN_GLOBAL_RULES,
      ...repo.loadMappingRules({ atsType: company.atsType, companyId: company.id }).map((row) => ({
        id: row.id,
        scope: row.scope as 'global' | 'ats' | 'company',
        atsType: row.atsType,
        companyId: row.companyId,
        fieldLabel: row.fieldLabel,
        semanticType: row.semanticType as never,
        allowedCandidateTypes: row.allowedCandidateTypes,
        blockedCandidateTypes: row.blockedCandidateTypes,
        origin: row.origin as 'builtin' | 'user' | 'llm',
        confidence: row.confidence,
        note: row.note,
      })),
    ]);

    const plan = mapForm(parsed.fields, {
      profile,
      rules,
      today: new Date().toISOString().slice(0, 10),
      companyId: company.id,
      atsType: company.atsType,
      ...(options.job === undefined ? {} : { jobTitle: options.job }),
    });

    const planStats = summarizePlan(plan);
    const warnings = allWarnings(plan);

    write('');
    write(`── 映射计划`);
    write(
      `   将填写 ${planStats.filled}  留空 ${planStats.skipped}  需你确认 ${planStats.askUser}`,
    );

    await artifacts.writeJson('plan', {
      runId,
      url,
      pageSignature: parsed.pageSignature,
      mappings: plan.mappings.map((mapping) => ({
        selector: mapping.field.selector,
        label: mapping.field.label,
        semanticType: mapping.field.semanticType,
        confidence: mapping.field.confidence,
        status: mapping.status,
        sourceRecordIds: mapping.sourceRecordIds,
        reason: mapping.reason,
      })),
      warnings,
    });

    // Application Diff —— 提交前把系统做的所有转换摊给用户看（PRD §35）
    const diff = buildDiff(plan, profile, {
      company: company.name,
      jobTitle: job.title,
      url,
    });
    await artifacts.writeJson('diff', diff);

    if (options.dryRun === true) {
      write('');
      write(renderDiff(diff, { verbose: options.verbose === true }));
      write('');
      write('（--dry-run：仅生成计划与 Diff，未实际填写）');
      write(`产物目录：${artifacts.dir}`);
      db.close();
      return diff.submittable ? 0 : 2;
    }

    // ── 填写
    machine.to(TaskState.FILLING, `填写 ${planStats.filled} 个字段`);
    const fillSummary = await fillForm(session.page, plan.mappings, { logger: log });
    await artifacts.screenshot(session.page, 'filled');

    write('');
    write(`── 填写结果`);
    write(`   成功 ${fillSummary.filled}  失败 ${fillSummary.failed}  跳过 ${fillSummary.skipped}`);
    for (const result of fillSummary.results.filter((item) => !item.ok)) {
      write(`   ✗ ${result.label}：${result.error ?? '未知原因'}`);
    }

    // ── 校验
    machine.to(TaskState.VALIDATING, '校验表单');
    const issues = await validateForm(session.page, parsed.fields);
    await artifacts.screenshot(session.page, 'validated');

    write('');
    write('── 表单校验');
    write(formatIssues(issues));

    // ── Application Diff
    write('');
    write(renderDiff(diff, { verbose: options.verbose === true }));

    // ── 落库并停止
    machine.to(TaskState.READY_TO_SUBMIT, '填写完成，等待用户确认提交');
    await artifacts.writeJson('transitions', machine.history);

    const application = repo.createApplication({
      companyId: company.id,
      jobId: job.id,
      runId,
      status: 'READY_TO_SUBMIT',
      screenshotDir: artifacts.dir,
      warnings,
    });

    write('');
    write('══════════════════════════════════════════');
    write(`投递记录  ${application.id}`);
    write(`Run ID    ${runId}`);
    write(`产物目录  ${artifacts.dir}`);
    write('══════════════════════════════════════════');

    /*
     * 提交流程 —— PRD §3.7 的核心约束。
     *
     * 三道锁，缺一不可：
     *   1. 必须显式加 --allow-submit（默认只填不交）
     *   2. Diff 判定可提交（无阻断项、无待确认字段）
     *   3. 用户在终端明确回答 y
     *
     * 任何一道不过，就停在「已填好、未提交」，由用户自己在浏览器里点。
     */
    if (options.allowSubmit !== true) {
      write('');
      write('已填写完成，**未提交**。');
      write('请在打开的浏览器窗口中核对，确认无误后由你自己点击提交按钮。');
      write('（若希望程序代为提交，请加 --allow-submit，届时仍会再问你一次）');
      db.close();
      await session.page.waitForTimeout(2_000);
      return 0;
    }

    if (!diff.submittable) {
      write('');
      write('已填写完成，**未提交** —— Diff 中仍有需要你处理的问题（见上）。');
      db.close();
      await session.page.waitForTimeout(2_000);
      return 2;
    }

    if (adapter.submit === undefined) {
      write('');
      write(`已填写完成，**未提交** —— ${adapter.label} 尚未实现自动提交。`);
      write('请在浏览器中自行点击提交按钮。');
      db.close();
      await session.page.waitForTimeout(2_000);
      return 0;
    }

    write('');
    const confirmed = await confirm(`确认向「${company.name} · ${job.title}」提交这份申请？`);
    if (!confirmed) {
      write('已取消提交。表单内容保留在浏览器中，你可以自行修改后手动提交。');
      db.close();
      return 0;
    }

    machine.to(TaskState.SUBMITTING, '用户已确认');
    await adapter.submit(session.page);
    await artifacts.screenshot(session.page, 'submitted');

    // 不能因为点了按钮就认为成功（PRD §60）
    machine.to(TaskState.VERIFYING, '验证提交结果');
    const verification =
      adapter.verifySubmission === undefined
        ? { submitted: false, confirmationText: '', detail: '该适配器未实现提交验证' }
        : await adapter.verifySubmission(session.page);

    await artifacts.screenshot(session.page, 'verified');

    if (verification.submitted) {
      machine.to(TaskState.SUCCESS, verification.detail);
      repo.updateStatus(application.id, 'SUBMITTED', {
        confirmationText: verification.confirmationText,
        notes: verification.detail,
      });
      write('');
      write(`✓ 提交成功：${verification.confirmationText || verification.detail}`);
    } else {
      machine.to(TaskState.FAILED, verification.detail);
      write('');
      write(`✗ 未能确认提交成功：${verification.detail}`);
      write('  请在浏览器中人工核对。投递记录已保留为「待提交」状态。');
    }

    await artifacts.writeJson('transitions', machine.history);
    db.close();
    await session.page.waitForTimeout(2_000);
    return verification.submitted ? 0 : 1;
  } catch (thrown) {
    if (!machine.isDone) machine.to(TaskState.FAILED, String(thrown));
    await artifacts.screenshot(session.page, 'failed').catch(() => undefined);
    await artifacts.writeJson('transitions', machine.history).catch(() => undefined);
    throw thrown;
  } finally {
    if (options.headless === true) await session.close();
  }
}

export function registerApplyCommand(program: Command): void {
  program
    .command('apply')
    .description('打开招聘页并自动填写申请表，在提交前停止')
    .argument('<url>', '岗位申请页 URL')
    .requiredOption('-p, --profile <path>', 'Candidate Profile JSON 路径')
    .option('-c, --company <name>', '公司名称（默认从 URL 推断）')
    .option('-j, --job <title>', '岗位名称')
    .option('--db <path>', '数据库路径（默认 ~/.autojob/autojob.db）')
    .option('--runs-dir <path>', '产物目录（默认 ~/.autojob/runs）')
    .option('--dry-run', '只生成映射计划与 Diff，不实际填写')
    .option('--verbose', 'Diff 中展开全部字段内容与被排除的记录')
    .option('--allow-submit', '允许在你二次确认后由程序点击提交（默认只填不交）')
    .option('--headless', '无头模式运行（仅用于测试，正常使用请勿开启）')
    .action(async (url: string, options: ApplyOptions) => {
      process.exitCode = await runApply(url, options);
    });
}
