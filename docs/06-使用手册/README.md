# AutoJob 使用手册

面向**实际使用**的说明。想了解设计取舍看 `docs/01-需求` 与 `docs/03-进展`。

---

## 1. 它能做什么，不能做什么

**能做：**

- 维护一份结构化的个人档案（经历、项目、奖项、技能、附件、常见问答）
- 打开企业招聘页，抓取岗位列表，按你的方向打分排序
- 打开申请页，把档案**正确映射**到表单并自动填写
- 提交前展示完整 Diff：内容从哪来、为什么某条没填、系统做了哪些转换
- 记录每次投递与状态变化，形成投递看板

**不能做（都是有意的）：**

- **不会自动绕过验证码**。遇到就暂停，把浏览器交给你。
- **不会未经确认就提交**。默认只填不交；即使加了 `--allow-submit`，仍会在终端再问你一次。
- **不会编造内容**。字数超限时用抽取式压缩（只挑你写过的句子），绝不改写或新增。
- **不做全网岗位搜索**。只抓你给的企业招聘页。

---

## 2. 两种用法

### 命令行（功能完整）

```bash
# 环境自检
pnpm autojob doctor

# 校验档案（输出全程脱敏）
pnpm autojob profile check materials/profile.local.json

# 抓岗位并按你的方向排序（只读，不会投递）
pnpm autojob match "https://企业招聘页" --profile materials/profile.local.json

# 填写申请表 —— 默认只填不交，填完展示 Diff
pnpm autojob apply "https://岗位申请页" --profile materials/profile.local.json \
  --company "某公司" --job "具身智能算法工程师"

# 投递看板
pnpm autojob app list
pnpm autojob app update <记录ID> --status INTERVIEW
pnpm autojob app timeline <记录ID>
```

### 图形界面

```bash
pnpm desktop:dev     # 开发模式
pnpm desktop:build   # 打安装包
```

界面提供投递看板、岗位匹配、档案查看、附件库、设置五个页面。

**界面里刻意没有「一键投递」按钮。** 填表要开真实浏览器、可能要扫码登录、
提交前要人核对 Diff —— 这个过程本来就该在终端里一步步走。塞进图形界面
只会让人以为「点一下就投出去了」。**界面负责决策（投哪个），终端负责执行（怎么投）。**

---

## 3. 首次配置

1. **准备档案**：把你的真实档案放在 `materials/profile.local.json`
   （该目录已被 gitignore，不会进版本库）。
   图形界面默认读 `~/.autojob/profile.json`，可在「设置」里改。

2. **安装浏览器内核**（首次）：

   ```bash
   pnpm exec playwright install chromium
   ```

3. **验证**：`pnpm autojob doctor` 三项全绿即可开始。

---

## 4. 一次典型的投递

```bash
# 1. 先看这家公司有什么合适的岗位（只读）
pnpm autojob match "https://apply.careers.dji.com/campus-recruitment/dji/143359" \
  --profile materials/profile.local.json --company "大疆"

# 2. 挑中一个，打开它的申请页填表（不会提交）
pnpm autojob apply "<上一步输出的岗位 URL>" \
  --profile materials/profile.local.json --company "大疆" --job "端到端决策规划算法工程师"

# 3. 浏览器会停在填好的表单上。核对 Diff 中的转换说明，
#    确认无误后由你自己点提交按钮。

# 4. 在看板里更新状态
pnpm autojob app update <记录ID> --status SUBMITTED
```

遇到需要登录的站点，程序会暂停并提示你在浏览器里扫码。
登录态保存在 `~/.autojob/browser-profile/`，**下次不用重复登录**。

---

## 5. 数据都在哪

| 内容                  | 位置                          | 进 git 吗 |
| --------------------- | ----------------------------- | --------- |
| 个人档案、简历、证书  | `materials/`                  | ❌ 已排除 |
| 投递记录数据库        | `~/.autojob/autojob.db`       | ❌        |
| 浏览器登录态          | `~/.autojob/browser-profile/` | ❌        |
| 每次运行的截图与 Diff | `~/.autojob/runs/<runId>/`    | ❌        |

**全部留在本机，不会上传到任何服务器。**

换机器时记得单独备份 `materials/` 与 `~/.autojob/` —— 它们不在 git 里，
git 救不了它们。

提交代码前跑一次 `pnpm privacy:check`：它会从你的真实档案里读出姓名、
手机号、邮箱、雇主名，在所有 git 跟踪文件里搜一遍。

---

## 6. 关于大模型

**当前版本不使用任何大模型**，一次 API 调用都没有。三个本该用 LLM 的地方
都用了确定性方案：

| 环节           | 做法                   | 为什么                                |
| -------------- | ---------------------- | ------------------------------------- |
| 字段语义识别   | 规则表 + 置信度        | 实测 50 个字段未识别率为 0            |
| 内容按字数压缩 | 抽取式（只挑已有句子） | 结构上不可能编造                      |
| 岗位匹配打分   | 硬过滤 + 确定性打分    | 实测能区分「Java 后端」与「具身智能」 |

好处：不花钱、不联网、档案数据从不离开本机、结果确定可复现。

接口（`SemanticScorer`、`LLMProvider`）都已留好。真遇到规则认不出的字段时
再接，且生成内容必须通过 Canonical Facts 校验 —— 文本里每个数字都得在
事实库中找到出处。

---

## 7. 已知限制

1. **通用解析器只对有重复链接结构的页面有效。** 飞书招聘的岗位列表需要
   登录才能看，当前抓不到；Moka 站已验证可用（大疆 30 个岗位全部正确解析）。
2. **只解析岗位列表页，不进详情页**，因此 JD 只有列表上的摘要。
3. **自动提交仅 Moka 实现了验证逻辑**，其余站点需你手动点提交。
4. **Playwright 的 Chromium 不打进安装包**（约 150MB），首次运行时下载。
   这是对「所有依赖必须打包」的一处有意偏离，换取安装包体积可接受。
5. **可重复区块（多段经历分别填入多个条目组）尚未接入主流程。**

---

## 8. 出问题时

- `pnpm autojob doctor` —— 环境自检
- `~/.autojob/runs/<runId>/` —— 每次运行的截图、映射计划、状态机历史
- 日志中的手机号、邮箱已自动脱敏，可以安全地贴出来求助
