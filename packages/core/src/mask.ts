/**
 * PII 脱敏 —— PRD §44「日志隐私」。
 *
 * 禁止落入日志的内容：完整手机号、身份证、Cookie、Token、密码。
 *
 * 两条防线：
 *   1. maskText()      —— 扫描自由文本，按模式脱敏（防止 PII 混在拼接字符串里溜走）
 *   2. redactValue()   —— 按 key 名递归屏蔽结构化对象中的敏感字段
 *
 * 设计取舍：宁可误伤（多脱敏一些），不可漏放。日志的可读性让位于隐私。
 */

/** 按 key 名屏蔽的敏感字段。比较时统一转小写并去掉分隔符。 */
const SENSITIVE_KEYS: readonly string[] = [
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'accesstoken',
  'refreshtoken',
  'apikey',
  'authorization',
  'auth',
  'cookie',
  'cookies',
  'session',
  'sessionid',
  'setcookie',
  'idnumber',
  'idcard',
  'creditcard',
  'bankcard',
  '身份证',
  '身份证号',
  '密码',
  '银行卡',
];

/** 需要脱敏但保留部分可读性的字段（不整体屏蔽，走 maskText 处理） */
const PARTIAL_KEYS: readonly string[] = [
  'phone',
  'mobile',
  'tel',
  'email',
  'address',
  '手机号',
  '邮箱',
  '地址',
];

export const REDACTED = '[已屏蔽]';

const normalizeKey = (key: string): string => key.toLowerCase().replace(/[-_\s]/g, '');

const isSensitiveKey = (key: string): boolean => {
  const k = normalizeKey(key);
  return SENSITIVE_KEYS.some((s) => k.includes(s));
};

const isPartialKey = (key: string): boolean => {
  const k = normalizeKey(key);
  return PARTIAL_KEYS.some((s) => k.includes(s));
};

/**
 * 手机号脱敏：13812341234 → 138****1234
 * 前后用 (?<!\d)/(?!\d) 卡住，避免把长数字串（如身份证）里的一段误判成手机号。
 */
export function maskPhone(input: string): string {
  return input.replace(/(?<!\d)(1[3-9]\d)\d{4}(\d{4})(?!\d)/g, '$1****$2');
}

/**
 * 身份证整体屏蔽。PRD §44 直接列为禁止记录项，因此不保留任何片段。
 * 覆盖 18 位（末位可为 X/x）与 15 位两种格式。
 */
export function maskIdNumber(input: string): string {
  return input
    .replace(/(?<![\dXx])\d{17}[\dXx](?![\dXx])/g, '[身份证已屏蔽]')
    .replace(/(?<!\d)\d{15}(?!\d)/g, '[身份证已屏蔽]');
}

/**
 * 邮箱脱敏：zhangsan@qq.com → z***@qq.com
 * 保留域名，因为域名对排查问题有用且不构成强标识。
 */
export function maskEmail(input: string): string {
  return input.replace(
    /(?<![\w.+-])([\w.+-])[\w.+-]*@([\w-]+(?:\.[\w-]+)+)/g,
    (_match, first: string, domain: string) => `${first}***@${domain}`,
  );
}

/** Cookie / Authorization 头形态的脱敏（值可能出现在自由文本里） */
function maskCredentialText(input: string): string {
  return input
    .replace(/\b(Bearer|Basic)\s+[\w.\-+/=]+/gi, '$1 [已屏蔽]')
    .replace(
      /\b(cookie|set-cookie|authorization|token|password|secret|api[-_]?key)\b\s*[:=]\s*\S+/gi,
      '$1=[已屏蔽]',
    );
}

/**
 * 自由文本综合脱敏。
 *
 * 顺序是有讲究的，三条都踩过坑：
 * 1. 身份证先于手机号 —— 否则 18 位身份证里的连续 11 位会被当成手机号，
 *    脱敏出一个残缺但仍可识别的串。
 * 2. **邮箱先于手机号** —— 邮箱本地部分常含长数字（如 zhang19303864024@qq.com），
 *    若先跑手机号规则会把它切成 193****4024，导致 maskEmail 只能保留到星号前，
 *    最终输出 Yang193****4***@qq.com，暴露的字符远多于预期的「首字母 + 域名」。
 * 3. 凭证（Bearer / cookie=）最先处理，避免其值被后续规则局部替换后失去整体特征。
 */
export function maskText(input: string): string {
  return maskPhone(maskEmail(maskIdNumber(maskCredentialText(input))));
}

/**
 * 递归屏蔽结构化数据。
 * - key 命中 SENSITIVE_KEYS → 整体替换为 [已屏蔽]
 * - key 命中 PARTIAL_KEYS 或普通字符串 → 走 maskText
 * - 处理循环引用，避免日志序列化时爆栈
 */
export function redactValue(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === 'string') return maskText(value);
  if (value === null || typeof value !== 'object') return value;

  if (seen.has(value)) return '[循环引用]';
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => redactValue(item, seen));

  if (value instanceof Error) {
    return { name: value.name, message: maskText(value.message) };
  }

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      output[key] = REDACTED;
    } else if (isPartialKey(key) && typeof item === 'string') {
      output[key] = maskText(item);
    } else {
      output[key] = redactValue(item, seen);
    }
  }
  return output;
}
