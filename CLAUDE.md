# AutoJob 开发约束

本文件是开发智能体（Claude Code / Codex）在本仓库工作时的**常驻约束**，来源于 `docs/01-需求/AutoJob_PRD_v1.0.md` 的 §49 / §50 / §74 / §75。每轮开发前先读这里。

---

## 一、绝对禁止（PRD §74）

违反以下任意一条即为严重错误，不接受任何理由：

1. **禁止自动绕过验证码**。遇到验证码只能进入 `WAITING_USER`，交给用户手动完成。
2. **禁止保存明文密码**。
3. **禁止把 Cookie / Token / 身份证 / 手机号发给 LLM**（PRD §42 数据最小化）。
4. **禁止把候选人数据上传到任何外部服务**（PRD §41 local-first）。
5. **禁止在未经用户确认的情况下执行不可逆的批量投递**（PRD §3.7）。
6. **禁止修改 Candidate Profile 的 Canonical Facts**。LLM 只能压缩 / 改写 / 排序，不能新增事实。
7. **禁止把科研经历当作工作经历**，禁止把奖学金和竞赛奖项混为一类。
8. **禁止生成用户不存在的技能、经历、奖项、量化成果**（PRD §3.5）。
9. **禁止为了让测试通过而删除或跳过失败的测试**。
10. **禁止跳过 TypeScript 类型检查**（不许 `any`、不许 `@ts-ignore` 逃逸）。

## 二、隐私红线

- 个人资料一律放 `materials/`，该目录已被 `.gitignore` 排除，**永远不要提交**。
- **测试代码中禁止出现真实手机号 / 身份证 / 邮箱**，一律用虚构数据（见 `packages/core/tests/mask.test.ts` 的写法）。
- 所有日志必须走 `@autojob/core` 的 `createLogger`，它自带 PII 脱敏。ESLint 已禁止业务代码直接调 `console.*`。
- 送给 LLM 的内容只能是**字段标签层面的元信息**（label / placeholder / options），不含任何真实个人数据。

## 三、每轮开发工作流（PRD §50）

严格按六步走，**禁止一次生成几十个未经运行的文件**：

1. 检查当前仓库状态
2. 说明准备修改哪些文件
3. 实现**一个**小功能
4. 运行 `pnpm check`（lint + typecheck + test）
5. 修复失败
6. 总结本轮完成内容

## 四、每轮交付必须输出（PRD §75）

追加到 `docs/03-进展/PROGRESS.md`：

- 本轮目标
- 修改文件
- 实现内容
- 测试结果
- 已知限制
- 下一阶段建议

## 五、代码规范（PRD §49）

- **禁止出现 5000 行的 main.ts**，必须模块化。
- 每个模块四件套：Interface / Implementation / Unit Test / Documentation。
- 所有失败必须落在 `ErrorCode` 上（`packages/core/src/errors.ts`），**禁止输出 "Something went wrong"**（PRD §71）。
- 优先用 `Result<T, E>` 表达可预期的失败，`throw` 留给真正的异常。
- 置信度策略（PRD §53）：`>= 0.9` 自动 / `0.7–0.9` 自动但在 Diff 中标注 / `< 0.7` 进入 `WAITING_USER`，**低置信度绝不猜测**（PRD §3.6）。

## 六、常用命令

```bash
pnpm check          # lint + typecheck + test，提交前必跑
pnpm lint           # ESLint
pnpm typecheck      # tsc --noEmit
pnpm test           # Vitest
pnpm privacy:check  # 隐私审计：真实个人信息不得进 git
pnpm test:e2e       # Playwright E2E（Mock 站点）
pnpm mock:serve     # 手动启动 Mock 招聘站
pnpm autojob doctor # 环境自检
```

## 七、当前进度

见 `docs/02-计划/AutoJob_PLAN_v1.0.md` 的里程碑表与 `docs/03-进展/PROGRESS.md`。

**当前所处阶段：M6 已完成，下一步 M7（Job Discovery + Job Matcher，只读不投）。**

在当前里程碑的验收标准全部满足之前，不要开始下一个里程碑（PRD §80 结尾）。
