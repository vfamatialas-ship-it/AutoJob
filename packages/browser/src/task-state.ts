/**
 * BrowserTask 状态机 —— PRD §26。
 *
 * 14 个状态覆盖一次投递的完整生命周期。每次状态变化都记日志，
 * 出问题时能回答「跑到哪一步挂的」而不是只有一句失败。
 *
 * ## 为什么要显式建模状态
 *
 * 自动投递不是一条直线：随时可能被登录、验证码、页面改版打断，
 * 打断后要能停在原地等用户，用户处理完还要能接着走。
 * 用一堆布尔标志表达这个过程会迅速失控，状态机是唯一可维护的方式。
 *
 * ## WAITING_USER 是一等公民
 *
 * PRD §3.6「低置信度不猜测」、§25「禁止绕过验证码」、§3.7「提交前暂停」，
 * 三条原则最终都落到同一个状态上。它不是错误分支，是正常流程的一部分。
 */

export const TaskState = {
  INIT: 'INIT',
  OPENING: 'OPENING',
  LOGIN_REQUIRED: 'LOGIN_REQUIRED',
  WAITING_USER: 'WAITING_USER',
  ATS_DETECTED: 'ATS_DETECTED',
  JOB_LIST_READY: 'JOB_LIST_READY',
  FORM_LOADING: 'FORM_LOADING',
  FORM_PARSING: 'FORM_PARSING',
  FILLING: 'FILLING',
  VALIDATING: 'VALIDATING',
  READY_TO_SUBMIT: 'READY_TO_SUBMIT',
  SUBMITTING: 'SUBMITTING',
  VERIFYING: 'VERIFYING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
} as const;

export type TaskState = (typeof TaskState)[keyof typeof TaskState];

/** 终态：不再有后续转移 */
const TERMINAL: ReadonlySet<TaskState> = new Set<TaskState>([TaskState.SUCCESS, TaskState.FAILED]);

export const isTerminal = (state: TaskState): boolean => TERMINAL.has(state);

/**
 * 合法转移表。
 *
 * 刻意写全而不是「什么都能转到什么」—— 非法转移通常意味着逻辑写错了，
 * 让它在开发期就炸出来，比在真实投递中途出现莫名其妙的行为要好。
 *
 * 注意 FAILED 可以从任何非终态到达（异常随时可能发生），
 * WAITING_USER 也几乎可从任何工作状态进入（随时可能需要人介入）。
 */
const TRANSITIONS: Readonly<Record<TaskState, readonly TaskState[]>> = {
  INIT: [TaskState.OPENING],
  OPENING: [TaskState.LOGIN_REQUIRED, TaskState.ATS_DETECTED, TaskState.FORM_LOADING],
  LOGIN_REQUIRED: [TaskState.WAITING_USER],
  // 用户处理完之后，可能回到任意一个工作状态继续
  WAITING_USER: [
    TaskState.OPENING,
    TaskState.ATS_DETECTED,
    TaskState.JOB_LIST_READY,
    TaskState.FORM_LOADING,
    TaskState.FORM_PARSING,
    TaskState.FILLING,
    TaskState.VALIDATING,
    TaskState.READY_TO_SUBMIT,
  ],
  ATS_DETECTED: [TaskState.JOB_LIST_READY, TaskState.FORM_LOADING],
  JOB_LIST_READY: [TaskState.FORM_LOADING],
  FORM_LOADING: [TaskState.FORM_PARSING, TaskState.LOGIN_REQUIRED],
  FORM_PARSING: [TaskState.FILLING],
  FILLING: [TaskState.VALIDATING, TaskState.WAITING_USER],
  VALIDATING: [TaskState.READY_TO_SUBMIT, TaskState.FILLING, TaskState.WAITING_USER],
  // 默认停在 READY_TO_SUBMIT 等用户确认（PRD §3.7），确认后才进 SUBMITTING
  READY_TO_SUBMIT: [TaskState.SUBMITTING, TaskState.WAITING_USER],
  SUBMITTING: [TaskState.VERIFYING],
  VERIFYING: [TaskState.SUCCESS, TaskState.FAILED],
  SUCCESS: [],
  FAILED: [],
};

export function canTransition(from: TaskState, to: TaskState): boolean {
  if (isTerminal(from)) return false;
  if (to === TaskState.FAILED) return true; // 异常随时可能发生
  if (to === TaskState.WAITING_USER) return from !== TaskState.WAITING_USER;
  return TRANSITIONS[from].includes(to);
}

export interface StateTransition {
  readonly from: TaskState;
  readonly to: TaskState;
  readonly at: string;
  readonly note: string;
}

export interface TaskMachineOptions {
  readonly onTransition?: (transition: StateTransition) => void;
  readonly now?: () => Date;
}

/**
 * 状态机。保存完整转移历史，供 Observability 与事后排查使用（PRD §73）。
 */
export class TaskMachine {
  private current: TaskState = TaskState.INIT;
  private readonly transitions: StateTransition[] = [];
  private readonly onTransition: ((transition: StateTransition) => void) | undefined;
  private readonly now: () => Date;

  constructor(options: TaskMachineOptions = {}) {
    this.onTransition = options.onTransition;
    this.now = options.now ?? ((): Date => new Date());
  }

  get state(): TaskState {
    return this.current;
  }

  get history(): readonly StateTransition[] {
    return this.transitions;
  }

  /** 非法转移直接抛错 —— 这属于程序逻辑错误，不该被静默吞掉 */
  to(next: TaskState, note = ''): void {
    if (!canTransition(this.current, next)) {
      throw new Error(`非法状态转移：${this.current} → ${next}`);
    }

    const transition: StateTransition = {
      from: this.current,
      to: next,
      at: this.now().toISOString(),
      note,
    };

    this.current = next;
    this.transitions.push(transition);
    this.onTransition?.(transition);
  }

  /** 是否处于等待用户介入的状态 */
  get isWaitingUser(): boolean {
    return this.current === TaskState.WAITING_USER || this.current === TaskState.LOGIN_REQUIRED;
  }

  get isDone(): boolean {
    return isTerminal(this.current);
  }
}
