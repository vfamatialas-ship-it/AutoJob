/**
 * autojob app —— 投递看板与状态管理（PRD §36 / §37 / §38）。
 *
 * ## 为什么状态要手动更新
 *
 * 邮件自动追踪（PRD §40）明确留到后续阶段。现阶段用户收到笔试/面试通知后
 * 自己敲一条命令，成本很低，而自动读邮箱要处理授权、隐私、误判一大堆问题。
 *
 * 秋招周期长达数月，真正有价值的不是「自动」，而是**有个地方能一眼看到
 * 投了哪些、卡在哪一步**。这一点手动更新完全够用。
 */

import {
  APPLICATION_STATUSES,
  ApplicationRepository,
  openDatabase,
  type ApplicationStatus,
} from '@autojob/database';
import { AutoJobError, ErrorCode } from '@autojob/core';
import type { Command } from 'commander';

const write = (text: string): void => void process.stdout.write(`${text}\n`);

/** 状态的中文名与展示顺序。顺序即投递流程的推进顺序 */
const STATUS_LABELS: Record<string, string> = {
  DISCOVERED: '已发现',
  MATCHED: '已匹配',
  SAVED: '已收藏',
  QUEUED: '排队中',
  FILLING: '填写中',
  WAITING_USER: '待处理',
  READY_TO_SUBMIT: '待提交',
  SUBMITTED: '已投递',
  OA: '笔试',
  INTERVIEW: '面试',
  OFFER: 'Offer',
  REJECTED: '已拒绝',
  WITHDRAWN: '已撤回',
  FAILED: '失败',
};

/** Dashboard 上重点展示的几个阶段（PRD §38） */
const DASHBOARD_ORDER: readonly string[] = [
  'READY_TO_SUBMIT',
  'SUBMITTED',
  'OA',
  'INTERVIEW',
  'OFFER',
  'REJECTED',
];

function openRepo(dbPath: string | undefined): { repo: ApplicationRepository; close: () => void } {
  const db = openDatabase(dbPath === undefined ? {} : { path: dbPath });
  return { repo: new ApplicationRepository(db), close: () => db.close() };
}

const pad = (text: string, width: number): string => {
  // 中文字符占两个显示宽度，按此计算填充
  const displayWidth = [...text].reduce((sum, char) => sum + (/[一-龥＀-￯]/.test(char) ? 2 : 1), 0);
  return text + ' '.repeat(Math.max(width - displayWidth, 0));
};

export function registerAppCommand(program: Command): void {
  const app = program.command('app').description('查看与更新投递记录');

  app
    .command('list', { isDefault: true })
    .description('投递看板')
    .option('--db <path>', '数据库路径')
    .option('-s, --status <status>', '只看某个状态')
    .action((options: { db?: string; status?: string }) => {
      const { repo, close } = openRepo(options.db);

      try {
        const counts = repo.statusCounts();
        const total = Object.values(counts).reduce((sum, count) => sum + count, 0);

        write('');
        write('═══ 秋招投递看板 ═══');
        write('');

        if (total === 0) {
          write('还没有投递记录。用 autojob apply <申请页 URL> 开始第一次投递。');
          return;
        }

        const summary = DASHBOARD_ORDER.filter((status) => (counts[status] ?? 0) > 0)
          .map((status) => `${STATUS_LABELS[status] ?? status} ${counts[status]}`)
          .join('  ');
        write(`总计 ${total}  ${summary}`);
        write('');

        const rows = repo.listApplications(
          options.status === undefined ? {} : { status: options.status as ApplicationStatus },
        );

        write(`  ${pad('公司', 20)}${pad('岗位', 32)}${pad('状态', 10)}日期`);
        write(`  ${'─'.repeat(72)}`);

        for (const row of rows) {
          const date = (row.application.submittedAt ?? row.application.createdAt).slice(0, 10);
          write(
            `  ${pad(row.company.name, 20)}${pad(row.job.title, 32)}` +
              `${pad(STATUS_LABELS[row.application.status] ?? row.application.status, 10)}${date}`,
          );
        }

        write('');
        write('更新状态：autojob app update <记录ID> --status INTERVIEW');
        write('查看时间线：autojob app timeline <记录ID>');
      } finally {
        close();
      }
    });

  app
    .command('update')
    .description('更新投递状态')
    .argument('<id>', '投递记录 ID')
    .requiredOption('-s, --status <status>', `新状态：${APPLICATION_STATUSES.join(' / ')}`)
    .option('-n, --notes <text>', '备注')
    .option('--db <path>', '数据库路径')
    .action((id: string, options: { status: string; notes?: string; db?: string }) => {
      const status = options.status.toUpperCase() as ApplicationStatus;

      if (!APPLICATION_STATUSES.includes(status)) {
        throw new AutoJobError(ErrorCode.CONFIG_INVALID, `未知状态：${options.status}`, {
          hint: `可用状态：${APPLICATION_STATUSES.join(' / ')}`,
        });
      }

      const { repo, close } = openRepo(options.db);
      try {
        // source 标为 user：这是人工更新，与系统自动记录的事件区分开
        const updated = repo.updateStatus(id, status, {
          source: 'user',
          ...(options.notes === undefined ? {} : { notes: options.notes }),
        });
        write(`已更新为「${STATUS_LABELS[updated.status] ?? updated.status}」`);
      } finally {
        close();
      }
    });

  app
    .command('timeline')
    .description('查看一次投递的完整时间线')
    .argument('<id>', '投递记录 ID')
    .option('--db <path>', '数据库路径')
    .action((id: string, options: { db?: string }) => {
      const { repo, close } = openRepo(options.db);

      try {
        const events = repo.timeline(id);
        if (events.length === 0) {
          write(`没有找到记录 ${id} 的事件。`);
          process.exitCode = 1;
          return;
        }

        write('');
        for (const event of events) {
          const from = event.oldStatus === null ? '' : `${STATUS_LABELS[event.oldStatus]} → `;
          const to = STATUS_LABELS[event.newStatus ?? ''] ?? event.newStatus ?? '';
          const by = event.source === 'user' ? '（手动）' : '';
          write(`  ${event.createdAt.slice(0, 16).replace('T', ' ')}  ${from}${to}${by}`);
          if (event.notes !== null && event.notes.length > 0) write(`      ${event.notes}`);
        }
        write('');
      } finally {
        close();
      }
    });
}
