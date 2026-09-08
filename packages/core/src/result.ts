/**
 * Result 类型 —— 强制调用方显式处理失败。
 *
 * PRD §71 要求所有失败结构化，不允许出现 "Something went wrong"。
 * 用 Result 而不是 throw，可以让「哪些操作会失败、会怎样失败」出现在类型签名里。
 */

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

export const isOk = <T, E>(result: Result<T, E>): result is Ok<T> => result.ok;
export const isErr = <T, E>(result: Result<T, E>): result is Err<E> => !result.ok;

/** 取值，失败时抛出。仅用于「已经确认成功」的场景，不要拿它绕过错误处理。 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  throw new Error(`unwrap 了一个失败的 Result: ${JSON.stringify(result.error)}`);
}

/** 取值，失败时返回兜底值。 */
export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

/** 映射成功分支，失败分支原样透传。 */
export function mapOk<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

/** 映射失败分支，成功分支原样透传。 */
export function mapErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  return result.ok ? result : err(fn(result.error));
}
