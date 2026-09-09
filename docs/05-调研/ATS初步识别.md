# ATS 识别（基于真实投递记录 + 实地探测）

数据来源：本人 `秋招.xlsx` 投递记录中带 URL 的 13 家企业。

**方法说明**：下表的初始判断基于 URL 域名与路径特征推断；**M7 阶段已对其中 3 家做了只读实地探测**（不登录、不交互、不投递），结论见第 2 节。未探测的仍是推断，标注为「推断」。

> 隐私说明：原始 URL 中的内推码 / share_token / referral token 已剥离，仅保留可公开的路径特征。真实链接留在 `materials/` 中，不入仓库。

---

## 1. 识别结果

| 企业     | URL 特征                                                  | 推断 ATS          | 推断置信度 | 依据                                         |
| -------- | --------------------------------------------------------- | ----------------- | ---------- | -------------------------------------------- |
| 宇石空间 | `app.mokahr.com/campus-recruitment/{tenant}/{id}`         | **Moka**          | 高         | 官方 SaaS 域名，路径含租户名，多租户特征明确 |
| 小鹏汽车 | `xiaopeng.jobs.feishu.cn/campus/position/application`     | **飞书招聘**      | 高         | `*.jobs.feishu.cn` 子域名模式                |
| 德赛西威 | `yesv-desaysv.jobs.feishu.cn/campus/position/application` | **飞书招聘**      | 高         | 同上，路径完全一致                           |
| 拓斯达   | `ehr.tsd.ren/RedseaPlatform/zhaopin/...`                  | **红海云 RedSea** | 中高       | 路径含 `RedseaPlatform` 特征串               |
| 海康威视 | `campushr.hikvision.com/myDelivery`                       | 自研              | 中         | 自有域名，无第三方特征                       |
| 快手     | `campus.kuaishou.cn/recruit/campus/e/#/...`               | 自研              | 中         | 自有域名 + hash 路由                         |
| 字节跳动 | `jobs.bytedance.com/referral/campus/pc/position/...`      | 自研              | 中         | 自有招聘平台                                 |
| 蚂蚁集团 | `talent.antgroup.com/personal/campus-application`         | 自研              | 中         | 自有                                         |
| 海尔集团 | `maker.haier.net/client/campus/deliverfirst/...`          | 自研              | 中         | 自有                                         |
| 美的集团 | `careers.midea.com/schoolOut/apply`                       | 自研              | 中         | 自有                                         |
| 百度     | `talent.baidu.com/jobs/center`                            | 自研              | 中         | 自有                                         |
| 中科飞测 | `job.skyverse.cn/req/campus-list?...`                     | 未知              | 低         | 需抓页面判断                                 |
| 卓驭     | `we.zyt.com/personal/deliveryRecord`                      | 未知              | 低         | 需抓页面判断                                 |

## 1.5 扩充样本后的分布（新表格，22 个带 URL 的企业）

| ATS          | 企业数  | 企业                                                        |
| ------------ | ------- | ----------------------------------------------------------- |
| **飞书招聘** | **5**   | 小鹏、德赛西威、**智元**、**Sharpa Robotics**、**原力灵机** |
| **Moka**     | **3–4** | **大疆**、银河通用、宇石空间（滴滴疑似）                    |
| **北森**     | **3**   | **vivo**、**普渡机器人**、卓驭                              |
| 红海云       | 1       | 拓斯达                                                      |
| 自研 / 未知  | 9       | 京东、海康、快手、字节、蚂蚁、海尔、美的、百度、中科飞测    |

两个新发现：

1. **飞书招聘在具身智能初创里占比很高** —— 智元、Sharpa、原力灵机都用它，
   而这正是本人的核心目标赛道。
2. **Moka 与北森都支持自有域名**。大疆用 `apply.careers.dji.com`（脚本来自
   `static-ats.mokahr.com`），vivo 用 `hr-campus.vivo.com`、普渡用 `pudutech1.zhiye.com`
   （脚本都来自 `acdn.bstatics.com`，即北森 CDN）。
   **因此 hostname 不足以判定 ATS，必须结合脚本来源与路径特征。**
   `/personal/deliveryRecord` 这个路径是北森的强特征，vivo / 卓驭 / 普渡三家一致。

## 2. 实地探测结果（M7，2026-09-09）

对 3 家做了只读探测：只打开页面、读取脚本来源与可见文本，不登录、不点击、不投递。

| 企业     | 脚本来源                                                                      | 结论                  |
| -------- | ----------------------------------------------------------------------------- | --------------------- |
| 小鹏汽车 | `lf-package-cn.feishucdn.com`、`lf3-cdn-tos.bytescm.com`、`verify.snssdk.com` | **飞书招聘 · 已确认** |
| 德赛西威 | `lf-package-cn.feishucdn.com`、`lf3-cdn-tos.bytescm.com`、`verify.snssdk.com` | **飞书招聘 · 已确认** |
| 宇石空间 | `static-ats.mokahr.com`                                                       | **Moka · 已确认**     |

两家飞书站的**脚本来源完全一致**，这印证了「一个 Adapter 覆盖多家企业」的前提。

### 2.0 一个更重要的发现：通用解析器对这些站无效

三个页面的首屏正文都只有 **23–53 个字符、5–6 个链接**，全是导航项，**没有任何职位内容**。
即便直接访问 `/campus/position` 路由，飞书站依然只有导航链接（42–52 字）。

这意味着：

- 岗位数据由 SPA 异步加载，且需要特定的路由参数或交互才会渲染
- **M7 做的通用列表解析器在这类站点上抓不到岗位** —— 它依赖页面上存在重复的链接结构
- 好消息是页面不强制登录（未检测到登录拦截），所以障碍是技术性的而非权限性的

**这恰恰强化了做 ATS Adapter 的必要性。** PRD §24 把 GenericAdapter 定位为「未知系统的兜底」，
而实测表明：对 SPA 型 ATS，兜底方案不够用，必须有针对性的 Adapter 知道「点哪里、等什么、或直接调它的内部接口」。

M7 的通用解析器仍然有价值 —— 它对服务端渲染的传统招聘页（仍占相当比例）有效，
且实测在两种不同结构的 Mock 站上都能正确工作。但它不能覆盖飞书/Moka 这类现代 SPA。

## 3. 原始推断（URL 特征）

### 3.1 飞书招聘出现两次，且路径完全一致

`xiaopeng.jobs.feishu.cn` 与 `yesv-desaysv.jobs.feishu.cn` 的申请页路径都是 `/campus/position/application`。这意味着：

- **检测极其廉价**：只需匹配 `*.jobs.feishu.cn` 即可判定，不需要分析页面结构。
- **一个 Adapter 覆盖 N 家企业**，完全符合 PRD §3.2「同一个 ATS Adapter 应尽可能服务多个企业」。
- 飞书招聘在互联网 / 新能源车企中渗透率较高，样本里 2/13 只是下限。

### 2.2 自研 ATS 占比高（7/13）

大厂普遍自研。这印证了 PRD §24 的判断：**GenericAdapter 不是兜底选项，而是主力**。如果只做 Moka + 北森，样本里能覆盖的企业只有 1 家。

### 2.3 PRD 假设需要修正

PRD §58 建议第一个 Adapter 做「Moka 或北森」，§64 列的优先级是 Moka / 北森 / Workday / SuccessFactors。但从这份真实样本看：

- **北森、Workday、SuccessFactors 在样本中一次都没出现**（Workday / SuccessFactors 主要在外企，与本人目标企业池不重合）。
- **飞书招聘未被 PRD 提及，但样本占比与 Moka 持平甚至更高**。

## 4. 对 M8 选型的结论（M7 末更新）

**建议第一个 ATS Adapter 做 Moka**，而不是此前设想的飞书招聘。判断依据在 M7 末发生了反转：

| 维度                 | Moka                                     | 飞书招聘                         |
| -------------------- | ---------------------------------------- | -------------------------------- |
| 企业数（本人样本）   | 3–4                                      | 5                                |
| 岗位列表是否需要登录 | **不需要**                               | **需要**（页面只有「登录」二字） |
| 通用解析器能否直接用 | **能** —— 实测大疆 30 个岗位全部正确解析 | 不能                             |
| DOM fixture 采集成本 | 低（公开可见）                           | 高（需先扫码登录）               |
| CI 中能否离线测试    | 能（已保存 fixture）                     | 需先解决登录态                   |

**决定性事实：M7 的通用解析器经过四轮修复后，已能在真实 Moka 站上跑通** ——
大疆校招 30 个岗位全部正确解析，编号是真实 UUID、地点正确、匹配排序合理。
这意味着 Moka 的 Adapter 不必从零做，只需在通用解析之上补 ATS 特有的部分
（登录态、申请页表单结构、提交与验证）。

而飞书招聘的职位列表**必须登录才能看**（智元站首屏正文只有「登录」两个字），
这在 M8 阶段（要建 fixture、要 CI 无网络依赖）是实打实的障碍。

**修正后的顺序：Moka（M8）→ 飞书招聘（M12+）→ 北森（M12+）。**
飞书虽然企业数最多，但把它放在有了登录态复用机制之后再做，成本会低得多。

已完成的验证项：

- [x] 确认飞书两家站的技术栈一致（脚本来源完全相同）
- [x] 确认 Moka 与北森都支持自有域名，hostname 不足以判定 ATS
- [x] 确认飞书职位列表需要登录
- [x] 确认通用解析器能处理 Moka（实测 30 个岗位）
- [x] 已保存大疆的渲染后 DOM fixture（`materials/dom-fixtures/`，未入 git）
- [ ] 补充识别 `job.skyverse.cn` 的 ATS 类型

## 4. 待补充

样本里还有约 40 家企业没有记录 URL（智元、宇树、地平线、Momenta、理想、蔚来、银河通用、千寻智能、星动纪元等）。这些多为具身智能初创，很可能使用 Moka / 飞书招聘这类 SaaS（初创企业自研 ATS 的动机低）。建议后续投递时**顺手把 URL 记进表格**，样本越大选型越准。
