/**
 * 结构化错误码 —— PRD §71。
 *
 * 硬性要求：所有失败都必须落在某个错误码上，禁止只输出 "Something went wrong"。
 * 每个错误码都标注了「谁能修」，因为这决定了 UI 该把球踢给用户还是自己重试。
 */

export const ErrorCode = {
  // —— 需要用户介入（人在回路，PRD §3.6 / §25）——
  /** 站点要求登录，需用户手动完成 */
  LOGIN_REQUIRED: 'LOGIN_REQUIRED',
  /** 遇到验证码。PRD §74 明令禁止自动绕过，只能交给用户 */
  CAPTCHA_REQUIRED: 'CAPTCHA_REQUIRED',
  /** 登录态过期，需重新登录 */
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  /** 字段语义无法判定，置信度不足，禁止猜测 */
  UNKNOWN_FIELD: 'UNKNOWN_FIELD',
  /** 该岗位已投递过 */
  DUPLICATE_APPLICATION: 'DUPLICATE_APPLICATION',

  // —— 系统可自行处理或重试 ——
  /** 附件上传失败 */
  UPLOAD_FAILED: 'UPLOAD_FAILED',
  /** 表单校验未通过 */
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  /** 页面结构与 Adapter 预期不符，可能已改版 */
  FORM_CHANGED: 'FORM_CHANGED',
  /** 提交动作失败 */
  SUBMISSION_FAILED: 'SUBMISSION_FAILED',

  // —— 能力边界 ——
  /** 识别到的 ATS 尚无对应 Adapter */
  ATS_UNSUPPORTED: 'ATS_UNSUPPORTED',

  // —— 内部 ——
  /** 数据不符合 Schema */
  SCHEMA_INVALID: 'SCHEMA_INVALID',
  /** 配置缺失或非法 */
  CONFIG_INVALID: 'CONFIG_INVALID',
  /** LLM 调用失败 */
  LLM_FAILED: 'LLM_FAILED',
  /** 数据库操作失败 */
  STORAGE_FAILED: 'STORAGE_FAILED',
  /** 兜底：出现即视为 bug，应补充更精确的错误码 */
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** 需要用户介入才能继续的错误码集合 —— 命中即进入 WAITING_USER 状态 */
const USER_ACTIONABLE: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  ErrorCode.LOGIN_REQUIRED,
  ErrorCode.CAPTCHA_REQUIRED,
  ErrorCode.SESSION_EXPIRED,
  ErrorCode.UNKNOWN_FIELD,
  ErrorCode.DUPLICATE_APPLICATION,
]);

export const isUserActionable = (code: ErrorCode): boolean => USER_ACTIONABLE.has(code);

/** 错误附带的上下文。禁止塞入原始个人数据 —— 日志层虽会脱敏，但源头就不该放。 */
export type ErrorContext = Record<string, string | number | boolean | null>;

export interface AutoJobErrorOptions {
  /** 给用户看的建议动作，例如「请在浏览器中完成扫码登录」 */
  readonly hint?: string;
  readonly context?: ErrorContext;
  readonly cause?: unknown;
}

export class AutoJobError extends Error {
  readonly code: ErrorCode;
  readonly hint: string | undefined;
  readonly context: ErrorContext;

  constructor(code: ErrorCode, message: string, options: AutoJobErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AutoJobError';
    this.code = code;
    this.hint = options.hint;
    this.context = options.context ?? {};
  }

  /** 是否需要用户介入 */
  get userActionable(): boolean {
    return isUserActionable(this.code);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      hint: this.hint,
      context: this.context,
      userActionable: this.userActionable,
    };
  }
}

/** 把任意 catch 到的 unknown 归一成 AutoJobError，避免上层再做 instanceof 判断。 */
export function toAutoJobError(
  thrown: unknown,
  fallbackCode: ErrorCode = ErrorCode.INTERNAL,
): AutoJobError {
  if (thrown instanceof AutoJobError) return thrown;
  if (thrown instanceof Error) {
    return new AutoJobError(fallbackCode, thrown.message, { cause: thrown });
  }
  return new AutoJobError(fallbackCode, String(thrown), { cause: thrown });
}
