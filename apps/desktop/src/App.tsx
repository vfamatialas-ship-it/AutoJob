/**
 * AutoJob 桌面端主界面。
 *
 * ## 界面组织的取舍
 *
 * 秋招期间用户真正高频做的只有三件事：看投了哪些、找新岗位、核对档案。
 * 所以这三个放前面，附件与设置放后面。
 *
 * 有一件事**刻意没有做进界面**：一键投递。
 * 填表要开真实浏览器、可能要扫码登录、提交前要人核对 Diff ——
 * 这个过程本来就该在终端里一步步走，塞进图形界面只会让用户以为
 * 「点一下就投出去了」。界面负责决策（投哪个），终端负责执行（怎么投）。
 */

import { useCallback, useEffect, useState } from 'react';
import {
  api,
  type ApplicationsResponse,
  type AssetItem,
  type MatchResponse,
  type ProfileSummary,
  type TimelineEvent,
} from './worker-client';

type Tab = 'dashboard' | 'match' | 'profile' | 'assets' | 'settings';

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'dashboard', label: '投递看板' },
  { id: 'match', label: '岗位匹配' },
  { id: 'profile', label: '我的档案' },
  { id: 'assets', label: '附件库' },
  { id: 'settings', label: '设置' },
];

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

/** 看板统计卡片的配色。Offer/面试用绿、笔试/待提交用橙、拒绝用红 */
const STATUS_TONE: Record<string, string> = {
  OFFER: 'ok',
  INTERVIEW: 'ok',
  OA: 'warn',
  READY_TO_SUBMIT: 'warn',
  REJECTED: 'danger',
  FAILED: 'danger',
};

/** 看板上重点展示的阶段 */
const HIGHLIGHT: readonly string[] = ['READY_TO_SUBMIT', 'SUBMITTED', 'OA', 'INTERVIEW', 'OFFER'];

function ErrorBox({ error }: { error: string | undefined }): React.JSX.Element | null {
  if (error === undefined) return null;
  return <div className="error">{error}</div>;
}

// ————————————————————————————————————————————————
// 投递看板
// ————————————————————————————————————————————————

function Dashboard(): React.JSX.Element {
  const [data, setData] = useState<ApplicationsResponse>();
  const [error, setError] = useState<string>();
  const [timeline, setTimeline] = useState<{ id: string; events: TimelineEvent[] }>();

  const reload = useCallback(() => {
    api
      .applications()
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(reload, [reload]);

  const changeStatus = (id: string, status: string): void => {
    api
      .updateApplication(id, status)
      .then(reload)
      .catch((e: Error) => setError(e.message));
  };

  const showTimeline = (id: string): void => {
    api
      .timeline(id)
      .then((events) => setTimeline({ id, events }))
      .catch((e: Error) => setError(e.message));
  };

  return (
    <>
      <h1>投递看板</h1>
      <p className="subtitle">秋招周期长达数月，这里是唯一需要经常回来看的地方。</p>
      <ErrorBox error={error} />

      <div className="stats">
        {HIGHLIGHT.map((status) => (
          <div className="stat" key={status}>
            <b className={STATUS_TONE[status] ?? ''}>{data?.counts[status] ?? 0}</b>
            <span>{STATUS_LABELS[status]}</span>
          </div>
        ))}
      </div>

      <div className="card">
        {data === undefined ? (
          <div className="empty">加载中…</div>
        ) : data.items.length === 0 ? (
          <div className="empty">
            还没有投递记录。
            <br />
            <span className="hint">
              在终端运行 <code>autojob apply &lt;申请页 URL&gt;</code> 开始第一次投递。
            </span>
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>公司</th>
                <th>岗位</th>
                <th>招聘系统</th>
                <th>状态</th>
                <th>日期</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.id}>
                  <td>{item.company}</td>
                  <td>{item.title}</td>
                  <td>
                    <span className="badge">{item.atsType}</span>
                  </td>
                  <td>
                    <select
                      value={item.status}
                      onChange={(event) => changeStatus(item.id, event.target.value)}
                    >
                      {Object.entries(STATUS_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>{(item.submittedAt ?? item.createdAt).slice(0, 10)}</td>
                  <td>
                    <button className="link" onClick={() => showTimeline(item.id)}>
                      时间线
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {timeline !== undefined && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>投递时间线</strong>
            <button className="link" onClick={() => setTimeline(undefined)}>
              收起
            </button>
          </div>
          <table>
            <tbody>
              {timeline.events.map((event, index) => (
                <tr key={index}>
                  <td style={{ width: 150 }}>{event.at.slice(0, 16).replace('T', ' ')}</td>
                  <td>
                    {event.from === null ? '' : `${STATUS_LABELS[event.from] ?? event.from} → `}
                    {STATUS_LABELS[event.to ?? ''] ?? event.to}
                    {event.source === 'user' && <span className="hint">（手动）</span>}
                  </td>
                  <td className="hint">{event.notes ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

// ————————————————————————————————————————————————
// 岗位匹配
// ————————————————————————————————————————————————

function MatchPage(): React.JSX.Element {
  const [url, setUrl] = useState('');
  const [company, setCompany] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MatchResponse>();
  const [error, setError] = useState<string>();

  const run = (): void => {
    setBusy(true);
    setError(undefined);
    api
      .matchJobs(url, company.length > 0 ? company : undefined)
      .then(setResult)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <h1>岗位匹配</h1>
      <p className="subtitle">
        输入企业招聘页地址，按你的方向打分排序。<strong>本页面只读，不会投递。</strong>
      </p>
      <ErrorBox error={error} />

      <div className="card">
        <div className="row">
          <input
            type="url"
            placeholder="https://example.com/campus"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
          <input
            type="text"
            placeholder="公司名（可选）"
            style={{ flex: '0 0 160px' }}
            value={company}
            onChange={(event) => setCompany(event.target.value)}
          />
          <button className="primary" onClick={run} disabled={busy || url.length === 0}>
            {busy ? '抓取中…' : '开始匹配'}
          </button>
        </div>
        {busy && (
          <p className="hint" style={{ marginTop: 10 }}>
            正在打开页面并等待岗位渲染，通常需要几秒到十几秒。
          </p>
        )}
      </div>

      {result !== undefined && (
        <div className="card">
          <p className="hint">
            招聘系统：{result.ats}　共 {result.summary.total} 个岗位，通过筛选{' '}
            {result.summary.passed}，已过滤 {result.summary.rejected}
          </p>
          <table>
            <thead>
              <tr>
                <th style={{ width: 52 }}>匹配度</th>
                <th>岗位</th>
                <th style={{ width: 90 }}>地点</th>
                <th>匹配理由</th>
              </tr>
            </thead>
            <tbody>
              {result.items
                .filter((item) => item.passed)
                .map((item, index) => (
                  <tr key={index}>
                    <td className="score">{item.score}</td>
                    <td>
                      <a href={item.url} target="_blank" rel="noreferrer">
                        {item.title}
                      </a>
                    </td>
                    <td>{item.location}</td>
                    <td className="hint">{item.summary}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <p className="hint" style={{ marginTop: 14 }}>
            要投递某个岗位，在终端运行 <code>autojob apply &lt;该岗位的申请页 URL&gt;</code>
            。填写完成后会展示完整 Diff，由你确认后再提交。
          </p>
        </div>
      )}
    </>
  );
}

// ————————————————————————————————————————————————
// 我的档案
// ————————————————————————————————————————————————

const COUNT_LABELS: Record<string, string> = {
  educations: '教育经历',
  experiences: '经历',
  projects: '项目',
  awards: '奖项',
  skills: '技能',
  assets: '附件',
  questions: '问答库',
};

function ProfilePage(): React.JSX.Element {
  const [summary, setSummary] = useState<ProfileSummary>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    api
      .profileSummary()
      .then(setSummary)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <>
      <h1>我的档案</h1>
      <p className="subtitle">整个系统唯一的事实来源。所有申请表的内容都从这里映射而来。</p>
      <ErrorBox error={error} />

      {summary !== undefined && (
        <>
          <div className="card">
            <table>
              <tbody>
                <tr>
                  <td style={{ width: 110, color: 'var(--muted)' }}>姓名</td>
                  <td>{summary.name}</td>
                </tr>
                <tr>
                  <td style={{ color: 'var(--muted)' }}>手机</td>
                  <td>
                    {summary.phone} <span className="hint">（已脱敏显示）</span>
                  </td>
                </tr>
                <tr>
                  <td style={{ color: 'var(--muted)' }}>邮箱</td>
                  <td>{summary.email}</td>
                </tr>
                <tr>
                  <td style={{ color: 'var(--muted)' }}>最高学历</td>
                  <td>{summary.education}</td>
                </tr>
                <tr>
                  <td style={{ color: 'var(--muted)' }}>预计毕业</td>
                  <td>{summary.expectedGraduation}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="stats">
            {Object.entries(summary.counts).map(([key, count]) => (
              <div className="stat" key={key}>
                <b>{count}</b>
                <span>{COUNT_LABELS[key] ?? key}</span>
              </div>
            ))}
          </div>

          <div className="card">
            <strong>档案检查</strong>
            {summary.issues.length === 0 ? (
              <p className="hint" style={{ marginTop: 8 }}>
                ✓ 引用完整性无问题，所有附件与经历的相互引用都有效。
              </p>
            ) : (
              <ul className="hint">
                {summary.issues.map((issue, index) => (
                  <li key={index}>{issue}</li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </>
  );
}

// ————————————————————————————————————————————————
// 附件库
// ————————————————————————————————————————————————

const ASSET_LABELS: Record<string, string> = {
  resume: '简历',
  portfolio: '作品集',
  transcript: '成绩单',
  paper: '论文',
  patent: '专利',
  certificate: '证书',
  award_certificate: '获奖证书',
  publication: '发表物',
  photo: '照片',
  other: '其他',
};

function AssetsPage(): React.JSX.Element {
  const [assets, setAssets] = useState<AssetItem[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    api
      .assets()
      .then(setAssets)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <>
      <h1>附件库</h1>
      <p className="subtitle">
        投递时按网站要求的类型、格式与大小自动选择。找不到合适的会明确报缺，不会拿别的顶替。
      </p>
      <ErrorBox error={error} />

      <div className="card">
        {assets === undefined ? (
          <div className="empty">加载中…</div>
        ) : assets.length === 0 ? (
          <div className="empty">档案里还没有登记附件。</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>名称</th>
                <th style={{ width: 100 }}>类型</th>
                <th style={{ width: 60 }}>语言</th>
                <th style={{ width: 80 }}>大小</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((asset) => (
                <tr key={asset.id}>
                  <td>{asset.name}</td>
                  <td>
                    <span className="badge">{ASSET_LABELS[asset.type] ?? asset.type}</span>
                  </td>
                  <td>{asset.language === 'zh' ? '中文' : '英文'}</td>
                  <td>{asset.sizeKb} KB</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

// ————————————————————————————————————————————————
// 设置
// ————————————————————————————————————————————————

function SettingsPage(): React.JSX.Element {
  const [config, setConfig] = useState<{
    profilePath: string;
    dbPath: string;
    profileExists: boolean;
  }>();
  const [profilePath, setProfilePath] = useState('');
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .config()
      .then((value) => {
        setConfig(value);
        setProfilePath(value.profilePath);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const save = (): void => {
    api
      .updateConfig({ profilePath })
      .then(() => {
        setSaved(true);
        return api.config();
      })
      .then(setConfig)
      .catch((e: Error) => setError(e.message));
  };

  return (
    <>
      <h1>设置</h1>
      <p className="subtitle">所有数据都存在本机，不会上传到任何服务器。</p>
      <ErrorBox error={error} />

      <div className="card">
        <p>
          <strong>档案文件路径</strong>
        </p>
        <div className="row">
          <input
            type="text"
            value={profilePath}
            onChange={(event) => {
              setProfilePath(event.target.value);
              setSaved(false);
            }}
          />
          <button className="primary" onClick={save}>
            保存
          </button>
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          {config?.profileExists === true ? '✓ 文件存在' : '✗ 找不到该文件'}
          {saved && ' · 已保存'}
        </p>
      </div>

      <div className="card">
        <p>
          <strong>数据库</strong>
        </p>
        <p className="hint">
          <code>{config?.dbPath}</code>
          <br />
          投递记录与状态时间线都存在这里。换机器时记得一并备份。
        </p>
      </div>

      <div className="card">
        <p>
          <strong>隐私</strong>
        </p>
        <p className="hint">
          档案、附件、浏览器登录态、投递记录全部保存在本机，不会上传。
          <br />
          日志与界面显示的手机号、邮箱均已脱敏。
          <br />
          本工具不会自动绕过验证码 —— 遇到时会暂停，交给你手动完成。
        </p>
      </div>
    </>
  );
}

// ————————————————————————————————————————————————

export default function App(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('dashboard');

  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">
          AutoJob
          <small>秋招投递助手</small>
        </div>
        {TABS.map((item) => (
          <button key={item.id} aria-current={tab === item.id} onClick={() => setTab(item.id)}>
            {item.label}
          </button>
        ))}
      </nav>

      <main>
        {tab === 'dashboard' && <Dashboard />}
        {tab === 'match' && <MatchPage />}
        {tab === 'profile' && <ProfilePage />}
        {tab === 'assets' && <AssetsPage />}
        {tab === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}
