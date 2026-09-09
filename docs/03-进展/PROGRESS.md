# 开发进展日志

按 PRD §75 要求，每轮开发追加一条记录。最新的在最上面。

---

## 2026-09-09 · M7 Job Discovery + Job Matcher

### 本轮目标

从招聘页抓取岗位列表并按偏好打分排序。**本阶段只读不投**（PRD §56 明确要求）。

### 修改文件

- `packages/job-discovery/src/`：`job` `extract-script` `parser`
- `packages/job-matcher/src/`：`preference` `matcher`
- `apps/cli/src/commands/jobs.ts`：`jobs` 与 `match` 两个命令
- `tests/fixtures/sites/mock_joblist_table/`、`mock_joblist_cards/`
- `tests/e2e/job-discovery.spec.ts`
- `docs/05-调研/ATS初步识别.md`：补入实地探测结果

### 实现内容

**1. 通用列表解析：靠「重复结构」而非固定选择器**

不认识网站时怎么找到职位列表？关键洞察是**职位一定是重复结构**。页面上有导航、页脚、推广链接，但只有职位是「同一种结构重复很多次」。

算法：收集全部链接 → 向上找「重复祖先」→ 按结构签名分组 → 打分取最优组。打分维度刻意保守：宁可漏掉一个奇怪的列表，也不要把导航栏当职位——**漏掉了用户会发现（列表是空的），认错了用户可能不会发现**。

**2. 懒加载处理**

反复点「加载更多」直到按钮消失或链接数不再增长，设 20 次上限防死循环。不处理的话只能拿到首屏几条，用户会以为这家公司只招 3 个人。

**3. 三层匹配，第三层暂不做**

Hard Filter（不满足直接 Reject）→ 确定性打分（技能/方向/岗位/地点）→ LLM 语义打分。

第三层只留了接口没有实现，理由与 M3 一致：先把前两层做扎实，看它能不能把「Java 后端」和「具身智能算法」分开。实测能分开，就不必为架构完整性接 LLM。

**打分必须可解释**：「87 分」本身没意义，用户没法据此决定投不投。有意义的是「命中 VLA、强化学习；标题匹配算法工程师」——所以每个维度都带 reason。

**4. 两个命令严格分离**

`autojob jobs` / `match` 只读；要投递必须显式用 `autojob apply <申请页 URL>`。分成两个命令，就不会出现「本来只想看看，结果投出去了」。

### 测试结果

```
pnpm lint / typecheck ✓
pnpm test             ✓ 21 files / 342 tests
pnpm privacy:check    ✓ 0 处真实个人信息
pnpm test:e2e         ✓ 146 passed / 8 skipped
```

真实 Profile 在表格式 Mock 站上的实测：12 个岗位 → 通过 6，过滤 6（Java/前端/销售/测试 4 个关键词淘汰，2 个博士岗学历淘汰）。排序结果：具身智能 66、VLA 66、运动规划 57、自动驾驶 57、控制算法 57、机械结构 31。

### 本轮修掉的一个真 bug

**表格式列表把 `<td>` 当成了条目**。一行里 6 个 `td` 确实是同签名兄弟，于是算法在第一层就停下了——结果只抓到职位名，部门/地点/学历全丢。

修法：判据加一条「这些兄弟**大多也含链接**」。一行里只有一个 `td` 含职位链接，而 `tr` 的兄弟每个都含链接。加上这条后结构识别从 `tr > td` 变成 `tbody > tr`，元信息全部提取到位。

### 实地探测：ATS 推断已验证，但有个更重要的发现

对 3 家真实站点做了**只读探测**（不登录、不交互、不投递）：

| 企业     | 脚本来源                         | 结论                |
| -------- | -------------------------------- | ------------------- |
| 小鹏汽车 | `lf-package-cn.feishucdn.com` 等 | **飞书招聘 · 确认** |
| 德赛西威 | 与小鹏**完全相同**               | **飞书招聘 · 确认** |
| 宇石空间 | `static-ats.mokahr.com`          | **Moka · 确认**     |

两家飞书站脚本来源一字不差，印证了「一个 Adapter 覆盖多家」的前提。

**但更重要的发现是：通用解析器对这些站无效。** 三个页面首屏正文只有 23–53 字符、5–6 个链接，全是导航项，没有任何职位内容；即便直接访问 `/campus/position` 路由，飞书站依然如此。岗位数据由 SPA 异步加载，需要特定路由参数或交互才渲染。

这恰恰**强化了做 ATS Adapter 的必要性**。PRD §24 把 GenericAdapter 定位为「未知系统的兜底」，实测表明对 SPA 型 ATS 兜底方案不够用。M7 的通用解析器仍有价值（对服务端渲染的传统招聘页有效），但覆盖不了飞书/Moka 这类现代 SPA。

### 已知限制

1. **通用解析器只对有重复链接结构的页面有效**。SPA 型 ATS（飞书、Moka）抓不到，需要专用 Adapter。这是实测结论，不是推测。
2. **只解析列表页，不进入岗位详情页**。因此 JD 正文只有列表上能看到的摘要，Skill 匹配的输入不完整。进详情页会大幅增加请求量，留到有真实需求时再做。
3. **城市识别用固定表**。不在表里的城市（如县级市）识别不出。用固定表是有意的——用「任意两三个字」的模式会把「研究院」「智能中心」误判成地点。
4. **重复投递标记的指纹口径**与 database 包不完全一致（列表页拿不到 companyId），M9 统一 Tracker 时需对齐。
5. **LLM 语义打分层只有接口没有实现**。

### 下一阶段建议

进入 **M8 第一个真实 ATS Adapter**，目标定为**飞书招聘**（依据见上）。第一步不是写 Adapter，而是：

1. **搞清楚飞书招聘的岗位数据从哪来** —— 观察 XHR 找到其内部 API，或找到正确的路由参数
2. 抓真实 DOM fixture 存入 `tests/fixtures/dom/`，让 Adapter 测试**不依赖线上站点**（PRD §58）
3. 实现 `ATSAdapter` 接口的 14 个方法，业务层不接触 DOM
4. ATS Detector：`*.jobs.feishu.cn` + 飞书 CDN 脚本来源双信号

---

## 2026-09-09 · M6 Application Diff + 内容自适应

### 本轮目标

消除 M5 遗留的「超长内容转人工」，并把「系统做了哪些转换」完整摊给用户看（PRD §31 / §35 / §59）。

### 修改文件

- `packages/content-adapter/src/`：`fact-guard` `adapter`
- `packages/application-diff/src/`：`model` `renderer`
- `packages/form-mapper/`：接入 ContentAdapter；新增 `CONTENT_COMPRESSED` warning
- `packages/form-schema/`：新增 `PROJECT_BRIEF` / `PROJECT_ACHIEVEMENT` 语义类型
- `apps/cli/src/commands/apply.ts`：输出 Diff，新增 `--verbose`
- 测试：`fact-guard` `adapter` `diff` 三个新文件，另更新 4 处因行为变更而过时的断言

### 实现内容

**1. 抽取式压缩，不是生成式**

这是本轮最重要的设计决定。抽取式 = 从已有句子里**挑**；生成式 = 让模型**写**。

选抽取式不是为了省钱，而是**结构上不可能编造**：输出的每个字都来自用户亲手写下的 canonical 内容，不存在「模型顺手加了个 99%」的可能。生成式再怎么加校验都是事后拦截，抽取式是从源头堵死。

代价是行文可能不如生成式流畅。这个取舍是明确的：**简历失真的代价远大于行文生硬。**

**2. 打分与装箱**

单元按「量化成果 > 成果 > 职责 > 背景描述」打分，命中岗位关键词加权。按分数装箱，装完后**按原文顺序重排**保证可读性。三条硬约束：

- **绝不截断句子** —— 半截话比信息缺失更糟，它看起来完整实则丢了结论
- **表头逐级降级但名称永远保留** —— 没有名称的经历等于没写
- **连名称都放不下就整条不纳入** —— 任何输出都会误导

**3. Canonical Facts 校验器**

生成文本里的每个数字都必须能在事实库找到出处。抽取式理论上必然通过，但这条防线不能省——将来若接入 LLM 改写，它就是唯一拦得住编造的地方。

**4. Application Diff 回答三个问题**

不是「表单里现在是什么」（看页面就行），而是：内容从档案哪条来？我的经历为什么没出现？系统擅自做了什么判断？前两个靠 `sourceRecordIds` / `excluded` 双向溯源，第三个靠 warning。

### 测试结果

```
pnpm lint / typecheck ✓
pnpm test             ✓ 19 files / 316 tests
pnpm privacy:check    ✓ 0 处真实个人信息
pnpm test:e2e         ✓ 127 passed / 4 skipped
```

C 公司 100 字「项目简介」现在自动压缩填入（M5 时是转人工），实测 97 字。

### 真实运行暴露并修掉的四个问题

1. **压缩成功却被判为阻断级**。`CONTENT_TOO_LONG` 在 M4 定为 blocker 是对的（那时超长=填不了），M6 后必须区分。拆出 `CONTENT_COMPRESSED`（warn）。修复前 Diff 显示「暂不建议提交：2 个阻断问题」，而内容其实已经填好了。
2. **100 字里塞了 3 条记录的名称，没有一句实质内容**。均分预算让每条都饿死。加了「最小有用份额」（60 字）：低于它宁可少放几条。三个名字的信息量不如一条带成果的完整描述。
3. **溯源不实**。Diff 声称内容来自 4 条记录，压缩后实际只填了 1 条。改为记录 `adapted.includedIds`。
4. **「项目简介」与「主要成果」填了几乎一样的内容**。两栏语义本就不同，却都被判成 `PROJECT_EXPERIENCE`。拆出 `PROJECT_BRIEF` / `PROJECT_ACHIEVEMENT`，映射目标仍是 `project_experience`（红线不受影响），区别只在填哪个侧面。

另外还修了成果去重：同一指标的两种措辞（「成功率 90.4%」与「成功率达到 90.4%」）字符串包含判不出来，改为**按量化指标去重**。

### 已知限制

1. **压缩是抽取式的，不改写**。因此在极紧的字数下，输出可能是几个要点的罗列而非流畅段落。接 LLM 改写留到 M12+，且需用户显式开启。
2. **多条记录按结束时间排序**，`present` 视为最新。因此进行中的个人项目会排在已结束的课题之前——符合简历惯例，但未必符合「最有分量的优先」。
3. **岗位关键词只做切分，不做语义扩展**。「VLA 算法工程师」切出的关键词命中不了「具身智能」这类同义表达。
4. **Diff 只有终端渲染**，GUI 版本留到 M10。

### 下一阶段建议

进入 **M7 Job Discovery + Job Matcher**（PRD Phase 5/6）。注意本阶段**只读不投**（PRD §56 明确要求）。

1. Generic Job Page Parser：从招聘主页提取岗位列表
2. 三层匹配：Hard Filter → 确定性打分 → LLM 语义打分（前两层先做，LLM 层视效果再定）
3. `JobPreference` 默认值可直接用真实方向：机器人 / 具身智能 / VLA / 强化学习 / 运动规划 / 自动驾驶 / 规控
4. 顺带验证 `docs/05-调研/ATS初步识别.md` 里的推断——抓 2 家飞书招聘站的 DOM 确认结构是否真的一致，这直接决定 M8 做哪个 Adapter

---

## 2026-09-09 · M5 浏览器填写引擎（PRD Phase 0 验收点）

### 本轮目标

`autojob apply <url>` 真正打开浏览器把表单填出来，**在提交前停住**。这是第一个可演示的里程碑，也是首次使用**真实 Profile** 运行。

### 修改文件

- `materials/profile.local.json`（**已 gitignore**）：真实 Profile
- `packages/browser/src/`：`task-state` `session` `page-scripts` `filler` `validator` `run-artifacts`
- `packages/database/src/`：`schema` `client` `repository`
- `apps/cli/src/commands/`：`profile.ts`（校验 + 脱敏摘要）、`apply.ts`（完整编排）
- `tests/fixtures/sites/mock_login/`：登录拦截站
- `scripts/privacy-check.mjs` + `pnpm privacy:check`（并入 CI）
- 测试：`task-state` `session` `repository` `exit-code` + `tests/e2e/filler.spec.ts`

### 实现内容

**1. 状态机把 WAITING_USER 当一等公民**

14 态转移表显式定义合法转移，非法转移直接抛错。三条关键约束：`LOGIN_REQUIRED` 只能转 `WAITING_USER`（不能自行绕过）；`FILLING` 不能直接跳 `SUBMITTING`（必须过校验）；`SUBMITTING` 不能直接判成功（必须过 `VERIFYING`）。

**2. FormFiller：四类真实难点各有策略**

M2 在 `hard-widgets.spec.ts` 里踩过的坑，这里逐个落地：自定义下拉「点开 → 等渲染 → 点选项」、autocomplete「输入 → 等候选 → 点选」、隐藏 file input 直接 `setInputFiles`、Repeatable 用真实 DOM 顺序而非索引推算。

**每次填写后回读验证** —— 填进去 ≠ 填成功。自定义控件可能只改了显示文本，前端校验可能把值清空。对不上就报失败。

**3. SQLite 落库**

四张表（Company / Job / Application / ApplicationEvent）+ MappingRule 持久化（补上 M4 的内存实现限制）。两条不变量：状态变化必然伴随一条 Event（绑在同一方法里）；同一岗位只能有一条投递记录（唯一索引兜底 + 填表前主动查询）。

**4. Run 产物目录**

每次运行生成 `runs/<runId>/`：4 张全页截图 + `plan.json`（映射溯源与 warning）+ `transitions.json`（状态机历史）。这些文件含真实个人信息，已全部 gitignore。

**5. 隐私审计脚本**

两层检查：从本地真实 Profile 读出姓名/手机/邮箱/微信/雇主名，在全部 git 跟踪文件里精确搜；再用通用模式扫任意手机号与身份证，扣除已登记的虚构值白名单。已并入 `pnpm check` 与 CI。

### 测试结果

```
pnpm lint          ✓
pnpm typecheck     ✓
pnpm test          ✓ 15 files / 245 tests
pnpm privacy:check ✓ 扫描 108 个跟踪文件，未发现真实个人信息
pnpm test:e2e      ✓ 125 passed / 4 skipped（真实 Chromium）
```

**PRD §51 验收清单（用真实 Profile 实跑）**

| 验收项                                | 结果                                       |
| ------------------------------------- | ------------------------------------------ |
| 正确填写姓名/邮箱/电话/学校/专业/学历 | ✓                                          |
| 项目/科研/奖项/个人主页正确落位       | ✓                                          |
| **科研项目不进入工作经历**            | ✓ 工作经历栏实测为空                       |
| **奖学金与竞赛正确分类**              | ✓ 分栏站 3/4 拆开，合并站 8 项全入         |
| GitHub / 个人主页自动填写             | ✓                                          |
| Resume / Portfolio 上传成功           | ✓ 真实 PDF 上传，成绩单缺失如实报缺        |
| **在 Submit 前停止**                  | ✓ 无 `--submit` 参数，命令本身没有提交能力 |
| Application 入库 + 截图落盘           | ✓                                          |
| E2E 在 CI 中通过                      | ✓                                          |

### 本轮抓到的三个真 bug

1. **`__name is not defined`** —— tsx/esbuild 编译时给函数包 `__name(fn, "name")`，该辅助只存在于 Node 侧；脚本序列化进页面后就找不到。**迷惑之处：Playwright 自己的 runner 用另一套转换，E2E 全绿，只有走 tsx 的 CLI 路径才炸。** 修法是注入恒等垫片，并加了断言垫片存在的回归测试。
2. **CLI 退出码被吞** —— `main()` 在 `parseAsync` 后无条件 `return 0`，把子命令设置的 `process.exitCode` 覆盖掉。后果是重复投递返回 0、`doctor` 检查失败也返回 0，脚本里 `autojob doctor && ...` 会误判成功。
3. **autocomplete 白等 3 秒** —— 每个普通文本框都在等一个根本不存在的候选列表。改用 `count()` 秒判列表骨架是否存在做前置判断后，A 公司用例从 **9.4s 降到 0.37s**，整套 E2E 从 17.1s 降到 2.2s。

另外隐私审计上线后立刻抓到两处疏漏：修脱敏 bug 时把真实邮箱写进了代码注释；`.gitignore` 里残留了含真实姓名的目录名。

### 已知限制

1. **没有提交能力，这是有意的**。`apply` 没有也不会有 `--submit`，真正的提交留到 M9 且必须走 Application Diff 确认流程。
2. **Repeatable 填写只做了「添加条目」的能力**，尚未接入 `apply` 主流程 —— 多条经历分别填入多个条目组的编排留到 M8。
3. **自定义控件的触发器定位是启发式的**（找 button / `[role=combobox]` / `.combo-input`）。真实 ATS 结构千奇百怪，M8 的 Adapter 会针对具体站点覆盖。
4. **`--headless` 只应用于测试**。正常使用必须 headful，用户要能看见并随时接管。
5. **better-sqlite3 是原生模块**，本机从源码编译成功。M11 打 Windows 包时需按目标平台重新构建。
6. **超长内容仍然转人工**（C 公司的 100 字项目简介），等 M6 的 ContentAdapter。

### 下一阶段建议

进入 **M6 Application Diff + 内容自适应**。素材已经齐了：

1. `plan.json` 里已有完整的 `sourceRecordIds` 与 `warnings`，Diff 只需渲染，不必重新计算。
2. 优先做 ContentAdapter —— 它能把当前「超长转人工」的字段自动化掉，是 M5 遗留限制里最影响体验的一条。
3. 内容生成必须过 Canonical Facts 校验器：生成文本里出现的数字必须都能在 `canonicalFacts[].metrics` 中找到出处。真实 Profile 里已有 `90.4%` `86.7%` `71.56%` `30.2%` 等量化指标，正好作为测试基准。

---

## 2026-09-09 · M4 Mapping Engine + Mapping Memory

### 本轮目标

把 `semanticType` 接到 Candidate Profile，决定**哪条记录进哪个栏目**，并守住语义红线（PRD §20 / §21 / §54）。

### 修改文件

- `packages/form-mapper/src/`：`mapping-rule` `warnings` `value-renderer` `semantic-bridge` `mapper` `index`
- `packages/form-mapper/tests/`：`mapping-rule.test.ts`（16 例）、`mapper.test.ts`（34 例）
- `tests/e2e/mapping.spec.ts`（19 例，真实浏览器全链路）
- `tsconfig.json` / `vitest.config.ts`：新增 `@autojob/form-mapper` 别名

### 实现内容

**1. 三道闸**

一条记录要进入某个网页字段，必须同时过三关：

1. Profile 自身的 `shouldNotMapTo`（M1 定的，**规则不可解除**）
2. MappingRule 的 `blockedCandidateTypes`（各级规则的**并集**）
3. 字段语义置信度 ≥ 0.7（M3 算的，低了转人工）

任何一关不过就不填，并给出可读原因——原因会进 Application Diff，让用户看到「为什么这条没填」，而不是默默消失。

**2. 四级优先级与一条不可逾越的界线**

`Company > ATS > Global > LLM`。但有两个刻意的非对称设计：

- **放开（allowed）遵循优先级**，只取胜出规则的
- **阻断（blocked）取所有命中规则的并集**——安全约束不该被高优先级规则悄悄抹掉

更重要的是：**MappingRule 不能解除 Experience 自身声明的 `shouldNotMapTo`**。理由是后者是用户在自己档案上做的定性（「我的课题绝不算工作经历」），前者只是某网站字段的局部规律。让网站级配置覆盖用户对自己经历的定性，正是 PRD §74 要防的事。真想改就去改 Experience，那是显式且全局可见的动作。

**3. Mapping Memory**

`store.remember({ scope: 'ats' | 'company', ... })` 把用户的一次确认沉淀成规则。选 `ats` 则同一 ATS 的所有企业复用——投一次，后面同类网站都省事。

**4. warning 分三级**

`info`（可忽略）/ `warn`（看一眼）/ `blocker`（必须处理，不该提交）。12 种 warning 码覆盖降级、合并、超长、缺数据、被阻断、无附件、无内推码、未答问题等。

**5. 各语义类型的取值**

经历/奖项走 Profile 查询层；标量走 BasicInfo 与最高学历；下拉与单选**必须对上网站给的选项**，对不上就转人工不硬填；附件走 AssetSelector；内推码按公司+有效期查；问答走 Question Bank 的变体问法匹配。

### 测试结果

```
pnpm lint       ✓
pnpm typecheck  ✓
pnpm test       ✓ 11 files / 195 tests
pnpm test:e2e   ✓ 102 passed / 2 skipped（真实 Chromium）
```

**PRD §54 验收：20 种 Schema 变体穿透测试**

按「4 个经历栏的 16 种组合 × 4 种奖项栏组合」派生 + 4 种附加变体 = 20 种。在**每一种**变体上断言：

- 红线一：科研课题从不出现在工作经历或实习栏
- 红线二：奖学金不进竞赛栏、竞赛不进奖学金栏
- 每个字段都有明确结论（filled / skipped / ask_user 三者之一，不存在悬空）

**E2E 全链路验收**（页面 DOM → 提取 → 分类 → 映射）：

| 场景                                                 | 结果 |
| ---------------------------------------------------- | ---- |
| A 公司无科研栏 → 产生 M2 就写好的 `expectedWarnings` | ✓    |
| A 公司工作经历栏收到 0 条记录（而非塞入科研）        | ✓    |
| A 公司科研被填进项目经历栏并点名告知                 | ✓    |
| B 公司课题/项目分栏各就各位                          | ✓    |
| B 公司「实践经历」转人工，`sourceRecordIds` 为空     | ✓    |
| C 公司三栏严格拆开（3/4/1 项）                       | ✓    |
| C 公司 100 字限制超长 → 转人工，**value 为空不截断** | ✓    |
| F 公司成绩单缺失 → 明确报缺，不拿别的文件顶替        | ✓    |
| G 公司调剂问题命中变体问法「是否服从职位调剂」       | ✓    |

M2 阶段写下的 `expectedWarnings` 至此兑现，这个字段从声明到消费跨了两个里程碑。

### 已知限制

1. **规则存储是内存实现**。`MappingRuleStore` 接口已定好，M9 接 SQLite 后换持久化版本，调用方不用改。目前 Mapping Memory 重启即失效。
2. **问答匹配是字符串包含，不是语义匹配**。命中「是否服从职位调剂」靠的是 `observedPhrasings` 里预先记了这个说法。真正的语义匹配（同义改写、否定句式）需要 LLM，排在真实站点跑出缺口之后。
3. **超长内容一律转人工**。M6 的 ContentAdapter 落地后，其中大部分应能自动生成压缩变体。当前 C 公司的「项目简介」必然转人工。
4. **`jobTitle` 参数已预留但未使用**。按岗位挑简历版本的逻辑在 M5 填写时才需要。
5. **`value` 是文本草稿**，M5 真正填入时可能还需按控件类型转换（日期格式、多选分隔符）。

### 下一阶段建议

进入 **M5 浏览器填写引擎**——这是 PRD Phase 0 的验收点，也是第一个可演示的里程碑。

1. `packages/browser`：Playwright 封装 + Persistent Context + `BrowserTask` 14 态状态机
2. **FormFiller 的动作实现直接照搬 `tests/e2e/hard-widgets.spec.ts`**——那里每个用例都是一个必须支持的填写动作，M2 时就是为此写的
3. 补 `mock_login` 站，配合 Persistent Profile 验证登录态复用
4. 接 SQLite：Application 记录与截图落盘（PRD §73 Run ID）
5. CLI `autojob apply <url>`，在 Submit 前停止

---

## 2026-09-09 · M3 Form Schema + 语义分类器

### 本轮目标

把任意网页字段抽象成统一的 `FormField`，并判定其语义类型与置信度（PRD §19 / §53）。核心要求：**规则优先，模糊不猜**。

### 修改文件

- `packages/form-schema/src/`：`semantic-type` `raw-field` `label` `rules` `form-field` `classifier` `index`
- `packages/form-schema/tests/classifier.test.ts`（37 个用例）
- `tests/e2e/form-parser.spec.ts`（真实浏览器验收）
- `tests/fixtures/sites/manifest.ts`：改为引用 form-schema 的权威 `SemanticType`，并修正两处早期误标
- `eslint.config.js`：新增浏览器全局限制规则
- `tsconfig.json` / `vitest.config.ts`：新增 `@autojob/form-schema` 别名

### 实现内容

**1. 提取与分类的职责切分**

```
浏览器侧：DOM → RawField[]        （必须真实浏览器，靠 E2E 测）
Node 侧：RawField[] → FormField[]  （纯函数，靠单元测试）
```

`EXTRACT_FIELDS_SCRIPT` 会被序列化送进页面执行，因此**必须自包含**。`RawField` 刻意不做任何判断，只把所有线索（label 的 5 种来源、区块标题、附近提示、选项、限制）收集齐，让 Node 侧有足够信息可用。

**2. label 归因是带出处的多级回退**

`label[for]`(1.0) → 包裹 label(0.98) → `aria-label`(0.95) → 相邻文本(0.88) → placeholder(0.8) → name/id(0.4)

不只给文本，还标明来源与可信度。这个可信度会乘进最终置信度：

```
最终置信度 = 规则置信度 × label 来源可信度
```

两个乘数缺一不可——规则再确定，如果 label 是从 placeholder 猜的，整体就该打折。C 公司的手机号（仅 placeholder）算出 0.96×0.8=0.77，落在「填，但在 Diff 里标出来」区间，正是想要的行为。

**3. 规则表顺序即优先级**

最关键的一组区分：

| 字段名                             | 判定                  | 靠什么区分                     |
| ---------------------------------- | --------------------- | ------------------------------ |
| 课题经历 / 研究经历 / 科研经历     | `RESEARCH_EXPERIENCE` | 规则要求「经历/情况/工作」后缀 |
| **研究项目** / 项目经历 / 项目简介 | `PROJECT_EXPERIENCE`  | 含「项目」二字                 |

「研究项目」字面带「研究」却是项目栏——B 公司专门设的陷阱，靠规则模式的精确设计而非词频统计解决。

**4. 模糊字段明确承认判不了**

「实践经历」置信度压到 **0.55**（<0.7 阈值），强制转 `WAITING_USER`。这条规则的价值不是「判对」，而是「明确承认判不了」。开放式主观题（「请用三句话说明…」）同样压低到 0.5，不由系统代答。

**5. 附件走独立规则表**

同样是「作品集」，`input[type=file]` 是 `PORTFOLIO_ATTACHMENT`，`input[type=url]` 是 `PORTFOLIO`。认不出类型的附件标为 `OTHER` 转人工——不能瞎传文件。

### 测试结果

```
pnpm lint       ✓
pnpm typecheck  ✓
pnpm test       ✓ 9 files / 145 tests
pnpm test:e2e   ✓ 83 passed / 2 skipped（真实 Chromium）
```

**7 个 Mock 站的实测分类覆盖率：**

| 站点           | 字段数 | 自动   | 需标注 | 转人工 | 未识别 |
| -------------- | ------ | ------ | ------ | ------ | ------ |
| mock_company_a | 10     | 8      | 2      | 0      | 0      |
| mock_company_b | 11     | 10     | 0      | 1      | 0      |
| mock_company_c | 9      | 8      | 1      | 0      | 0      |
| mock_widgets   | 7      | 3      | 4      | 0      | 0      |
| mock_upload    | 3      | 0      | 3      | 0      | 0      |
| mock_qa        | 10     | 0      | 9      | 1      | 0      |
| **合计**       | **50** | **29** | **19** | **2**  | **0**  |

**未识别为 0**，转人工的 2 个都是设计使然（「实践经历」与开放题）。**规则层已足以覆盖这批场景，LLM 层暂不需要。**

### 本轮发现并修掉的两个真问题

1. **`<legend>` 被误当作 label**。fieldset 里第一个字段的 `previousElementSibling` 往往是 `<legend>`，导致「可接受的工作地点」被读成「求职意向」、「是否服从职位调剂」被读成「补充问题」，两个字段直接掉进 `OTHER`/置信度 0。修复后加了回归用例。
2. **上传控件的 `<label for>` 是按钮文案**。`<label for="up-resume">选择文件</label>` 完全符合 HTML 规范，但文本是动作词不是字段名。加了动作词黑名单，命中就继续向下回退，并从相邻文本中剔除「未选择文件」这类状态噪声。

这两个都是**只有在真实 DOM 上跑才会暴露**的问题，手工构造 RawField 的单元测试发现不了——这印证了 M2 建 Mock 站的价值。

### 顺带修正的 M2 遗留

- manifest 里 `#q-english`「英语水平」原标为 `QUESTION`，分类器判为 `LANGUAGE_SKILL`。**分类器是对的**：Profile 的 skills 里有语言类技能，可直接取值，不必绕 Question Bank。已改 manifest。
- manifest 曾自己复制一份 `SemanticType` 联合类型，现改为引用 form-schema 的权威定义，消除双份真相。

### 已知限制

1. **LLM 层只有位置，没有实现**。规则未命中时目前直接返回 `OTHER` + 置信度 0（转人工），没有 LLM 兜底。这是有意的——实测未识别率为 0，先不引入。真实站点上跑出识别缺口后再补。
2. **`repeatable` 字段恒为 false**。可重复区块的识别（哪些字段属于同一条目、如何添加新条目）留到 M5，因为它和填写动作强耦合。
3. **规则表是中文优先的**。英文模式只覆盖了常见词，纯英文招聘站（如 Workday）需要扩充。
4. **`nearbyText` 已提取但未使用**。它含「限 100 字」「仅支持 PDF」这类信息，M5 做校验时会用到。
5. 单元测试喂的是手工构造的 `RawField`，**提取脚本本身只有 E2E 覆盖**。这是刻意取舍：给提取脚本做单测需要引 jsdom，而 jsdom 与真实浏览器的差异恰恰是最容易出错的地方。

### 下一阶段建议

进入 **M4 Mapping Engine**。衔接点已经铺好：

1. `SEMANTIC_TO_EXPERIENCE_TARGET` / `SEMANTIC_TO_AWARD_TARGET` 已在 form-schema 里定义，直接把 `semanticType` 接到 M1 的 `queryExperiences()` / `queryAwards()`。
2. 优先实现四级规则优先级（Company > ATS > Global > LLM）与 `MappingRule` 持久化。
3. 用 manifest 的 `expectedWarnings` 做验收——A 公司应产生「无科研栏，已归入项目经历」的 warning，这个字段从 M2 就留好了，M4 该消费它了。
4. PRD §54 要求「至少构建 20 种不同 Mock Schema」，可用现有 7 站的字段组合派生，不必再手写页面。

---

## 2026-09-09 · M2 Mock ATS 站点群

### 本轮目标

建立**不依赖任何真实企业网站**的测试地基（PRD §67 / §58）。核心原则：Mock 站必须真的难——如果它们都是规规矩矩的 `<label for>`，那在上面跑通不代表任何事情。

### 修改文件

- `tests/fixtures/sites/manifest.ts`：站点清单，声明每站的刁难点、字段语义、期望 warning
- `tests/fixtures/serve.ts`：零依赖静态服务器（Node 原生 http，带目录穿越防护）
- `tests/fixtures/sites/assets/style.css`：共用样式
- 7 个 Mock 站的 `apply.html`
- `tests/e2e/mock-sites.spec.ts`、`tests/e2e/hard-widgets.spec.ts`
- `playwright.config.ts`（webServer 自动拉起/回收 Mock 服务器）
- `.github/workflows/ci.yml`：新增 Playwright 安装 + E2E + 失败时上传截图/trace
- `eslint.config.js` / `.prettierignore`：修正忽略范围（原先误把 manifest.ts 排除在 lint 之外）

### 实现内容

**7 个 Mock 站，每个针对一类困难：**

| 站点   | 刁难点                                                                                                                                                    |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A 公司 | **无科研栏** → 科研必须降级进项目经历；奖项**合并**一栏；手机/邮箱用相邻文本节点，无 `label for`                                                          |
| B 公司 | 科研栏叫**「课题经历」**、项目栏叫**「研究项目」**（字面像科研实为项目，最易分错）；**「实践经历」语义模糊**应触发 WAITING_USER；GitHub 只有 `aria-label` |
| C 公司 | 奖学金/竞赛/荣誉**三栏严格分开**；项目简介限 100 字、成果限 300 字；手机号**只有 placeholder**                                                            |
| D 公司 | **全是自定义控件**：div 模拟下拉（选项点开才渲染）、autocomplete（延迟 250ms 出候选）、radio/checkbox、原生 date                                          |
| E 公司 | **Repeatable Section**：三分区初始 0 条，点「添加」才生成带索引字段，**删除后索引不重排**                                                                 |
| F 公司 | 三个上传位限制各不同（简历 PDF≤2MB / 成绩单 PDF+图片≤5MB / 作品集 PDF≤10MB）；`input[type=file]` 被 CSS 隐藏；**前端真的会校验并报错**                    |
| G 公司 | 10 道校招问答，措辞与标准问法不一致；问题用 `<p>` 承载无 `label`；第 10 题是开放题，必然无法自动作答                                                      |

**E2E 的定位**：不是测业务逻辑，而是**保证 Mock 站确实制造了它声称的困难**——防止有人「顺手」把 A 公司的 label 补全或加个科研栏，导致 M3/M4 在上面跑通失去意义。

`hard-widgets.spec.ts` 里的每个操作序列，就是 **M5 的 FormFiller 将来必须实现的动作**。已提前踩过的坑：

- 自定义下拉的选项在点击前 DOM 里根本不存在 → 不能用 `selectOption`
- autocomplete 必须等候选渲染完再点，且输入不足 2 字不出候选
- Repeatable 删除中间条后索引不重排 → **按顺序数第 N 条会拿错元素**
- 隐藏的 file input 必须用 `setInputFiles` 直接操作，不能去点 label

### 测试结果

```
pnpm lint       ✓
pnpm typecheck  ✓
pnpm test       ✓ 8 files / 108 tests
pnpm test:e2e   ✓ 55 passed / 2 skipped（真实 Chromium）
pnpm autojob doctor ✓ 三项全绿（Playwright 已装）
```

2 项 skip 是有意的：上传站全是 file input、Repeatable 站初始无字段，均由各自专项用例覆盖。

### 已知限制

1. **缺 `mock_login` 站**。登录态/验证码场景尚未建，排在 M5 开始前——它需要配合 Persistent Browser Profile 一起验证才有意义。
2. **`expectedWarnings` 字段目前无人消费**。它是给 M4 准备的验收基准，M4 实现后才会被断言。
3. **manifest 的 `semanticType` 尚未被验证**。M3 的分类器实现后，要拿它做快照测试基准——现在只是声明。
4. Mock 站是**手写 HTML**，不是从真实站点抓的。M8 会补真实 DOM fixture，两者互补：Mock 站测边界，真实 fixture 测兼容。

### 下一阶段建议

进入 **M3 Form Schema + 语义分类器**。建议顺序：

1. 先做 **Form Parser**（DOM → FormField），重点是 label 关联的多策略回退：`label[for]` → 包裹关系 → `aria-label` → 相邻文本 → placeholder。A/B/C 三站正好各覆盖一种。
2. 再做**规则层分类器**，用 manifest 的 `semanticType` 做快照断言。目标：B 公司的「课题经历/研究项目」能分对。
3. **「实践经历」必须落在 <0.7 置信度**触发 WAITING_USER——这条要有专门用例，它是「不猜测」原则的试金石。
4. LLM 层可以推迟——先看规则层能覆盖多少，再决定 LLM 的必要性。

---

## 2026-09-09 · M1 Candidate Profile 数据底座

### 本轮目标

建立 PRD §6–§18 的完整数据模型，并把「科研不进工作经历」「奖学金不混竞赛」两条红线做成**代码强制**而非约定。

### 修改文件

- `packages/candidate-profile/src/`：`common` `canonical-fact` `basic-info` `education` `experience` `project` `award` `skill` `links` `asset` `question` `profile` `query` `io` `index`（15 个）
- `packages/candidate-profile/tests/`：`experience-mapping` `award-mapping` `profile`（3 个测试文件）+ `fixtures/profile.sample.json`
- `tsconfig.json`、`vitest.config.ts`：新增 `@autojob/candidate-profile` 路径别名
- `materials/投递记录/秋招.xlsx`：由 `杨恩慧简历/` 归位

### 实现内容

**1. Experience 四维语义标签**（核心）

`experienceType` × `organizationType` × `employmentRelation` × `semanticTags[]`。三个正交维度分别回答「在做什么 / 什么性质的组织 / 和组织什么关系」，避免用单一 type 承载多重语义——这正是招聘网站解析 PDF 出错的根因。

**2. canMapTo / shouldNotMapTo 与默认映射表**

`DEFAULT_EXPERIENCE_MAPPING` 按 experienceType 推导默认策略，可逐条覆盖。制定原则：**只有 full_time / internship / entrepreneurial 这类真实雇佣或经营关系才允许进受雇栏目，其余全部硬阻断 `full_time_work` 与 `internship`。**

`canMapExperienceTo()` 先查阻断再查允许；两者都未命中时按 PRD §3.6 拒绝（不猜测）。

**3. Award 分类与合并/拆分**

所有 category 都能进 `combined_honors`（网站只有一个「荣誉奖励」栏时合并），但 `scholarship` 与 `competition_award` 互相硬阻断。`sortAwardsByWeight()` 按级别+时间排序，网站限制条数时自动取最有分量的。

**4. 查询层是红线的唯一执行点**

`queryExperiences()` / `queryAwards()` 返回 `{ matched, rejected }`，rejected 带原因，直接喂给 M6 的 Application Diff 回答「为什么没填这条」。`findDowngradedExperiences()` 识别「网站没有科研栏 → 科研并入项目」的降级，供生成 warning。

**5. LLM 数据最小化**（PRD §42）

`toLLMSafeProfile()` 剔除手机号/邮箱/身份证/微信/生日/住址、内推码、问答库，保留经历与技能等职业信息。测试用序列化后字符串断言敏感值不存在，而非只检查字段名。

**6. 其余模块的设计要点**

- `Education`：区分 `minor`（辅修）与 `secondMajor`（双学位）；ranking/rankingTotal 存原始值，百分比现算，避免口径丢失
- `Project.GeneratedVariant`：每个变体必须带 `sourceFactIds`（至少一条），schema 层校验引用的 fact 真实存在——这是「LLM 不得编造」的结构性保障
- `Asset.selectAsset()`：硬条件（类型/格式/大小）不满足直接排除并给出原因，无合格候选时返回 undefined，**不做降级凑合**
- `pickVariantForLimit()`：全部超限时返回 undefined 交给重新生成，**不做截断**（截断会把句子切一半）
- `Question.confidenceAction()`：实现 PRD §53 的三档置信度策略

**7. 示例 Profile**

`tests/fixtures/profile.sample.json`：2 段经历（水下双臂 VLA 课题 / 双臂分拣实习）、8 项奖项（3 奖学金 + 4 竞赛 + 1 荣誉）、2 段教育（含双学位）、5 项技能。**手机号/邮箱/身份证/雇主名已脱敏**，竞赛描述取自 `materials/素材/填写秋招.docx`。

### 测试结果

```
pnpm lint       ✓
pnpm typecheck  ✓
pnpm test       ✓ 8 files / 108 tests passed
```

关键验收（PRD §52）：

| 场景                                             | 结果                                  |
| ------------------------------------------------ | ------------------------------------- |
| 网站有科研栏 → 课题进科研栏、实习进实习栏        | ✓                                     |
| 网站无科研栏 → 课题降级进项目经历 + 产生 warning | ✓                                     |
| 任何情况下课题都不进工作经历/实习                | ✓ 穷举 8 种非雇佣 type × 2 个受雇栏目 |
| 奖项合并栏 → 收到全部 8 项                       | ✓                                     |
| 奖学金栏 → 只收 3 项奖学金                       | ✓                                     |
| 竞赛栏 → 只收 4 项竞赛                           | ✓                                     |
| 限填 3 项 → 自动取国家级                         | ✓                                     |
| LLM 安全副本不含手机号/邮箱/身份证               | ✓                                     |

### 已知限制

1. **SQLite / Drizzle 尚未接入**。当前 Profile 只有 JSON 导入导出，落库排在 M2 之后（M5 需要写 Application 记录时必须完成）。
2. **敏感字段仍是明文**。`SensitiveFieldEncryption` 接口尚未建立，真加密接系统 Keychain 排在 M9。
3. **`profile.sample.json` 是脱敏样本**，真实 Profile 需另建在 `materials/` 下（gitignore），M2 之前需要你确认真实值的存放方式。
4. `Project.generatedVariants` 只有数据结构，生成逻辑在 M6。
5. 跨包引用仍依赖 tsconfig `paths`（M0 遗留），M11 打包前需改为构建产物引用。

### 下一阶段建议

进入 **M2 Mock ATS 站点群**。优先做能直接检验 M1 红线的三个站：

1. `mock_company_a`——只有「工作经历」栏，无科研栏 → 验证降级 + warning
2. `mock_company_c`——奖学金与竞赛**分开两栏** → 验证拆分
3. `mock_company_d`——只有「荣誉奖励」一栏 → 验证合并

这三个做完，M1 的红线就有了页面级验证，再补 repeatable / 字数限制 / 上传等难点站。

---

## 2026-09-08 · M0 项目地基

### 本轮目标

建立 monorepo 骨架与质量闸门，让后续每一轮开发都有 lint / typecheck / test 三道关卡；整理项目目录，把个人隐私资料与可公开代码分离。

### 修改文件

**目录整理**

- `docs/01-需求/AutoJob_PRD_v1.0.md`（由根目录移入）
- `docs/02-计划/AutoJob_PLAN_v1.0.md`（由根目录移入）
- `materials/`（新建，已 gitignore）：简历 / 作品集 / 证书{奖学金,竞赛,荣誉} / 论文 / 专利 / 素材，共 17 个文件由 `杨恩慧简历/` 分类迁入

**工程配置**

- `package.json`、`pnpm-workspace.yaml`、`tsconfig.base.json`、`tsconfig.json`
- `eslint.config.js`、`.prettierrc.json`、`.prettierignore`、`vitest.config.ts`
- `.gitignore`、`.github/workflows/ci.yml`
- `CLAUDE.md`、`README.md`、`docs/03-进展/PROGRESS.md`

**代码**

- `packages/core/src/{result,errors,mask,logger,run-id,index}.ts`
- `packages/core/tests/{result 相关的 errors,mask,logger,run-id}.test.ts`
- `apps/cli/src/index.ts`、`apps/cli/src/commands/doctor.ts`、`apps/cli/tests/doctor.test.ts`

### 实现内容

1. **pnpm workspace monorepo**，TypeScript `strict` 全开，额外启用 `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes` / `verbatimModuleSyntax`。
2. **`@autojob/core`**：
   - `Result<T,E>` —— 让可预期的失败进入类型签名，而不是靠 try/catch。
   - `ErrorCode` —— PRD §71 全部 10 个错误码，外加 5 个内部错误码；`isUserActionable()` 区分「需用户介入」与「系统自处理」，这决定 UI 是暂停等人还是自己重试。
   - `mask.ts` —— PII 脱敏双防线：`maskText()` 扫自由文本（手机号 → `138****1234`、身份证整体屏蔽、邮箱保留首字母与域名、Bearer/Cookie/token 屏蔽），`redactValue()` 按 key 名递归屏蔽结构化数据，处理循环引用。**脱敏顺序上先屏蔽身份证再处理手机号**，否则 18 位身份证里的连续 11 位会被误判成手机号。
   - `logger.ts` —— 所有输出强制过脱敏；支持 runId 串联一次投递全过程、child scope、可注入 sink 供测试。
   - `run-id.ts` —— `run_20260908T231530_a1b2c3`，时间前缀保证目录按时间排序。
3. **ESLint 自定义规则**：禁止业务代码直接使用 `console.*`，强制走 logger 的脱敏通道；`no-explicit-any` 设为 error。
4. **`autojob` CLI**：`doctor` 环境自检（操作系统 / Node 版本 / Playwright 浏览器，未通过时给出修复命令）；未实现的子命令（profile/asset/apply/jobs/match/app）显式抛出结构化错误并标注计划交付的里程碑，不做假装可用的桩。
5. **CI**：GitHub Actions 跑 lint → typecheck → test。

### 测试结果

```
pnpm lint       ✓ 0 errors 0 warnings
pnpm typecheck  ✓ 通过
pnpm test       ✓ 5 files / 41 tests passed (273ms)
```

CLI 实跑验证：

```
$ pnpm autojob --version   → 0.0.1
$ pnpm autojob doctor      → 检出 Playwright 未安装并给出修复命令
$ pnpm autojob apply       → CONFIG_INVALID + 提示「计划在 M5 交付」
```

### 已知限制

1. **跨包引用依赖 tsconfig `paths`**，目前只在 tsx / vitest / tsc 下有效。M11 打包时需要改成真正的构建产物引用（`tsc -b` + 正确的 `exports`），否则打包会失败。已记入 M11 任务。
2. **Playwright 浏览器尚未安装**（`doctor` 会提示）。M5 开始前需执行 `pnpm exec playwright install chromium --with-deps`。
3. **`materials/素材/秋招.xlsx` 尚未归位**：该文件当时被 WPS 占用（PID 9749）无法移动，仍留在 `杨恩慧简历/` 下。
4. `packages/security` 的真加密尚未实现，M1 只提供接口与明文 passthrough，接系统 Keychain 排在 M9。
5. 尚无 E2E 测试（无 Mock 站点，排在 M2）。

### 下一阶段建议

进入 **M1 Candidate Profile 数据底座**，优先级：

1. 先落 `Experience` 的四维语义标签（`experienceType` / `organizationType` / `employmentRelation` / `semanticTags[]`）与 `canMapTo` / `shouldNotMapTo`，这是防止「科研经历进工作经历」的地基。
2. 用真实经历建 `fixtures/profile.sample.json`（水下双臂 VLA 课题 = research_project、联想 Nero = internship、3 类奖项分开），但**敏感字段用占位符**，真实值放 `materials/` 外的本地配置。
3. `materials/素材/填写秋招.docx` 里每个竞赛的项目背景 + 个人负责内容，直接作为 `Award.description` 与 `canonicalFacts[]` 的输入。

另外：`秋招.xlsx` 中已发现可直接用于 M8 选型的 ATS 线索，见 `docs/05-调研/ATS初步识别.md`。
