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

## 4. 对 M8 选型的结论

**建议第一个 ATS Adapter 做飞书招聘。** 理由现在是实测支撑的，不再是推断：

1. **检测成本为零** —— `*.jobs.feishu.cn` 子域名 + 飞书 CDN 脚本来源，两个信号都极明确。
2. **两家企业的技术栈完全相同**，脚本来源一字不差，说明是标准化 SaaS，Adapter 复用率高。
3. **目标企业池中已确认 2 家**（小鹏、德赛西威），且都是本人实际投过的。
4. **通用解析器在它上面失效**，正说明这里才是 Adapter 该发力的地方 ——
   如果通用方案就够用，做专用 Adapter 的边际收益反而低。

M7 探测已完成的验证项：

- [x] 确认两家飞书站的技术栈一致（脚本来源完全相同）
- [x] 确认岗位列表页不强制登录（未检测到登录拦截）
- [x] 确认通用解析器对该 ATS 无效（首屏无职位内容）
- [ ] 抓取真实 DOM fixture —— 需要先弄清岗位数据的加载方式（M8 开始时做）
- [ ] 补充识别 `job.skyverse.cn` 与 `we.zyt.com` 的 ATS 类型

**M8 的第一步应当是：搞清楚飞书招聘的岗位数据从哪来。** 可能的路径包括
观察 XHR 请求找到其内部 API、或找到正确的路由参数。这一步做完，
后面的 Adapter 实现就是水到渠成的事。

## 4. 待补充

样本里还有约 40 家企业没有记录 URL（智元、宇树、地平线、Momenta、理想、蔚来、银河通用、千寻智能、星动纪元等）。这些多为具身智能初创，很可能使用 Moka / 飞书招聘这类 SaaS（初创企业自研 ATS 的动机低）。建议后续投递时**顺手把 URL 记进表格**，样本越大选型越准。
