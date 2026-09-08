# AutoJob 秋招智能投递助手

## 产品需求文档 PRD + 技术架构 + 分阶段实施方案

版本：v1.0  
产品代号：AutoJob  
目标平台：Windows 为主要用户端，Linux 作为主要开发环境，后续兼容 macOS  
产品形态：Local-first 桌面应用  
核心用户：参加校园招聘、秋招、春招，需要频繁在不同企业官网填写简历和投递岗位的求职者

---

# 1. 项目背景

校园招聘过程中，不同企业通常要求候选人在各自招聘官网重新创建在线简历。

虽然很多招聘系统提供“上传 PDF 自动解析简历”，但实际使用中存在大量错误：

- 将科研经历错误识别为工作经历；
- 将课题组项目识别为实习；
- 将奖学金、竞赛奖项、荣誉称号混在一起；
- 将项目经历和工作经历混淆；
- 日期解析错误；
- 项目名称、项目职责、个人贡献被错误拆分；
- 不同企业对同一个信息使用完全不同的字段名称；
- 某些企业要求个人主页；
- 某些企业要求 GitHub；
- 某些企业要求作品集；
- 某些企业要求成绩单、论文、证书；
- 某些企业要求填写内推码；
- 某些企业存在大量额外问答；
- 不同招聘系统对字段长度、日期格式、附件格式要求不同；
- 用户无法清楚记住自己已经投递过哪些企业和岗位。

因此，本项目不应被设计成简单的：

“PDF 简历自动填写机器人”。

而应该设计成：

> 一个面向异构企业招聘系统 ATS 的候选人信息语义映射、岗位筛选、自动填写和投递管理平台。

---

# 2. 产品核心目标

用户只维护一次自己的完整 Candidate Profile。

之后用户输入企业招聘官网 URL，AutoJob 应能够：

1. 打开招聘网站；
2. 判断招聘网站类型；
3. 识别其使用的 ATS；
4. 获取企业当前开放岗位；
5. 根据用户偏好筛选岗位；
6. 计算岗位和候选人的匹配程度；
7. 防止重复投递；
8. 用户选择岗位；
9. 自动进入申请页面；
10. 解析该招聘网站要求填写的全部字段；
11. 将 Candidate Profile 正确映射到招聘网站；
12. 正确区分科研、实习、项目、工作经历等不同语义；
13. 自动选择对应附件；
14. 自动填写个人主页、GitHub、作品集等信息；
15. 自动填写内推码；
16. 自动处理绝大多数重复招聘问题；
17. 对不确定字段暂停询问用户；
18. 将用户答案保存；
19. 自动校验整个表单；
20. 在最终提交前展示完整 Diff；
21. 默认由用户确认最终投递；
22. 检测是否提交成功；
23. 自动记录此次投递；
24. 后续持续维护投递状态；
25. 形成完整的秋招投递 Dashboard。

---

# 3. 产品核心原则

## 3.1 Candidate Profile 是唯一事实来源

招聘网站的 PDF 解析结果不能作为事实来源。

系统内部维护结构化 Candidate Profile。

PDF 简历只是：

- 一个附件；
- 一个输出版本；
- 一个展示材料。

真正的个人信息存储于本地结构化数据库。

## 3.2 不针对每家公司编写脚本

错误架构：

企业 A → ScriptA  
企业 B → ScriptB  
企业 C → ScriptC

正确架构：

企业招聘网址  
→ ATS Detector  
→ ATS Adapter

例如：

- MokaAdapter
- BeisenAdapter
- WorkdayAdapter
- SuccessFactorsAdapter
- GenericAdapter

同一个 ATS Adapter 应尽可能服务多个企业。

## 3.3 Known ATS 使用确定性程序

已经适配的网站优先使用：

Playwright + Adapter

而不是每次调用 AI。

## 3.4 Unknown ATS 才使用 AI

未知页面：

AI 页面理解  
→ Schema 提取  
→ Mapping  
→ Playwright 执行

AI 应作为页面理解和恢复能力，而不是整个系统唯一执行引擎。

## 3.5 AI 不能创造用户不存在的经历

Candidate Profile 中的事实称为 Canonical Facts。

LLM 可以：

- 压缩；
- 改写；
- 排序；
- 针对岗位重新组织；
- 控制字数；
- 调整表达重点。

LLM 不得：

- 编造技能；
- 编造经历；
- 编造工作时间；
- 编造奖项；
- 编造量化成果；
- 编造证书。

## 3.6 低置信度情况下不得猜测

例如网站字段“社会实践”，系统无法确定到底指：

- 实习；
- 社团；
- 科研；
- 项目。

此时进入 WAITING_USER，不能自行猜测。

## 3.7 默认不完全无人值守投递

系统可以自动打开网页、自动选择岗位、自动填写、自动上传、自动校验，但默认在 Submit 之前暂停。

用户确认后才提交。

后续可增加 Trusted Auto Submit，仅允许用户明确授权的网站和场景自动提交。

---

# 4. 目标用户流程

用户首次创建 Candidate Profile

↓

设置岗位偏好

↓

输入企业招聘网址

↓

AutoJob 打开企业招聘网站

↓

检查登录状态

↓

如需登录：WAITING_USER

↓

用户扫码 / 验证码 / 手机验证码

↓

登录成功并保存 Browser Session

↓

ATS Detector

↓

职位获取

↓

岗位筛选

↓

Job Matching

↓

展示岗位列表和 Match Score

↓

用户选择岗位

↓

检查是否重复投递

↓

进入 Apply 页面

↓

ATS Adapter / Generic Agent 解析字段

↓

Field Mapping Engine

↓

Candidate Profile 映射

↓

Question Bank 匹配

↓

Asset Selector

↓

Form Filling

↓

Validation

↓

Application Diff

↓

用户确认

↓

Submit

↓

Submission Verification

↓

Application 数据库记录

↓

Dashboard

---

# 5. 总体系统架构

系统逻辑：

Desktop UI

↓

Application Orchestrator

↓

五个核心系统：

1. Candidate Profile Engine
2. Job Discovery & Matching Engine
3. ATS Understanding Engine
4. Form Mapping & Filling Engine
5. Application Tracking Engine

推荐架构：

```text
apps/
  desktop/
  worker/

packages/
  core/
  candidate-profile/
  resume-schema/
  asset-library/
  job-discovery/
  job-matcher/
  browser/
  ats-detector/
  form-schema/
  form-mapper/
  content-adapter/
  question-bank/
  application-tracker/
  database/
  llm/
  security/
  adapters/
    moka/
    beisen/
    workday/
    successfactors/
    generic/
```

---

# 6. Candidate Profile

Candidate Profile 是整个系统最重要的数据结构。

不要仅按照传统简历结构设计。

它应该表达：“候选人完整事实”。

---

# 7. BasicInfo

至少包含：

- name
- gender
- birthday
- phone
- email
- location
- hometown
- nationality
- politicalStatus
- idNumber
- wechat
- expectedGraduationDate
- availableDate

其中 idNumber 等敏感信息应该单独加密，并且默认禁止发送给 LLM。

---

# 8. Education

Education[]：

- institution
- college
- degree
- degreeType
- major
- minor
- startDate
- endDate
- graduationDate
- gpa
- gpaScale
- ranking
- rankingTotal
- coursework[]
- advisor
- lab
- description

---

# 9. Experience 不能使用单一 type

一个 Experience 应同时具有多种语义标签。

例如：

- experienceType
- organizationType
- employmentRelation
- semanticTags[]

experienceType：

- full_time
- internship
- research
- research_project
- engineering_project
- competition_project
- academic_project
- personal_project
- campus_activity
- volunteer
- entrepreneurial

organizationType：

- company
- university
- university_lab
- institute
- student_organization
- open_source
- personal

employmentRelation：

- employee
- intern
- research_assistant
- student
- contractor
- volunteer
- none

例如：

西安交通大学某课题组研究项目：

```text
experienceType = research_project
organizationType = university_lab
employmentRelation = student
```

canMapTo：

- research_experience
- project_experience

shouldNotMapTo：

- full_time_work
- internship

这样才能避免招聘网站错误解析。

---

# 10. Experience 基础字段

Experience：

- id
- name
- organization
- role
- startDate
- endDate
- location
- experienceType
- organizationType
- employmentRelation
- semanticTags[]
- descriptionCanonical
- responsibilities[]
- achievements[]
- technologies[]
- keywords[]
- links[]
- attachments[]

---

# 11. Canonical Facts

每段经历必须保存 canonicalFacts[]。

例如：

- 使用 ROS2；
- 开发双臂机器人系统；
- 使用 π0.5；
- 真机采集 200 条轨迹；
- 成功率从 A 提升至 B。

Generated Content 必须只能来自 Canonical Facts。

---

# 12. Project

Project 建议单独抽象。

字段：

- id
- name
- role
- organization
- startDate
- endDate
- descriptionCanonical
- canonicalFacts[]
- responsibilities[]
- achievements[]
- techStack[]
- keywords[]
- links[]
- attachments[]

同时支持 GeneratedVariants：

- short100
- short300
- short500
- roboticsVersion
- vlaVersion
- controlVersion
- autonomousDrivingVersion

---

# 13. Awards

绝对不要将所有奖项存成一个数组。

Award：

- name
- category
- level
- issuer
- date
- rank
- description
- certificateAsset

category：

- scholarship
- competition_award
- academic_award
- honor
- research_award
- sports_award
- other

例如：

国家奖学金：
category = scholarship

机器人竞赛一等奖：
category = competition_award

网站只有“荣誉奖励”时可以合并。

网站分别要求“奖学金”和“竞赛获奖”时则正确拆开。

---

# 14. Skills

Skill：

- name
- category
- level
- years
- evidence[]
- keywords[]

category：

- programming
- robotics
- machine_learning
- control
- simulation
- tool
- language
- hardware
- other

---

# 15. Links / Personal Homepage

Links：

- github
- personalHomepage
- portfolio
- linkedin
- googleScholar
- zhihu
- blog
- researchGate
- other[]

网站字段可能包括：

- 个人主页
- GitHub
- 作品链接
- Portfolio
- 博客

系统根据 semanticType 自动匹配。

---

# 16. Asset Library

需要建立独立附件管理系统。

Asset：

- id
- name
- type
- path
- language
- tags[]
- mimeType
- fileSize
- updatedAt
- version

Asset Type：

- resume
- portfolio
- transcript
- paper
- patent
- certificate
- award_certificate
- student_id
- publication
- cover_letter
- photo
- other

支持多个版本。

例如：

```text
resume/
  中文机器人算法.pdf
  中文具身智能.pdf
  自动驾驶规控.pdf
  英文简历.pdf

portfolio/
  Robotics_Portfolio.pdf
  Research_Portfolio.pdf
```

Asset Selector 根据岗位、企业、字段要求、语言、文件大小、文件格式选择附件。

---

# 17. Resume Version

系统必须支持多个简历版本。

ResumeVersion：

- id
- name
- targetRoles[]
- assetId
- contentPreference
- createdAt
- updatedAt

例如：

- 机器人算法版
- 具身智能版
- 自动驾驶版
- 控制算法版
- 通用算法版

Application 必须保存 resumeVersionId。

---

# 18. Question Bank

校园招聘大量问题重复出现。

例如：

- 是否接受岗位调剂？
- 是否接受工作地点调剂？
- 期望城市？
- 期望薪资？
- 是否接受加班？
- 最快到岗时间？
- 是否签署竞业协议？
- 是否有亲属在本公司？
- 英语等级？
- 是否接受出差？

Question：

- id
- canonicalQuestion
- semanticType
- answer
- answerType
- allowedContexts[]
- confidence

网站问题“是否服从职位调剂？”

↓

Semantic Matcher

↓

canonical：“是否接受岗位调剂”

↓

自动回答。

低于 confidence threshold：WAITING_USER。

用户回答后询问：“以后遇到类似问题是否自动使用该答案？”

---

# 19. ATS Field Schema

每一个网页字段统一抽象成 FormField。

字段：

- id
- label
- name
- type
- required
- options[]
- selector
- semanticType
- confidence
- section
- repeatable
- maxLength
- minLength
- format

semanticType 示例：

- PERSON_NAME
- PHONE
- EMAIL
- UNIVERSITY
- COLLEGE
- DEGREE
- MAJOR
- GPA
- GRADUATION_DATE
- WORK_EXPERIENCE
- INTERNSHIP
- RESEARCH_EXPERIENCE
- PROJECT_EXPERIENCE
- SCHOLARSHIP
- COMPETITION_AWARD
- AWARD
- GITHUB
- PERSONAL_HOMEPAGE
- PORTFOLIO
- RESUME_ATTACHMENT
- TRANSCRIPT_ATTACHMENT
- REFERRAL_CODE
- EXPECTED_LOCATION
- EXPECTED_SALARY
- OTHER

---

# 20. Field Mapping Engine

职责：

FormField

↓

理解 semanticType

↓

Candidate Profile Query

↓

得到 Candidate Data

↓

转换为网站格式

↓

填写。

例如：

网站“科研经历”

↓

RESEARCH_EXPERIENCE

↓

Experience where experienceType = research / research_project

网站“项目经历”

↓

PROJECT_EXPERIENCE

↓

engineering_project / academic_project / research_project / competition_project

根据 Mapping Rule 决定。

---

# 21. Mapping Memory

必须记录用户以前确认过的字段映射规则。

MappingRule：

- atsType
- companyId optional
- fieldLabel
- semanticType
- allowedCandidateTypes[]
- blockedCandidateTypes[]
- createdBy
- confidence

Rule 优先级：

Company Rule

> ATS Rule  
> Global Rule  
> AI Guess

例如：

某 ATS 的“实践经历”，用户确认 internship + research_project 可以进入。

系统保存 ATS-level Mapping，以后其他使用相同 ATS 的企业可以复用。

---

# 22. ATS Detector

输入：

- URL
- 页面 DOM
- 页面 hostname
- 脚本资源
- 页面结构

输出：

- atsType
- confidence
- version optional

优先判断：

- Moka
- Beisen
- Workday
- SuccessFactors
- 企业自研
- Unknown

---

# 23. ATS Adapter Interface

所有 ATS Adapter 必须实现统一接口。

建议：

- detect()
- getCompany()
- listJobs()
- getJobDetail()
- getApplicationStatus()
- openApplication()
- parseForm()
- fillField()
- addRepeatableSection()
- uploadAsset()
- validate()
- submit()
- verifySubmission()

不要让业务层知道具体网站 DOM。

---

# 24. Generic Adapter

未知招聘系统使用 GenericAdapter。

流程：

DOM Snapshot

↓

LLM / Browser Agent

↓

识别：

- 职位列表
- Apply Button
- Form Fields
- Required Fields
- Repeatable Sections
- Upload Fields

↓

生成 Form Schema

↓

Form Mapping Engine

↓

Playwright 执行。

如果 GenericAdapter 成功，记录：

- selector
- field labels
- page signature
- workflow

下次访问同类页面可直接复用缓存。

---

# 25. Browser Automation

底层统一使用 Playwright。

浏览器应：

- Headful
- Persistent Profile

每个用户维护 AutoJob Browser Profile。

保存：

- cookies
- localStorage
- sessionStorage

第一次用户自行：

- 扫码
- 登录
- 短信验证码
- CAPTCHA

成功后复用登录状态。

禁止自动绕过 CAPTCHA。

---

# 26. Browser 状态机

BrowserTask：

- INIT
- OPENING
- LOGIN_REQUIRED
- WAITING_USER
- ATS_DETECTED
- JOB_LIST_READY
- FORM_LOADING
- FORM_PARSING
- FILLING
- VALIDATING
- READY_TO_SUBMIT
- SUBMITTING
- VERIFYING
- SUCCESS
- FAILED

所有状态变化都记录日志。

---

# 27. 岗位获取 Job Discovery

第一版只抓用户输入企业 URL 对应公司的岗位。

不要一开始做全网爬虫。

Job：

- company
- jobId
- title
- department
- location
- jobType
- graduateYear
- degreeRequirement
- description
- requirements
- url
- publishedAt
- source
- atsType

---

# 28. 用户求职偏好

JobPreference：

- keywordsInclude[]
- keywordsExclude[]
- preferredCities[]
- excludedCities[]
- targetRoles[]
- preferredIndustries[]
- degree
- graduationYear
- salaryPreference
- companyBlacklist[]
- companyWhitelist[]

例如 Include：

- 机器人
- 具身智能
- VLA
- 强化学习
- 运动规划
- 自动驾驶
- 规控
- 控制算法

Exclude：

- 销售
- Java
- 前端
- 测试

---

# 29. Job Matching

不要完全使用 LLM。

采用三层结构。

第一层：Hard Filter

- 毕业年份
- 学历
- 工作年限
- 地点
- 岗位类型

不满足硬条件直接 Reject。

第二层：Deterministic Score

- Skill Match
- Keyword Match
- Role Match
- Location Match
- Experience Match

第三层：LLM Semantic Matching

输入：

- JD
- Candidate Summary

输出：

- matchScore
- matchedSkills[]
- missingSkills[]
- advantages[]
- risks[]
- reason

最终分数 0-100。

---

# 30. Job Duplicate Detection

优先使用：

companyId + jobId

作为唯一标识。

如果没有 Job ID，使用 hash：

company + title + location + department + description

如果已经投递，必须警告用户。

---

# 31. 内容自适应 Content Adaptation

招聘网站经常存在：

- 项目描述限制 100 字
- 项目描述限制 300 字
- 工作职责
- 主要成果
- 个人贡献
- 项目简介

Candidate Profile 保存完整 Canonical Content。

根据字段要求生成 Generated Variant。

Generated Variant 必须 trace back 到 Canonical Facts。

可以针对岗位强化表达，但不得添加不存在事实。

---

# 32. Referral Code

单独维护。

ReferralCode：

- companyId
- code
- source
- note
- validFrom
- expireAt

发现 REFERRAL_CODE Field：

↓

查询公司对应 Referral Code

↓

存在则填写，不存在则跳过或提醒。

---

# 33. Form Filling

填写顺序建议：

Basic Info

↓

Education

↓

Work / Internship

↓

Research

↓

Project

↓

Awards

↓

Skills

↓

Question Bank

↓

Links

↓

Assets

↓

Referral Code

↓

Legal / Agreement Fields

Repeatable Section 必须能够动态：

- Add Experience
- Add Project
- Add Education

---

# 34. Form Validation

填写完成后不能直接 Submit。

必须进行 Validation。

检查：

- Required Field Missing
- Invalid Date
- Field Length
- Incorrect Attachment Type
- Invalid Phone
- Invalid Email
- Unsupported Characters
- Dropdown Not Selected
- Radio Not Selected
- Repeatable Section Error

---

# 35. Application Diff

这是核心 UI。

自动填写完成后展示：

```text
企业：
岗位：

基本信息：
✓ 姓名
✓ 手机号
✓ 邮箱

教育：
✓ 西安交通大学

工作经历：
✓ XX 实习
⚠ 未将课题组项目加入工作经历

科研经历：
✓ 重载多自由度起竖研究

项目：
✓ Nero 双臂 VLA

荣誉：
✓ 国家奖学金
✓ XX 机器人比赛一等奖

附件：
✓ 机器人算法简历
✓ Robotics Portfolio

个人主页：
✓ GitHub

内推码：
✓ ABC123

Warnings：
招聘网站没有独立科研栏目。
已将 X 归入项目经历。
```

用户点击 Confirm & Submit。

---

# 36. Application Tracking

Application：

- id
- companyId
- companyName
- jobId
- jobTitle
- jobUrl
- atsType
- resumeVersionId
- referralCode
- createdAt
- submittedAt
- status
- confirmationText
- screenshotPath
- notes

Application Status：

- DISCOVERED
- MATCHED
- SAVED
- QUEUED
- FILLING
- WAITING_USER
- READY_TO_SUBMIT
- SUBMITTED
- OA
- INTERVIEW
- OFFER
- REJECTED
- WITHDRAWN
- FAILED

---

# 37. Application Event

所有状态改变记录 ApplicationEvent。

字段：

- applicationId
- eventType
- oldStatus
- newStatus
- timestamp
- source
- notes

以后可以实现投递时间线。

---

# 38. Dashboard

主界面至少提供：

- 我的资料
- 岗位发现
- 投递队列
- 投递记录
- 进度追踪
- 附件库
- 内推码
- 设置

Dashboard：

- 总投递数
- 待投递
- 已投递
- 笔试
- 面试
- Offer
- 拒绝

表格：

- 公司
- 岗位
- 匹配度
- 简历版本
- 投递日期
- 当前状态

---

# 39. 投递队列

允许多个岗位加入 Queue。

Queue 不等于立即自动提交。

状态：

QUEUED

↓

AUTO FILL

↓

READY TO SUBMIT

↓

USER CONFIRM

↓

SUBMITTED

---

# 40. 邮件进度追踪：后续阶段

后续可以接入：

- Gmail
- Outlook

识别：

- 笔试邀请
- 面试邀请
- 感谢信
- 拒信
- Offer

自动更新 Application Status。

第一版不需要做。

---

# 41. 隐私安全

本产品未来商业化，因此从第一天必须 local-first。

默认：

Candidate Profile → 本地数据库

Attachments → 本地

Browser Cookies → 本地 Browser Profile

Passwords → 禁止保存明文

个人数据默认不得上传开发者服务器。

---

# 42. LLM 数据最小化

LLM 不应该直接读取：

- 身份证号
- 手机号
- 详细地址
- 账号密码
- Cookie

例如网页显示“手机号”。

发送 LLM：

Field label = 手机号

LLM 输出：

semanticType = PHONE

本地程序读取 CandidateProfile.phone 并用 Playwright 填写。

真实手机号不需要进入 LLM Prompt。

---

# 43. 数据库加密

至少预留 SensitiveFieldEncryption。

敏感字段：

- idNumber
- phone
- address
- potentially email

可以后续使用系统 Keychain：

- Windows Credential Manager
- macOS Keychain
- Linux Secret Service

---

# 44. 日志隐私

禁止日志记录：

- 完整手机号
- 身份证
- Cookie
- Token
- 密码

应该 Mask：

138****1234

---

# 45. 技术栈

推荐：

Desktop UI：

- Tauri 2
- React
- TypeScript

Local Worker：

- TypeScript
- Node.js / Bun

Browser：

- Playwright

Database：

- SQLite

ORM：

- Drizzle ORM

Validation：

- Zod

LLM Abstraction：

- LLMProvider

支持：

- OpenAI
- Anthropic
- Gemini
- Local Model

---

# 46. 为什么需要 Worker

Playwright、Browser Agent、ATS Adapter 主要运行在 JS/TS 环境。

因此建议：

Tauri Desktop

↓

Local Worker

↓

Playwright

不要将整个自动化系统写进前端。

---

# 47. Worker 接口

Desktop 与 Worker 使用：

- localhost IPC
- stdin/stdout RPC
- Tauri Sidecar

建议前期简单使用 Local HTTP / WebSocket，后期再优化。

---

# 48. Repository

建议：

```text
autojob/
  apps/
    desktop/
    worker/

  packages/
    core/
    candidate-profile/
    resume-schema/
    asset-library/
    question-bank/
    job-discovery/
    job-matcher/
    ats-detector/
    browser/
    form-schema/
    form-mapper/
    content-adapter/
    application-tracker/
    database/
    llm/
    security/
    adapters/
      moka/
      beisen/
      workday/
      successfactors/
      generic/

  tests/
    fixtures/
    e2e/

  docs/
```

---

# 49. 开发原则

禁止出现一个 main.ts 5000 行。

必须模块化。

每个模块：

- Interface
- Implementation
- Unit Test
- Documentation

---

# 50. Agent 开发规范

Claude Code / Codex 在每个开发阶段必须：

第一步：检查当前仓库。  
第二步：说明准备修改哪些文件。  
第三步：实现一个小功能。  
第四步：运行 lint、typecheck、tests。  
第五步：修复失败。  
第六步：总结本轮完成内容。

禁止一次生成几十个未经运行的文件。

---

# 51. PHASE 0：验证核心技术

目标：

不要做 GUI。

先证明：

“一个 URL → 自动解析 → 填写”。

建立 CLI：

```bash
autojob apply <url>
```

Phase 0 功能：

1. 初始化 TypeScript 项目；
2. Playwright；
3. Persistent Browser Profile；
4. ResumeProfile Demo JSON；
5. SQLite；
6. 打开 URL；
7. 获取 DOM；
8. 提取 input/select/textarea；
9. 建立 FormField；
10. 手工 semantic mapping；
11. 自动填写基本信息；
12. 最终提交前停止；
13. 保存 Application；
14. 保存 Screenshot。

验收：

至少能够在自建 Mock 招聘页面正确填写：

- 姓名
- 邮箱
- 电话
- 学校
- 专业
- 学历
- 项目
- 工作经历
- 科研经历
- 奖项
- 个人主页
- 附件

并且：

- 科研项目不能进入工作经历；
- 奖学金和竞赛奖项正确分类。

---

# 52. PHASE 1：Candidate Profile Engine

目标：

建立稳定的数据底座。

完成：

- CandidateProfile Schema
- Education
- Experience
- Project
- Award
- Skill
- Link
- Asset
- ResumeVersion
- ReferralCode
- QuestionBank

使用 Zod Schema。

完成 Import / Export JSON。

建立测试：

- Research Project Mapping
- Internship Mapping
- Scholarship Mapping
- Competition Award Mapping

验收：

同一个 Candidate Profile 能根据不同字段结构生成不同输出。

---

# 53. PHASE 2：Form Semantic Engine

完成 FormField Schema。

Form Parser 读取：

- label
- placeholder
- name
- type
- options
- section title
- nearby text

Semantic Classifier：

优先规则。

↓

规则无法判断：

LLM。

输出：

- semanticType
- confidence

置信度策略：

> = 0.9：自动  
> 0.7 - 0.9：允许自动，但 Diff 提示  
> < 0.7：WAITING_USER

验收：

Mock 页面使用不同名称：

- 科研经历
- 研究经历
- 研究项目
- 课题经历

都能正确理解。

---

# 54. PHASE 3：Mapping Engine

实现：

- Global Mapping Rule
- ATS Mapping Rule
- Company Mapping Rule
- Mapping Memory

Rule Engine 优先级：

Company

↓

ATS

↓

Global

↓

LLM

实现：

- CanMapTo
- ShouldNotMapTo

这是防止科研经历进入工作经历的关键。

验收：

至少构建 20 种不同 Mock Schema。

同一 Candidate Profile 自动适配。

---

# 55. PHASE 4：Asset Library

实现附件管理。

用户可添加：

- Resume
- Portfolio
- Transcript
- Paper
- Certificate

自动识别文件类型。

字段“个人作品集” → Portfolio。

“成绩单” → Transcript。

“个人简历” → ResumeVersion。

无法确定时 Ask User。

验收：

不同岗位能够选择不同简历。

---

# 56. PHASE 5：Job Discovery

输入招聘主页 URL。

实现职位列表识别。

提取：

- Title
- Location
- Department
- JD
- Job ID
- URL

先做 Generic Job Page Parser。

再做 ATS Adapter。

验收：

能从一个真实招聘网站读取职位列表。

注意：这个阶段不要投递。

---

# 57. PHASE 6：Job Matcher

建立 JobPreference。

实现：

- Hard Filter
- Keyword Score
- Skill Score
- LLM Semantic Score

UI / CLI 输出 Top Matches。

例如：

94 机器人算法  
91 具身智能  
87 运动规划

验收：

明显不匹配岗位必须能被过滤。

---

# 58. PHASE 7：第一个 ATS Adapter

第一优先：

Moka 或北森。

不要同时做两个。

步骤：

1. ATS Detection；
2. Job List；
3. Job Detail；
4. Apply Page；
5. Form Parse；
6. Repeatable Form；
7. Asset Upload；
8. Validation；
9. Stop Before Submit。

建立 Fixture。

不要让测试依赖企业真实网站。

---

# 59. PHASE 8：Application Diff

在提交之前生成 Structured Diff。

包括：

Candidate Data → Website Field

例如：

Research Project #1 → Project Experience #2

任何非直接映射必须 warning。

验收：

用户能够明确知道系统做了哪些转换。

---

# 60. PHASE 9：Submission

实现用户 Confirm。

然后：

ATSAdapter.submit()

之后：

verifySubmission()

验证方法：

- Success Text
- Success URL
- Application ID
- Application List

不能仅因为点击了 Submit 就认为成功。

---

# 61. PHASE 10：Application Tracker

SQLite：

- Company
- Job
- Application
- ApplicationEvent

实现 Dashboard。

防重复投递。

用户可以手动更新：

- 笔试
- 面试
- 拒绝
- Offer

---

# 62. PHASE 11：Desktop GUI

此时再建立正式 GUI。

页面：

- Home Dashboard
- Candidate Profile
- Resume Versions
- Asset Library
- Job Search
- Application Queue
- Applications
- Question Bank
- Referral Codes
- Settings

---

# 63. PHASE 12：Windows 产品化

Linux 开发。

Windows 构建使用 GitHub Actions。

Windows Runner：

- Build Desktop
- Build Worker
- Bundle Browser Runtime
- Create Installer

输出：

- .exe
- 或 .msi

安装后用户不需要：

- Python
- Node.js
- Claude Code
- Codex

系统所有依赖必须打包。

---

# 64. PHASE 13：更多 ATS

优先根据真实使用频率扩展：

- Moka
- Beisen
- Workday
- SAP SuccessFactors
- 企业自研 ATS

不要依据公司数量排列。

应该依据：

ATS 覆盖企业数量 × 用户需求。

---

# 65. PHASE 14：Learning / Mapping Memory

随着使用记录非个人化 Schema Knowledge。

例如：

ATS A 的“实践经历”通常对应 internship + research_project。

允许共享的是 Field Semantic Rule。

禁止上传具体候选人信息。

---

# 66. PHASE 15：商业化版本

Free：

- Candidate Profile
- Application Tracker
- 每天少量 Auto Fill

Pro：

- Unlimited Auto Fill
- AI Matching
- Multiple Resume Versions
- Portfolio Selection
- Mapping Memory

Pro+：

- Email Tracking
- Cloud Sync
- Multi-device
- Job Monitoring

商业化前必须额外评估：

- 招聘网站 Terms of Service
- 自动化限制
- 数据合规
- 个人信息保护
- 第三方 LLM Data Policy

---

# 67. 测试策略

不能只测试真实网站。

必须建立：

```text
tests/fixtures/sites/
```

例如：

- mock_company_a
- mock_company_b
- mock_moka
- mock_beisen

Mock 页面专门制造困难：

- 科研 vs 工作经历
- 奖学金 vs 比赛
- 项目多条
- 教育多条
- 日期格式不同
- 附件上传
- 个人主页
- 内推码
- 问答
- Character Limit
- Dropdown
- Checkbox
- Radio
- Autocomplete

---

# 68. Unit Test

至少测试：

- CandidateProfile
- FormSemanticClassifier
- MappingEngine
- QuestionMatcher
- JobMatcher
- DuplicateDetector
- AssetSelector
- ContentAdapter

---

# 69. E2E Test

Playwright：

Mock Site。

测试：

Start Browser

↓

Fill

↓

Validate

↓

Screenshot

↓

Stop Before Submit

CI 必须运行。

---

# 70. Snapshot Test

保存：

- DOM Fixture
- Form Schema
- Expected Mapping

网页 Adapter 修改后检查 Schema 是否发生错误变化。

---

# 71. Failure Handling

所有失败必须结构化。

例如：

- LOGIN_REQUIRED
- CAPTCHA_REQUIRED
- UNKNOWN_FIELD
- UPLOAD_FAILED
- VALIDATION_FAILED
- ATS_UNSUPPORTED
- SESSION_EXPIRED
- FORM_CHANGED
- SUBMISSION_FAILED
- DUPLICATE_APPLICATION

不能只输出 Something went wrong。

---

# 72. 页面变化恢复

Known Adapter selector 失败：

↓

尝试备用 selector。

↓

失败：

Generic AI Recovery。

↓

AI 成功：

记录新的 selector。

↓

生成 Adapter Update Candidate。

不能直接永久修改正式规则，需要测试后确认。

---

# 73. Observability

每个 Application Run 生成 Run ID。

记录：

- URL
- ATS
- Page Step
- Field Mapping
- Warnings
- Errors
- Screenshot

敏感数据必须 Mask。

---

# 74. 智能体禁止做的事情

Claude / Codex 不得：

- 自动绕过验证码；
- 保存明文密码；
- 把 Cookie 发给 LLM；
- 将 Candidate Data 上传不明服务；
- 无用户确认进行不可逆批量投递；
- 修改 Candidate Canonical Facts；
- 把科研经历随意当工作经历；
- 自己生成不存在的技能和成绩；
- 为了让测试通过删除失败测试；
- 跳过 TypeScript 类型检查。

---

# 75. 智能体提交代码要求

每次实现完成必须输出：

- 本轮目标
- 修改文件
- 实现内容
- 测试结果
- 已知限制
- 下一阶段建议

---

# 76. MVP Definition of Done

MVP 不要求：

- 全网岗位搜索；
- 自动读取所有招聘邮件；
- 支持所有招聘网站；
- 完全无人值守。

MVP 必须做到：

用户创建完整 Candidate Profile。

↓

输入一个支持的网站 URL。

↓

系统识别 ATS。

↓

抓取岗位。

↓

岗位匹配。

↓

用户选择岗位。

↓

自动进入网申。

↓

正确填写：

- 教育
- 工作
- 科研
- 项目
- 奖项
- 个人主页
- 附件
- 内推码
- 常见问题

↓

科研和工作不能混。

↓

奖学金和比赛不能混。

↓

生成 Diff。

↓

用户确认。

↓

提交。

↓

验证成功。

↓

记录 Application。

↓

Dashboard 可查看。

---

# 77. 第一阶段暂定最终用户体验

用户输入：

企业招聘 URL。

例如：

```text
https://jobs.example.com/campus
```

软件：

检测招聘系统……

Moka

发现：

87 个校园招聘岗位。

筛选：

- 机器人
- 具身智能
- 强化学习
- 运动规划
- 自动驾驶

输出：

机器人算法工程师：94  
具身智能算法工程师：92  
运动规划算法工程师：88

用户：

选择机器人算法工程师。

系统：

该岗位未投递。

开始填写。

如果需要登录：

请在浏览器中完成扫码登录。

完成后：

自动填写。

最后：

Application Diff。

用户：

确认投递。

系统：

Submitted Successfully。

Application Tracker：

XX 公司  
机器人算法工程师  
2026-09-08  
已投递。

---

# 78. 项目技术价值定位

本项目不能仅描述为：

“使用 Playwright 实现自动投简历”。

核心技术应该定义为：

Semantic Candidate Modeling

-

Heterogeneous ATS Schema Understanding

-

Adaptive Field Mapping

-

LLM-assisted Browser Automation

-

Deterministic ATS Adapter

-

Human-in-the-loop Validation

-

Application Lifecycle Tracking

项目描述可以概括为：

> 面向异构企业 ATS 的语义驱动校园招聘自动投递系统。通过统一 Candidate Knowledge Model 对科研、实习、工作、项目、奖学金和竞赛等候选人经历进行显式语义建模，并结合 ATS Schema Detection、LLM 字段理解、规则映射与 Playwright 浏览器自动化，实现跨招聘系统的岗位筛选、自适应表单填写、附件选择、人工校验及投递进度追踪。

---

# 79. 推荐开发顺序

严格按照：

CandidateProfile

↓

Mock ATS Site

↓

FormSchema

↓

Semantic Classifier

↓

Mapping Engine

↓

Playwright Filler

↓

Application Diff

↓

SQLite Tracker

↓

Job Discovery

↓

Job Matcher

↓

第一个真实 ATS Adapter

↓

Submit

↓

GUI

↓

Windows Packaging

↓

第二个 ATS

↓

商业化功能

不要把顺序反过来。

尤其不要第一天直接让 Browser Agent 到处访问企业网站并尝试自动投递。

---

# 80. 给开发智能体的第一条执行指令

现在开始实现 AutoJob。

第一阶段只做项目初始化与 Phase 0，不做完整产品。

你首先需要：

1. 检查当前操作系统、Node、npm/pnpm、Git、Playwright 环境；
2. 创建 monorepo；
3. 初始化 TypeScript；
4. 创建 CandidateProfile 最小 Schema；
5. 创建 SQLite 数据库；
6. 创建一个 Mock Recruitment Website；
7. 创建 Playwright persistent browser；
8. 实现 FormField Parser；
9. 实现第一版 deterministic field mapping；
10. 自动填写 Mock Recruitment Website；
11. 严格区分 Research Project 与 Work Experience；
12. 严格区分 Scholarship 与 Competition Award；
13. 自动填写 GitHub / Homepage；
14. 支持 Resume / Portfolio 上传；
15. 在 Submit 前停止；
16. 保存本次 Application；
17. 保存截图；
18. 编写 Unit Test 和 Playwright E2E Test。

这一阶段禁止：

- 访问真实招聘网站进行真实投递；
- 实现自动 Submit；
- 实现复杂 GUI；
- 实现多个 ATS；
- 引入不必要的大型依赖。

完成后必须运行：

- lint
- typecheck
- unit test
- e2e test

并全部通过。

最后向我展示：

- 项目目录树
- CandidateProfile Schema
- 数据库 Schema
- FormField Schema
- Mapping Engine 工作方式
- Mock 招聘页面
- CLI 使用方法
- 测试结果
- 下一阶段建议

在当前阶段稳定之前不要继续 Phase 1。
