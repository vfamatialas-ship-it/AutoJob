#!/usr/bin/env node
/**
 * 隐私审计 —— 确保真实个人信息不会进入 git。
 *
 * 这是项目最重要的一条约束的**自动化执行**：代码可以公开，个人资料不能。
 * 光靠自觉不够 —— 本次开发中就有两处疏漏是靠审计发现的：
 * 一处是修 bug 时把真实邮箱写进了代码注释，另一处是 .gitignore 里残留了含真实姓名的目录名。
 *
 * ## 两层检查
 *
 * 1. **精确匹配**：从本地真实 Profile（materials/profile.local.json，已 gitignore）
 *    读出真实姓名/手机/邮箱/微信/身份证，在所有 git 跟踪文件里搜。
 *    这一层最准，但依赖本地有那份文件。
 *
 * 2. **模式匹配**：搜任意中国手机号与 18 位身份证。
 *    即使没有本地 Profile 也能兜底，代价是需要维护一份「已知虚构值」白名单。
 *
 * 用法：pnpm privacy:check
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const PROFILE_PATH = 'materials/profile.local.json';

/**
 * 测试与文档中**有意使用**的虚构值。
 * 新增虚构数据时请一并登记，否则模式检查会误报。
 */
const KNOWN_SYNTHETIC = new Set([
  '13800000000', // 示例 Profile 的手机号
  '13812341234', // mask 测试
  '15987654321', // mask 测试
  '12012341234', // mask 测试（非法号段，用于验证不误伤）
  '12345678901', // mask 测试（邮箱本地部分）
  '19303864024', // mask 注释中的示例邮箱本地部分
  '110101199003071234', // mask 测试身份证
  '11010119900307123X', // 同上，末位 X 变体
  '11010119900307123', // 同上（正则片段）
  '110101900307123', // 15 位旧格式身份证
  '202430628695', // 专利申请号（公开信息，非个人标识）
  '202430628710',
]);

/** 允许出现敏感模式的文件（它们本身就是在处理这些模式） */
/**
 * 豁免**第二层通用模式**的文件（第一层真实值精确匹配对谁都不豁免）。
 *
 * 前两条是脱敏逻辑自身与它的测试，里面必然出现手机号形状的字符串。
 *
 * 锁文件是机器生成的十六进制校验和，11 位连续数字纯属概率事件 ——
 * 实测 Cargo.lock 里就有一个 `...e17291832910d2dcc`。把它登记成
 * KNOWN_SYNTHETIC 没有意义：依赖一升级校验和就变，误报会反复出现。
 * 而真实手机号也不可能凭空出现在锁文件里，所以整类豁免是安全的。
 */
const ALLOWED_FILES = [
  /^scripts\/privacy-check\.mjs$/,
  /^packages\/core\/src\/mask\.ts$/,
  /(^|\/)Cargo\.lock$/,
  /(^|\/)pnpm-lock\.yaml$/,
];

const trackedFiles = () =>
  execFileSync('git', ['ls-files'], { encoding: 'utf-8' })
    .split('\n')
    .filter((file) => file.length > 0)
    // 二进制文件跳过
    .filter((file) => !/\.(png|jpg|jpeg|pdf|ico|woff2?)$/i.test(file));

/** 从本地真实 Profile 提取需要严防的字面值 */
function realSecrets() {
  if (!existsSync(PROFILE_PATH)) return [];

  const profile = JSON.parse(readFileSync(PROFILE_PATH, 'utf-8'));
  const basic = profile.basicInfo ?? {};

  const values = [basic.name, basic.phone, basic.email, basic.wechat, basic.idNumber];

  // 雇主名也算敏感：实习期内部信息不该出现在公开仓库
  for (const experience of profile.experiences ?? []) {
    if (experience.organizationType === 'company') values.push(experience.organization);
  }

  return values
    .filter((value) => typeof value === 'string' && value.trim().length >= 2)
    .map((value) => value.trim());
}

const findings = [];
const files = trackedFiles();
const secrets = realSecrets();

for (const file of files) {
  let content;
  try {
    content = readFileSync(file, 'utf-8');
  } catch {
    continue; // 读不了的按二进制跳过
  }

  const lines = content.split('\n');
  const allowed = ALLOWED_FILES.some((pattern) => pattern.test(file));

  lines.forEach((line, index) => {
    // 第一层：真实值精确匹配。这一层不给任何豁免。
    for (const secret of secrets) {
      if (line.includes(secret)) {
        findings.push({
          file,
          line: index + 1,
          kind: '真实个人信息',
          detail: `出现了 Profile 中的真实值（长度 ${secret.length}）`,
        });
      }
    }

    if (allowed) return;

    // 第二层：通用模式，扣除已登记的虚构值
    for (const match of line.matchAll(/(?<!\d)1[3-9]\d{9}(?!\d)/g)) {
      if (!KNOWN_SYNTHETIC.has(match[0])) {
        findings.push({ file, line: index + 1, kind: '疑似手机号', detail: match[0] });
      }
    }
    for (const match of line.matchAll(/(?<!\d)\d{17}[\dXx](?!\d)/g)) {
      if (!KNOWN_SYNTHETIC.has(match[0])) {
        findings.push({ file, line: index + 1, kind: '疑似身份证', detail: match[0] });
      }
    }
  });
}

// 同时确认隐私目录确实没被跟踪
const trackedPrivate = files.filter(
  (file) => file.startsWith('materials/') || file.endsWith('.db') || file.startsWith('runs/'),
);
for (const file of trackedPrivate) {
  findings.push({ file, line: 0, kind: '隐私文件被跟踪', detail: '该文件不应进入 git' });
}

const scope =
  secrets.length > 0
    ? `真实值 ${secrets.length} 项 + 通用模式`
    : '仅通用模式（未找到本地 Profile）';
process.stdout.write(`隐私审计：扫描 ${files.length} 个 git 跟踪文件（${scope}）\n`);

if (findings.length === 0) {
  process.stdout.write('✓ 未发现真实个人信息\n');
  process.exit(0);
}

process.stdout.write(`\n✗ 发现 ${findings.length} 处问题：\n`);
for (const finding of findings) {
  const where = finding.line > 0 ? `${finding.file}:${finding.line}` : finding.file;
  process.stdout.write(`  · [${finding.kind}] ${where} —— ${finding.detail}\n`);
}
process.stdout.write('\n请移除后再提交。若为有意使用的虚构值，请登记到 KNOWN_SYNTHETIC。\n');
process.exit(1);
