import { describe, expect, it } from 'vitest';
import { TaskMachine, TaskState, canTransition, isTerminal } from '../src/task-state.js';

const fixedNow = (): Date => new Date('2026-09-09T10:00:00.000Z');

describe('状态转移合法性', () => {
  it('正常投递路径全程合法', () => {
    const machine = new TaskMachine({ now: fixedNow });
    const path: TaskState[] = [
      TaskState.OPENING,
      TaskState.FORM_LOADING,
      TaskState.FORM_PARSING,
      TaskState.FILLING,
      TaskState.VALIDATING,
      TaskState.READY_TO_SUBMIT,
      TaskState.SUBMITTING,
      TaskState.VERIFYING,
      TaskState.SUCCESS,
    ];

    for (const next of path) machine.to(next);

    expect(machine.state).toBe(TaskState.SUCCESS);
    expect(machine.history).toHaveLength(path.length);
    expect(machine.isDone).toBe(true);
  });

  it('非法转移直接抛错，不静默吞掉', () => {
    const machine = new TaskMachine({ now: fixedNow });
    // INIT 不能直接跳到填写
    expect(() => machine.to(TaskState.FILLING)).toThrow(/非法状态转移/);
  });

  it('终态不可再转移', () => {
    const machine = new TaskMachine({ now: fixedNow });
    machine.to(TaskState.OPENING);
    machine.to(TaskState.FORM_LOADING);
    machine.to(TaskState.FORM_PARSING);
    machine.to(TaskState.FILLING);
    machine.to(TaskState.FAILED);

    expect(machine.isDone).toBe(true);
    expect(() => machine.to(TaskState.FILLING)).toThrow();
  });

  it('FAILED 可从任何非终态到达 —— 异常随时可能发生', () => {
    expect(canTransition(TaskState.OPENING, TaskState.FAILED)).toBe(true);
    expect(canTransition(TaskState.FILLING, TaskState.FAILED)).toBe(true);
    expect(canTransition(TaskState.SUCCESS, TaskState.FAILED)).toBe(false);
  });
});

describe('WAITING_USER 是一等公民（PRD §3.6 / §25 / §3.7）', () => {
  it('填写中途可随时转入等待用户', () => {
    const machine = new TaskMachine({ now: fixedNow });
    machine.to(TaskState.OPENING);
    machine.to(TaskState.FORM_LOADING);
    machine.to(TaskState.FORM_PARSING);
    machine.to(TaskState.FILLING);
    machine.to(TaskState.WAITING_USER, '「实践经历」语义不明，等待用户确认');

    expect(machine.isWaitingUser).toBe(true);
  });

  it('用户处理完后能回到工作状态继续', () => {
    const machine = new TaskMachine({ now: fixedNow });
    machine.to(TaskState.OPENING);
    machine.to(TaskState.LOGIN_REQUIRED);
    machine.to(TaskState.WAITING_USER, '等待用户扫码登录');
    machine.to(TaskState.FORM_LOADING, '用户登录完成');

    expect(machine.state).toBe(TaskState.FORM_LOADING);
    expect(machine.isWaitingUser).toBe(false);
  });

  it('LOGIN_REQUIRED 只能转到 WAITING_USER，不能自行绕过', () => {
    expect(canTransition(TaskState.LOGIN_REQUIRED, TaskState.WAITING_USER)).toBe(true);
    expect(canTransition(TaskState.LOGIN_REQUIRED, TaskState.FILLING)).toBe(false);
    expect(canTransition(TaskState.LOGIN_REQUIRED, TaskState.SUBMITTING)).toBe(false);
  });

  it('不会从 WAITING_USER 转到自己，避免死循环记录', () => {
    expect(canTransition(TaskState.WAITING_USER, TaskState.WAITING_USER)).toBe(false);
  });
});

describe('默认在提交前停住（PRD §3.7）', () => {
  it('校验通过后进入 READY_TO_SUBMIT 而非直接提交', () => {
    const machine = new TaskMachine({ now: fixedNow });
    machine.to(TaskState.OPENING);
    machine.to(TaskState.FORM_LOADING);
    machine.to(TaskState.FORM_PARSING);
    machine.to(TaskState.FILLING);
    machine.to(TaskState.VALIDATING);
    machine.to(TaskState.READY_TO_SUBMIT);

    expect(machine.state).toBe(TaskState.READY_TO_SUBMIT);
    expect(machine.isDone).toBe(false);
  });

  it('填写完不能跳过校验直接提交', () => {
    expect(canTransition(TaskState.FILLING, TaskState.SUBMITTING)).toBe(false);
    expect(canTransition(TaskState.FILLING, TaskState.VALIDATING)).toBe(true);
  });

  it('校验失败可回到填写重来', () => {
    expect(canTransition(TaskState.VALIDATING, TaskState.FILLING)).toBe(true);
  });

  it('提交后必须经过验证才能判定成功', () => {
    expect(canTransition(TaskState.SUBMITTING, TaskState.SUCCESS)).toBe(false);
    expect(canTransition(TaskState.SUBMITTING, TaskState.VERIFYING)).toBe(true);
    expect(canTransition(TaskState.VERIFYING, TaskState.SUCCESS)).toBe(true);
  });
});

describe('转移历史与回调', () => {
  it('记录完整历史供事后排查（PRD §73）', () => {
    const machine = new TaskMachine({ now: fixedNow });
    machine.to(TaskState.OPENING, '打开招聘页');
    machine.to(TaskState.FORM_LOADING, '进入申请表');

    expect(machine.history).toHaveLength(2);
    expect(machine.history[0]).toMatchObject({
      from: TaskState.INIT,
      to: TaskState.OPENING,
      note: '打开招聘页',
      at: '2026-09-09T10:00:00.000Z',
    });
  });

  it('回调在每次转移时触发', () => {
    const seen: string[] = [];
    const machine = new TaskMachine({
      now: fixedNow,
      onTransition: (transition) => seen.push(`${transition.from}→${transition.to}`),
    });

    machine.to(TaskState.OPENING);
    machine.to(TaskState.FORM_LOADING);

    expect(seen).toEqual(['INIT→OPENING', 'OPENING→FORM_LOADING']);
  });
});

describe('isTerminal', () => {
  it('只有 SUCCESS 与 FAILED 是终态', () => {
    expect(isTerminal(TaskState.SUCCESS)).toBe(true);
    expect(isTerminal(TaskState.FAILED)).toBe(true);
    expect(isTerminal(TaskState.READY_TO_SUBMIT)).toBe(false);
    expect(isTerminal(TaskState.WAITING_USER)).toBe(false);
  });
});
