/**
 * Worker 客户端。
 *
 * 界面里所有数据都从这里来 —— React 组件不直接碰 fetch，
 * 这样接口变了只需要改一处，也便于把「加载中/出错」的处理收在一起。
 */

import { invoke } from '@tauri-apps/api/core';

interface WorkerInfo {
  port: number;
  token: string;
}

let cached: WorkerInfo | undefined;

/**
 * 拿到 Worker 的地址与令牌。
 *
 * 令牌由 Worker 启动时随机生成，经 Rust 外壳转交 —— 全程不落磁盘。
 * 这样本机上的其他程序（比如浏览器里的网页）即使猜到端口也调不动接口。
 */
async function getWorker(): Promise<WorkerInfo> {
  if (cached !== undefined) return cached;
  cached = await invoke<WorkerInfo>('worker_info');
  return cached;
}

export async function callWorker<T>(path: string, body: unknown = {}): Promise<T> {
  const worker = await getWorker();

  const response = await fetch(`http://127.0.0.1:${worker.port}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-autojob-token': worker.token,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      hint?: string;
    };
    // 把 hint 一起带上：错误提示里的「怎么办」比「哪里错了」更有用
    throw new Error(
      [payload.error ?? `请求失败（${response.status}）`, payload.hint].filter(Boolean).join('\n'),
    );
  }

  return (await response.json()) as T;
}

// —— 各接口的返回类型 ——

export interface ProfileSummary {
  name: string;
  phone: string;
  email: string;
  education: string;
  expectedGraduation: string;
  counts: Record<string, number>;
  issues: string[];
}

export interface AssetItem {
  id: string;
  name: string;
  type: string;
  language: string;
  sizeKb: number;
  path: string;
}

export interface ApplicationItem {
  id: string;
  company: string;
  atsType: string;
  title: string;
  url: string;
  status: string;
  createdAt: string;
  submittedAt: string | null;
}

export interface ApplicationsResponse {
  counts: Record<string, number>;
  items: ApplicationItem[];
}

export interface MatchItem {
  title: string;
  url: string;
  location: string;
  department: string;
  score: number;
  passed: boolean;
  summary: string;
  rejectReason: string | null;
}

export interface MatchResponse {
  ats: string;
  summary: { total: number; passed: number; rejected: number; alreadyApplied: number };
  items: MatchItem[];
}

export interface TimelineEvent {
  at: string;
  from: string | null;
  to: string | null;
  source: string;
  notes: string | null;
}

export const api = {
  config: () =>
    callWorker<{ profilePath: string; dbPath: string; profileExists: boolean }>('/config'),
  updateConfig: (patch: { profilePath?: string; dbPath?: string }) =>
    callWorker<{ profilePath: string; dbPath: string }>('/config/update', patch),
  profileSummary: () => callWorker<ProfileSummary>('/profile/summary'),
  assets: () => callWorker<AssetItem[]>('/profile/assets'),
  applications: (status?: string) =>
    callWorker<ApplicationsResponse>('/applications', status === undefined ? {} : { status }),
  updateApplication: (id: string, status: string, notes?: string) =>
    callWorker<{ id: string; status: string }>('/applications/update', { id, status, notes }),
  timeline: (id: string) => callWorker<TimelineEvent[]>('/applications/timeline', { id }),
  matchJobs: (url: string, company?: string) =>
    callWorker<MatchResponse>('/jobs/match', { url, company }),
};
