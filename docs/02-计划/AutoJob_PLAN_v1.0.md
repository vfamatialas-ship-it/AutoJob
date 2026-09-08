# AutoJob 实施计划 v1.0

> 本文档是 `AutoJob_PRD_v1.0.md` 的**执行侧计划**：把 PRD 中的 16 个 Phase 落成可验收的里程碑、可执行的任务清单和明确的技术决策。
>
> - PRD = 做什么、为什么（需求与原则，尽量不改）
> - PLAN = 怎么做、什么顺序、做到什么算完成（本文档，随开发滚动更新）
>
> 工作目录：`/home/yang/项目/秋招助手`
> 建立日期：2026-09-08
> 状态：待启动（M0 尚未开始）

---

## 1. 环境现状与前置条件

已在开发机（Ubuntu 22.04）确认：

| 组件                             | 状态         | 说明                                                           |
| -------------------------------- | ------------ | -------------------------------------------------------------- |
| Node.js                          | ✅ v22.23.0  | 满足要求（需 ≥20）                                             |
| npm                              | ✅ 10.9.8    | 用于 bootstrap pnpm                                            |
| git                              | ✅ 2.34.1    | 版本偏旧但够用                                                 |
| Python                           | ✅ 3.10.12   | 非必需                                                         |
| 磁盘                             | ✅ 215G 可用 | Playwright 浏览器约需 1.5G                                     |
| **pnpm**                         | ❌ 未安装    | M0 阻塞项，`corepack enable pnpm` 解决                         |
| **Playwright 浏览器**            | ❌ 未下载    | M0 阻塞项，`pnpm exec playwright install chromium --with-deps` |
| **Rust / cargo**                 | ❌ 未安装    | 仅 M10（GUI）阻塞，届时再装                                    |
| **webkit2gtk 等 Tauri 系统依赖** | ❌ 未确认    | 同上，M10 前置                                                 |

**结论**：M0 只需解决 pnpm + Playwright 两项；Rust/Tauri 依赖推迟到 M10，避免过早引入重型工具链。

---

## 2. 技术决策（在 PRD §45 基础上定稿）

PRD 给的是"推荐"，这里定为**决定**，并标注与 PRD 的差异。

| 领域        | 决定                                                                          | 理由 / 与 PRD 差异                                        |
| ----------- | ----------------------------------------------------------------------------- | --------------------------------------------------------- |
| 包管理      | **pnpm workspace**                                                            | monorepo 标配，硬链接省盘                                 |
| 语言/运行时 | **TypeScript 5.x + Node 22**（不用 Bun）                                      | PRD 写"Node / Bun"；Playwright 在 Node 上最稳，Bun 无收益 |
| 构建        | **tsc（库） + tsx（开发时执行）**                                             | 前期不引 bundler，减少复杂度；GUI 阶段 desktop 用 Vite    |
| 校验        | **Zod 4**                                                                     | 同 PRD。Schema 即事实来源，类型由 `z.infer` 导出          |
| 数据库      | **SQLite（better-sqlite3） + Drizzle ORM + drizzle-kit 迁移**                 | 同 PRD。同步 API 简化 worker 逻辑                         |
| 浏览器      | **Playwright（Chromium，headful，persistent context）**                       | 同 PRD                                                    |
| 测试        | **Vitest（单测/快照） + @playwright/test（E2E）**                             | PRD 未指定；Vitest 与 TS/ESM 契合度最好                   |
| Lint/格式化 | **ESLint 9 flat config + Prettier**                                           | 同 PRD §49 隐含要求                                       |
| CLI         | **commander**                                                                 | 轻量，够用                                                |
| Mock 站点   | **静态 HTML + 极简 Node 静态服务器**                                          | 不引 express，零依赖                                      |
| LLM         | **自研 `LLMProvider` 接口**，首个实现为 Anthropic；OpenAI/Gemini/本地模型后补 | 同 PRD §45。不直接依赖任一 SDK 的类型泄漏到业务层         |
| GUI         | **Tauri 2 + React + TypeScript**                                              | 同 PRD，M10 才启动                                        |
| 模块格式    | **ESM only**（`"type": "module"`）                                            | 避免 CJS/ESM 双模式地狱                                   |

### 2.1 需要澄清的 PRD 内部冲突

PRD §51（Phase 0）要求先做"打开 URL → 解析表单 → 填写"，而 §79（推荐开发顺序）和 §52（Phase 1）要求 CandidateProfile 先行。两者顺序矛盾。

**本计划采用 §79 的顺序**：CandidateProfile Schema 先落地（M1），再做 Mock 站点和填写（M2/M3/M5）。PRD §51 的"Phase 0 验收清单"不作废——它被完整保留为 **M5 的验收标准**（见 §4.6）。理由：填写引擎的输入就是 Profile，先定 Profile 可以避免返工。

---

## 3. 仓库结构

按 PRD §48，但**按里程碑逐步创建，不一次性建空目录**（PRD §50：禁止一次生成几十个未运行的文件）。

```text
/home/yang/项目/秋招助手/
├── AutoJob_PRD_v1.0.md          # 需求（只读基线）
├── AutoJob_PLAN_v1.0.md         # 本文档
├── CLAUDE.md                    # 给开发智能体的常驻约束（M0 建立）
├── PROGRESS.md                  # 每轮开发日志（M0 建立）
└── autojob/                     # 代码仓库根（git init）
    ├── package.json / pnpm-workspace.yaml / tsconfig.base.json
    ├── apps/
    │   ├── cli/                 # M0 起：autojob 命令入口
    │   ├── worker/              # M8 起：常驻 worker（HTTP/WS）
    │   └── desktop/             # M10 起：Tauri + React
    ├── packages/
    │   ├── core/                # 通用类型、Result、错误码、日志、Run ID
    │   ├── candidate-profile/   # M1
    │   ├── asset-library/       # M5
    │   ├── question-bank/       # M5
    │   ├── database/            # M1（schema+迁移）
    │   ├── form-schema/         # M3
    │   ├── form-mapper/         # M4
    │   ├── content-adapter/     # M6
    │   ├── browser/             # M5
    │   ├── ats-detector/        # M8
    │   ├── job-discovery/       # M7
    │   ├── job-matcher/         # M7
    │   ├── application-tracker/ # M9
    │   ├── llm/                 # M3
    │   ├── security/            # M1（脱敏/加密）
    │   └── adapters/
    │       ├── generic/         # M5
    │       └── moka/ (或 beisen) # M8
    ├── tests/
    │   ├── fixtures/sites/      # M2：Mock 招聘站
    │   ├── fixtures/dom/        # M8：真实站点 DOM 快照
    │   └── e2e/
    └── docs/                    # 每个模块的设计说明
```

---

## 4. 里程碑总览

| 里程碑   | 名称                                     | 对应 PRD Phase | 估算     | 关键产出                               |
| -------- | ---------------------------------------- | -------------- | -------- | -------------------------------------- |
| **M0**   | 项目地基                                 | §80.1–3        | 1–2 天   | monorepo、CI、lint/typecheck/test 全绿 |
| **M1**   | Candidate Profile 数据底座               | Phase 1        | 4–6 天   | Zod Schema + SQLite + 导入导出         |
| **M2**   | Mock ATS 站点群                          | §67            | 3–4 天   | 6+ 个刻意刁难的 Mock 招聘页            |
| **M3**   | Form Schema + 语义分类器                 | Phase 2        | 5–7 天   | FormField 抽象 + 规则/LLM 分类         |
| **M4**   | Mapping Engine + Mapping Memory          | Phase 3        | 5–7 天   | 四级优先级规则引擎                     |
| **M5**   | 浏览器填写引擎（**PRD Phase 0 验收点**） | Phase 0 + 4    | 6–8 天   | 端到端跑通 Mock 站，Submit 前停止      |
| **M6**   | Application Diff + 内容自适应            | Phase 8 + §31  | 3–5 天   | 结构化 Diff + 字数变体生成             |
| **M7**   | Job Discovery + Job Matcher              | Phase 5 + 6    | 5–7 天   | 岗位抓取 + 三层打分                    |
| **M8**   | 第一个真实 ATS Adapter                   | Phase 7        | 7–10 天  | Moka 或北森，基于 DOM Fixture          |
| **M9**   | Submit + 验证 + Tracker                  | Phase 9 + 10   | 5–7 天   | 真实投递闭环 + CLI Dashboard           |
| **M10**  | Desktop GUI                              | Phase 11       | 10–15 天 | Tauri 桌面端                           |
| **M11**  | Windows 产品化                           | Phase 12       | 4–6 天   | GitHub Actions 出 .exe/.msi            |
| **M12+** | 更多 ATS / 学习机制 / 商业化             | Phase 13–15    | 持续     | —                                      |

**MVP 边界 = M0 → M9**。M10 之前全部用 CLI 驱动，不做 GUI（PRD §51 明确要求）。

估算为单人全职人日，仅供排期参考，不作为承诺。

---

## 4.1 M0 · 项目地基

**目标**：一条命令能跑通 lint + typecheck + test，之后每一轮开发都有质量闸门。

任务：

1. `corepack enable pnpm`，锁定 pnpm 版本到 `packageManager` 字段
2. `git init`，写 `.gitignore`（排除 `.autojob/`、`browser-profile/`、`*.db`、截图、`.env`）
3. 建 pnpm workspace + `tsconfig.base.json`（`strict: true`, `noUncheckedIndexedAccess: true`）
4. ESLint 9 flat config + Prettier，禁用 `any` 逃逸（`@typescript-eslint/no-explicit-any` 为 error）
5. Vitest 配置 + 一个 smoke 测试
6. `packages/core`：`Result<T,E>` 类型、结构化错误码枚举（PRD §71 全量）、日志器（带 Mask，PRD §44）、Run ID 生成
7. `apps/cli`：commander 骨架，`autojob --version` 可运行
8. GitHub Actions：`lint → typecheck → test`
9. 根目录写 `CLAUDE.md`（把 PRD §49/§50/§74/§75 固化成智能体常驻约束）和 `PROGRESS.md`

**验收**：

- `pnpm lint && pnpm typecheck && pnpm test` 全绿
- `pnpm autojob --version` 输出版本号
- 日志器单测证明 `13812341234` 被输出为 `138****1234`

---

## 4.2 M1 · Candidate Profile 数据底座

**目标**：PRD §6–§17 的完整数据模型落地。这是整个项目最关键的一层，宁可慢。

任务：

1. `packages/candidate-profile`：Zod schema
   - `BasicInfo`（§7）、`Education`（§8）
   - `Experience`（§9/§10）：**四维语义标签** `experienceType` / `organizationType` / `employmentRelation` / `semanticTags[]`
   - `canMapTo[]` / `shouldNotMapTo[]`（§9，防串档的核心）
   - `CanonicalFact`（§11）：带 id，供 Generated Content 溯源
   - `Project`（§12，含 `GeneratedVariants`）、`Award`（§13，含 `category`）、`Skill`（§14）、`Links`（§15）
   - `Asset`（§16）、`ResumeVersion`（§17）、`ReferralCode`（§32）、`Question`（§18）
2. `packages/database`：Drizzle schema + 首个迁移，表结构与 Zod schema 一一对应
3. `packages/security`：`SensitiveFieldEncryption` 接口 + 明文 passthrough 实现（真加密留到 M9 之后接 Keychain）；`maskPII()` 工具
4. Import/Export JSON（PRD §52），带 schema 版本号，为未来迁移留口
5. 一份**真实的示例 Profile**（用你自己的经历，放 `fixtures/profile.sample.json`）——后续所有测试都依赖它
6. Profile 查询层：`queryExperiences({ allowTypes, blockTypes })` 等，供 M4 调用

**验收**（PRD §52）：

- 单测覆盖四类映射：Research Project / Internship / Scholarship / Competition Award
- 断言：`experienceType=research_project` 的记录，`shouldNotMapTo` 必须包含 `full_time_work` 和 `internship`
- JSON 导出后重新导入，深度相等
- 敏感字段（idNumber）在 `toLLMSafe()` 输出中不存在

---

## 4.3 M2 · Mock ATS 站点群

**目标**：建立**不依赖任何真实企业网站**的测试地基（PRD §67、§58"不要让测试依赖企业真实网站"）。

任务：建 `tests/fixtures/sites/`，每站一个目录，含静态 HTML + 一份 `expected-schema.json`：

| Mock 站           | 刻意制造的难点                                          |
| ----------------- | ------------------------------------------------------- |
| `mock_company_a`  | 只有"工作经历"一栏，无科研栏 → 逼系统产生 warning       |
| `mock_company_b`  | 科研/项目/实习三栏分开，字段名用"课题经历""研究项目"    |
| `mock_company_c`  | 奖学金与竞赛获奖**分开两栏**                            |
| `mock_company_d`  | 荣誉奖励**合并一栏**                                    |
| `mock_repeatable` | 动态"添加一条"教育/项目，DOM 后插入                     |
| `mock_limits`     | 项目描述 100/300/500 字硬限制 + maxlength               |
| `mock_widgets`    | dropdown / radio / checkbox / autocomplete / 日期选择器 |
| `mock_upload`     | 简历 + 成绩单 + 作品集三个上传位，格式与大小限制不同    |
| `mock_qa`         | 10+ 个校招常见问答（§18）                               |
| `mock_login`      | 模拟需要登录（不做真验证码，只做状态）                  |

外加一个极简静态服务器 `tests/fixtures/serve.ts`（Node 原生 http，零依赖）。

**验收**：`pnpm mock:serve` 启动后所有页面可访问；每个页面有对应的 expected schema 供 M3 做快照测试。

---

## 4.4 M3 · Form Schema + 语义分类器

**目标**：PRD §19、§53。把任意网页字段抽象成统一的 `FormField`。

任务：

1. `packages/form-schema`：`FormField` Zod schema（§19 全字段）+ `SemanticType` 枚举（§19 全量 24 项）
2. **Form Parser**：从 DOM 提取 label / placeholder / name / type / options / section 标题 / 邻近文本 / maxlength / required
   - 难点：label 关联（`for`、包裹、`aria-label`、相邻文本节点）——需要多策略回退
3. **Semantic Classifier 两层**：
   - 第一层 **规则**：关键词表 + 正则（中英双语），命中给高 confidence
   - 第二层 **LLM**：规则失败时才调用。`packages/llm` 提供 `LLMProvider` 接口
   - **数据最小化（PRD §42）**：送给 LLM 的只有 field label / placeholder / options，**绝不含候选人真实数据**。这一点写成单测强制约束
4. **置信度策略（§53）**：`≥0.9` 自动 / `0.7–0.9` 自动但 Diff 标注 / `<0.7` → `WAITING_USER`
5. LLM 响应缓存（按 page signature + field 指纹），避免重复烧钱

**验收**（PRD §53）：

- "科研经历""研究经历""研究项目""课题经历""Research Experience" 全部分类为 `RESEARCH_EXPERIENCE`
- 对 M2 全部 Mock 站跑快照测试，schema 输出与 `expected-schema.json` 一致
- 单测断言：LLM prompt 中不出现示例 Profile 里的任何手机号/姓名/身份证

---

## 4.5 M4 · Mapping Engine + Mapping Memory

**目标**：PRD §20、§21、§54。**这是防止"科研经历进工作经历"的关键层。**

任务：

1. `packages/form-mapper`：规则引擎，优先级严格为
   `Company Rule > ATS Rule > Global Rule > LLM Guess`
2. `MappingRule` 数据结构（§21）+ 持久化到 SQLite
3. 内置 **Global Rule 表**：`SemanticType → allowedCandidateTypes[] / blockedCandidateTypes[]`
   - 例：`WORK_EXPERIENCE` → allow `full_time`；**block** `research_project`、`academic_project`、`campus_activity`
   - 例：`SCHOLARSHIP` → allow `category=scholarship`；block `competition_award`
4. **降级策略**：目标网站没有科研栏时，按规则把科研经历并入项目经历，**并产生 warning**（供 M6 的 Diff 展示）
5. **Mapping Memory**：用户在 `WAITING_USER` 时的确认结果落库，下次同 ATS 复用；询问"以后同类问题是否自动使用该答案"
6. 未命中且 LLM 也低置信 → 返回 `WAITING_USER`，**禁止猜测**（PRD §3.6）

**验收**（PRD §54）：

- 构建 **≥20 种 Mock Schema 变体**，同一 Profile 全部能正确适配
- 红线测试（必须失败才对）：任何情况下 `research_project` 都不得出现在 `WORK_EXPERIENCE` 的映射结果里
- 用户在 mock_b 确认一次"实践经历 = internship + research_project"后，同 ATS 的另一个 mock 站自动复用

---

## 4.6 M5 · 浏览器填写引擎 —— **PRD Phase 0 验收点**

**目标**：跑通 `autojob apply <url>` 全链路，在 Submit 前停止。这是第一个"可演示"的里程碑。

任务：

1. `packages/browser`：Playwright 封装
   - Headful + **Persistent Context**（`~/.autojob/browser-profile/`，PRD §25）
   - `BrowserTask` 状态机（§26 全 14 态），每次状态变化写日志
   - **禁止任何验证码绕过逻辑**（PRD §74）；遇到登录/验证码 → `WAITING_USER`，等用户手动完成
2. `packages/asset-library`（Phase 4）：附件登记、类型自动识别、`AssetSelector`（按岗位/语言/格式/大小选简历与作品集）
3. `packages/question-bank`：语义匹配问答，低置信度 → `WAITING_USER`，答案回写
4. **Form Filler**：按 PRD §33 顺序填写；支持 Repeatable Section 动态"添加一条"
5. **Validation**（§34）：必填/日期/长度/附件类型/手机/邮箱/下拉未选 等 10 类检查
6. `adapters/generic`：GenericAdapter 骨架 + 成功后缓存 selector/page signature（§24）
7. Application 落库 + 截图保存（§73 Run ID，敏感信息 Mask）
8. CLI：`autojob apply <url>`、`autojob profile import/export`、`autojob asset add`

**验收（= PRD §51 原始验收清单，逐条勾选）**：

- [ ] 在 Mock 站正确填写：姓名/邮箱/电话/学校/专业/学历/项目/工作经历/科研经历/奖项/个人主页/附件
- [ ] **科研项目不进入工作经历**
- [ ] **奖学金与竞赛奖项正确分类**
- [ ] GitHub / 个人主页自动填写
- [ ] Resume / Portfolio 上传成功
- [ ] 在 Submit 前**停止**，不点提交
- [ ] Application 记录入库 + 截图落盘
- [ ] Playwright E2E 测试在 CI 中通过

---

## 4.7 M6 · Application Diff + 内容自适应

**目标**：PRD §31、§35、§59。让用户**明确知道系统做了哪些转换**。

任务：

1. `packages/content-adapter`：按字段 maxLength 生成 `short100/short300/short500` 变体
   - **强约束**：生成内容必须能 trace back 到 `canonicalFacts[]`；实现一个校验器，检测生成文本中出现的数字/专有名词是否都在 Canonical Facts 中，否则拒绝（PRD §3.5）
2. Diff 生成器：`Candidate Data → Website Field` 的结构化对照（§35 格式）
3. **任何非直接映射必须 warning**，例如"该网站无科研栏，已将《重载多自由度起竖研究》归入项目经历"
4. CLI 渲染（终端表格 + 颜色），`autojob apply --dry-run` 只出 Diff

**验收**：

- Diff 中每一项都能追溯到 Profile 的具体记录 id
- 内容变体校验器能拦住"编造量化成果"的注入测试用例
- 在 mock_company_a（无科研栏）上运行，warning 正确产生

---

## 4.8 M7 · Job Discovery + Job Matcher

**目标**：PRD §27–§30、Phase 5/6。**本阶段只读不投**（PRD §56 明确要求）。

任务：

1. `packages/job-discovery`：Generic Job Page Parser，提取 Title/Location/Department/JD/JobId/URL
2. `packages/job-matcher` 三层（§29）：
   - Hard Filter：毕业年份 / 学历 / 地点 / 岗位类型 → 不满足直接 Reject
   - Deterministic Score：Skill / Keyword / Role / Location / Experience
   - LLM Semantic Score：输出 `matchScore / matchedSkills / missingSkills / advantages / risks / reason`
3. `JobPreference` 配置（§28），默认值用你的方向：机器人 / 具身智能 / VLA / 强化学习 / 运动规划 / 自动驾驶 / 规控 / 控制算法；排除 销售 / Java / 前端 / 测试
4. `DuplicateDetector`（§30）：`companyId+jobId` 优先，无 jobId 则用 hash
5. CLI：`autojob jobs <url>`、`autojob match <url>`

**验收**：

- 能从**一个**真实招聘网站读出职位列表（只读，不进入申请页）
- 明显不匹配的岗位（如"Java 后端""销售"）被过滤掉
- Top Matches 按分数排序输出

---

## 4.9 M8 · 第一个真实 ATS Adapter

**目标**：PRD §22、§23、Phase 7。**只做一个**（Moka 或北森，二选一，先调研哪个覆盖你的目标企业更多）。

任务：

1. `packages/ats-detector`：按 hostname / 脚本资源 / DOM 特征识别，输出 `atsType + confidence`
2. 统一 `ATSAdapter` 接口（§23 的 14 个方法），业务层不接触任何 DOM
3. 实现选定 ATS 的 Adapter：detect → listJobs → getJobDetail → openApplication → parseForm → fill → uploadAsset → validate → **停在 submit 前**
4. **DOM Fixture 快照测试**（§70）：抓取真实页面 DOM 存为 fixture，测试跑在 fixture 上，**不依赖线上站点**
5. 页面变化恢复（§72）：主 selector 失败 → 备用 selector → Generic AI Recovery → 生成 "Adapter Update Candidate"（人工确认后才进正式规则）

**验收**：

- 全部 Adapter 测试跑在 fixture 上，CI 中无网络依赖
- ATS Detector 对该 ATS 的识别 confidence > 0.9
- 在真实站点上手动验证一次填写（**不提交**）

---

## 4.10 M9 · Submit + 验证 + Application Tracker

**目标**：PRD §36–§39、Phase 9/10。闭环，MVP 完成。

任务：

1. `submit()` **必须**由用户在 Diff 后显式确认（PRD §3.7）；无 Trusted Auto Submit
2. `verifySubmission()`（§60）：Success Text / Success URL / Application ID / 投递列表回查——**不能因为点了按钮就认为成功**
3. `packages/application-tracker`：Company / Job / Application / ApplicationEvent 四表；全状态机（§36 的 14 态）
4. 投递队列（§39）：`QUEUED → AUTO FILL → READY_TO_SUBMIT → USER CONFIRM → SUBMITTED`
5. 防重复投递告警
6. CLI Dashboard：总投递数 / 待投递 / 已投递 / 笔试 / 面试 / Offer / 拒绝 + 表格
7. 手动更新状态：`autojob app update <id> --status INTERVIEW`
8. **接上真加密**：敏感字段接系统 Keychain（Linux Secret Service / Windows Credential Manager）

**验收（= PRD §76 MVP Definition of Done）**：完整跑通 URL → 识别 ATS → 抓岗位 → 匹配 → 选岗 → 填写（科研/工作不混、奖学金/竞赛不混）→ Diff → 确认 → 提交 → 验证 → 入库 → Dashboard 可查。

---

## 4.11 M10–M12+ · GUI / 打包 / 扩展

- **M10 GUI**（Phase 11）：先装 Rust + Tauri 系统依赖。页面按 §62：Dashboard / Profile / Resume Versions / Asset Library / Job Search / Queue / Applications / Question Bank / Referral Codes / Settings。此时把 `apps/worker` 独立出来，Desktop 通过 localhost HTTP/WS 调用（§46、§47）。
- **M11 Windows 打包**（Phase 12）：GitHub Actions Windows runner，打包 Desktop + Worker + Node runtime + Playwright Chromium，产出 `.exe`/`.msi`；用户无需装 Node/Python。
- **M12+**：第二个 ATS（§64，按"ATS 覆盖企业数 × 需求"排序）；Mapping Memory 共享（§65，**只共享字段语义规则，禁止上传候选人信息**）；商业化（§66，上线前必须评估 ToS / 数据合规 / LLM 数据政策）。

---

## 5. 横切约束（每个里程碑都适用）

### 5.1 隐私与安全（PRD §41–§44、§74）

- Profile / 附件 / Cookie 全部本地，默认不上传任何服务器
- 禁止保存明文密码；禁止把 Cookie/Token 发给 LLM
- LLM 只收 **field label 层面的元信息**，不收真实个人数据（M3 有单测强制）
- 日志 Mask：手机号 `138****1234`，身份证、Token、Cookie 一律不落日志
- **禁止实现任何验证码绕过**——遇到就 `WAITING_USER` 交给用户

### 5.2 测试策略（PRD §67–§70）

- 单测必覆盖：CandidateProfile / FormSemanticClassifier / MappingEngine / QuestionMatcher / JobMatcher / DuplicateDetector / AssetSelector / ContentAdapter
- E2E 跑 Mock 站，CI 必须运行
- Adapter 用 DOM 快照测试，**永不依赖线上企业站点**
- **禁止为了让测试通过而删除测试**（PRD §74）

### 5.3 每轮开发工作流（PRD §50、§75）

每一轮必须：① 检查仓库现状 → ② 说明将改哪些文件 → ③ 实现一个小功能 → ④ 跑 lint/typecheck/test → ⑤ 修复失败 → ⑥ 汇总。

每轮结束输出六件套并追加到 `PROGRESS.md`：本轮目标 / 修改文件 / 实现内容 / 测试结果 / 已知限制 / 下一步建议。

**禁止一次生成几十个未运行的文件。**

### 5.4 失败处理（PRD §71）

所有失败返回结构化错误码，不允许 "Something went wrong"：
`LOGIN_REQUIRED` `CAPTCHA_REQUIRED` `UNKNOWN_FIELD` `UPLOAD_FAILED` `VALIDATION_FAILED` `ATS_UNSUPPORTED` `SESSION_EXPIRED` `FORM_CHANGED` `SUBMISSION_FAILED` `DUPLICATE_APPLICATION`

---

## 6. 风险与对策

| 风险                                           | 影响                 | 对策                                                                   |
| ---------------------------------------------- | -------------------- | ---------------------------------------------------------------------- |
| **秋招时间窗口紧**（当前 2026-09，秋招进行中） | MVP 可能赶不上本季   | 见 §7 的"应急路径"：可先跑 M1+M2+M5 的简化版自用                       |
| 真实站点 ToS / 反自动化                        | 账号风险、法律风险   | 默认 headful + 人工确认提交；不做高频批量；商业化前专项法务评估（§66） |
| ATS 页面改版导致 Adapter 失效                  | 填写中断             | 备用 selector + Generic AI Recovery + Adapter Update Candidate（§72）  |
| LLM 分类错误导致经历串档                       | **产品核心失败模式** | 规则优先、置信度阈值、`shouldNotMapTo` 硬阻断、Diff 人工确认——四道闸   |
| LLM 编造内容                                   | 简历失真，后果严重   | Canonical Facts 溯源校验器（M6），生成内容超出事实即拒绝               |
| Playwright 上传/富文本控件兼容性               | 卡在填写环节         | M2 的 Mock 站提前覆盖这些控件，早暴露                                  |
| Tauri 在 Linux 上系统依赖复杂                  | M10 拖期             | GUI 推迟到 M10；前 9 个里程碑纯 CLI，不阻塞                            |
| 范围蔓延                                       | 永远做不完           | 严守 §79 顺序；MVP 明确到 M9 截止                                      |

---

## 7. 应急路径（如果想赶上本季秋招）

完整 MVP（M0–M9）估算 40–60 人日，可能赶不上今年秋招高峰。若需要**尽快自用**，建议裁剪路径：

**M0 → M1 → M2（只做 3 个 Mock 站）→ M3（只做规则层，跳过 LLM）→ M4（只做 Global Rule）→ M5**

约 15–20 人日可得到一个"半自动填表器"：能把你的 Profile 正确填进大多数表单，你自己肉眼核对后提交。之后再回补 LLM 分类、Job Matcher、真实 Adapter。

这条路径的取舍：牺牲未知网站的适应能力（无 LLM 兜底时遇到陌生字段就 `WAITING_USER`），换取上线速度。**建议由你决定走完整路径还是应急路径。**

---

## 8. 下一步（M0 第一轮）

待你确认后执行：

1. `corepack enable pnpm` + `pnpm exec playwright install chromium --with-deps`
2. `git init` + monorepo 骨架 + `tsconfig.base.json` + ESLint/Prettier/Vitest
3. `packages/core`：错误码、Result、Mask 日志器 + 单测
4. `apps/cli`：commander 骨架
5. GitHub Actions CI
6. 写 `CLAUDE.md`（智能体常驻约束）与 `PROGRESS.md`
7. 跑 `pnpm lint && pnpm typecheck && pnpm test`，全绿后汇报

---

## 附录 A · PRD Phase → 本计划里程碑 对照

| PRD Phase    | 名称                      | 里程碑                              |
| ------------ | ------------------------- | ----------------------------------- |
| Phase 0      | 验证核心技术              | **M5**（验收清单原样保留）+ M0 部分 |
| Phase 1      | Candidate Profile Engine  | M1                                  |
| Phase 2      | Form Semantic Engine      | M3                                  |
| Phase 3      | Mapping Engine            | M4                                  |
| Phase 4      | Asset Library             | M5                                  |
| Phase 5      | Job Discovery             | M7                                  |
| Phase 6      | Job Matcher               | M7                                  |
| Phase 7      | 第一个 ATS Adapter        | M8                                  |
| Phase 8      | Application Diff          | M6                                  |
| Phase 9      | Submission                | M9                                  |
| Phase 10     | Application Tracker       | M9                                  |
| Phase 11     | Desktop GUI               | M10                                 |
| Phase 12     | Windows 产品化            | M11                                 |
| Phase 13     | 更多 ATS                  | M12+                                |
| Phase 14     | Learning / Mapping Memory | M12+                                |
| Phase 15     | 商业化                    | M12+                                |
| §67 测试策略 | Mock 站点                 | **M2**（提前，作为独立里程碑）      |

> 与 PRD 的唯一顺序调整：Mock 站点（§67）提前为独立的 M2，Application Diff（Phase 8）提前到 M6。理由：Mock 站是 M3–M5 的测试前提；Diff 是 M5 填写结果的直接消费方，早做能早发现映射问题。
