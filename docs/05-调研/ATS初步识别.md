# ATS 初步识别（基于真实投递记录）

数据来源：本人 `秋招.xlsx` 投递记录中带 URL 的 13 家企业。

**方法说明**：本文结论**仅基于 URL 域名与路径特征推断**，尚未做 DOM 校验。真正的 `atsType` 判定需要在 M8 抓取页面结构后确认（PRD §22 要求综合 hostname / 脚本资源 / 页面结构三者）。因此下表的「置信度」是**推断置信度**，不是系统输出的 confidence。

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

## 2. 关键发现

### 2.1 飞书招聘出现两次，且路径完全一致

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

## 3. 对 M8 选型的建议

**建议把飞书招聘作为第一个 ATS Adapter 的候选，与 Moka 并列评估**，理由：

1. 检测成本近乎为零（子域名模式）。
2. 目标企业池中已确认 2 家，且都是本人实际要投的（小鹏、德赛西威）。
3. 路径统一，说明是标准化 SaaS，页面结构大概率一致，Adapter 复用率高。

**但需要先验证**（M7 阶段顺带做，只读不投）：

- [ ] 抓取两家飞书招聘页的 DOM，确认表单结构是否真的一致
- [ ] 确认是否需要登录才能看到申请表单（影响 fixture 采集成本）
- [ ] 对比 Moka（宇石空间）的表单复杂度
- [ ] 补充识别 `job.skyverse.cn` 与 `we.zyt.com` 的 ATS 类型

**在完成上述验证之前，不锁定 M8 的 Adapter 选型。**

## 4. 待补充

样本里还有约 40 家企业没有记录 URL（智元、宇树、地平线、Momenta、理想、蔚来、银河通用、千寻智能、星动纪元等）。这些多为具身智能初创，很可能使用 Moka / 飞书招聘这类 SaaS（初创企业自研 ATS 的动机低）。建议后续投递时**顺手把 URL 记进表格**，样本越大选型越准。
