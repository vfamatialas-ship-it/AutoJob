# AutoJob 秋招智能投递助手

> 面向异构企业 ATS 的语义驱动校园招聘自动投递系统。
>
> 通过统一 Candidate Knowledge Model 对科研、实习、工作、项目、奖学金和竞赛等候选人经历进行显式语义建模，结合 ATS Schema Detection、LLM 字段理解、规则映射与 Playwright 浏览器自动化，实现跨招聘系统的岗位筛选、自适应表单填写、附件选择、人工校验及投递进度追踪。

**当前状态：M0–M11 全部完成，可自用**。见 [开发进展](docs/03-进展/PROGRESS.md) 与 [使用手册](docs/06-使用手册/README.md)。

---

## 它解决什么问题

校招要在几十家企业官网重复填写简历。招聘网站的「上传 PDF 自动解析」错误率极高：把科研经历识别成工作经历、把课题组项目识别成实习、把奖学金和竞赛奖项混在一起。

AutoJob 的思路不是「PDF 自动填写机器人」，而是：

- **Candidate Profile 是唯一事实来源**，PDF 只是一个附件、一个输出版本。
- **不为每家公司写脚本**，而是 `URL → ATS Detector → ATS Adapter`，一个 Adapter 服务多个企业。
- **已适配站点走确定性程序**（Playwright + Adapter），**未知站点才用 AI** 理解页面。
- **LLM 不得创造事实**：可以压缩、改写、排序，不得编造技能、经历、奖项、量化成果。
- **低置信度不猜测**，进入 `WAITING_USER` 问用户。
- **默认不无人值守**：自动填写，但提交前展示完整 Diff，由用户确认。

## 快速开始

```bash
corepack enable pnpm
pnpm install
pnpm exec playwright install chromium
pnpm autojob doctor    # 环境自检
```

投递一个岗位（**填完会停在提交前等你核对**）：

```bash
pnpm autojob apply "<申请页 URL>" --company "公司名" --job "岗位名"
```

抓取并匹配一家公司的岗位（只读，不投）：

```bash
pnpm autojob jobs "<招聘主页 URL>"
pnpm autojob match "<招聘主页 URL>"
```

看投递记录：

```bash
pnpm autojob app list
```

桌面端安装包（需要 Rust 工具链与 Tauri 系统依赖）：

```bash
node scripts/build-worker.mjs                              # Linux
cd apps/desktop && pnpm exec tauri build --bundles deb

pnpm build:win                                             # Windows（可在 Linux 上交叉构建）
```

打包细节与环境准备见 [打包指南](docs/06-使用手册/打包.md)。

完整用法见 [使用手册](docs/06-使用手册/README.md)。

## 目录结构

```text
秋招助手/
├── docs/
│   ├── 01-需求/      产品需求文档 PRD
│   ├── 02-计划/      实施计划与里程碑
│   ├── 03-进展/      每轮开发日志
│   ├── 04-设计/      各模块设计文档
│   └── 05-调研/      ATS 调研
│   └── 06-使用手册/  日常怎么用
├── apps/
│   ├── cli/          命令行入口（投递主链路）
│   ├── worker/       本地 Worker：把能力暴露给桌面端
│   └── desktop/      Tauri 2 + React 桌面端
├── packages/
│   ├── core/             Result / 错误码 / PII 脱敏 / 日志 / Run ID
│   ├── candidate-profile/ 候选人数据模型与红线
│   ├── form-schema/      DOM 提取与语义分类
│   ├── form-mapper/      规则引擎与取值映射
│   ├── browser/          Playwright 会话与填写
│   ├── content-adapter/  抽取式压缩与事实校验
│   ├── application-diff/ 提交前的转换说明
│   ├── job-discovery/    岗位列表解析
│   ├── job-matcher/      硬性筛选与打分
│   ├── ats-detector/     按资源来源识别 ATS
│   ├── database/         SQLite 投递记录
│   └── adapters/         moka / generic
├── scripts/          打包与隐私审计
├── tests/            Mock 招聘站点、E2E
└── materials/        个人资料（已 gitignore，不上传）
```

## 技术栈

TypeScript · Node 22 · Playwright · SQLite + Drizzle · Zod · Vitest · Tauri 2 + React · Node SEA 单文件打包

## 里程碑

| 里程碑 | 内容                                        | 状态    |
| ------ | ------------------------------------------- | ------- |
| M0     | 项目地基、质量闸门                          | ✅ 完成 |
| M1     | Candidate Profile 数据底座                  | ✅ 完成 |
| M2     | Mock ATS 站点群（9 个刁难站）               | ✅ 完成 |
| M3     | Form Schema + 语义分类器                    | ✅ 完成 |
| M4     | Mapping Engine + Mapping Memory             | ✅ 完成 |
| M5     | 浏览器填写引擎（提交前停止）                | ✅ 完成 |
| M6     | Application Diff + 内容自适应               | ✅ 完成 |
| M7     | Job Discovery + Job Matcher                 | ✅ 完成 |
| M8     | ATS 识别 + Moka Adapter                     | ✅ 完成 |
| M9     | Submit 验证 + 投递看板（MVP 完成）          | ✅ 完成 |
| M10    | Desktop GUI（Tauri + React）                | ✅ 完成 |
| M11    | 产品化打包（Linux `.deb` + Windows `.exe`） | ✅ 完成 |

完整计划见 [实施计划](docs/02-计划/AutoJob_PLAN_v1.0.md)。

## 开发约束

参与开发前请先读 [CLAUDE.md](CLAUDE.md)，其中包含隐私红线与禁止事项。

## 免责声明

本项目用于辅助个人求职，**默认在提交前暂停并由用户确认**，不实现验证码绕过，不做高频批量投递。使用前请自行确认目标招聘网站的服务条款。
