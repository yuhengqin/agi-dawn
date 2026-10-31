# AGIDawn 文章阅读站实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 获得开始开发的明确指令后，使用 `superpowers:executing-plans` 按任务执行。主代理承担设计与复杂实现；子代理仅按用户的 AGENTS 规则承担有界调查、审查、机械修改或验证。所有执行步骤使用复选框跟踪。
>
> **当前状态：2026-10-28已完成本机 Linux 功能验收。** 用户2026-10-27在后续聊天明确要求继续实现；此前“先不要开始开发”仅为原规划轮次的限制。实际结果见 [验收记录](../../reader/acceptance.md)。子计划原始步骤包含预想的文件布局、逐任务提交及故障注入，不将未逐项执行的历史步骤批量勾成完成；以下清单记录本轮实际交付。

- [x] T01：独立worktree、新库、私有工具链、基线及来源/退役清单。
- [x] T02—T04：原文发布、采集补齐、持久下架及旧功能/出口/状态退休。
- [x] T05：技术正文结构、受限SVG/公式表示与明确partial；真实来源限制单独列明。
- [x] T06—T07：完整历史查找与公开页面、权限和no-store策略。
- [x] T08—T09：站主私人状态/笔记与冲突、失效处理。
- [x] T10—T12：事务版本、图片归档、权限检查及指定版本离线ZIP。
- [x] T13：配套备份、空库/新目录真实恢复、文件校验。
- [x] T14本机范围：五源96篇、AGI黎明品牌、部署说明、完整检查、独立审查及恢复后断网阅读。
- [ ] 正式上线：域名、最终词表、全文许可、条款生效内容及生产环境验证；未包含在本轮授权范围。

**Goal:** 基于 AGIDawn 构建自动收录、免登录全文阅读、管理员维护和私人阅读归档的一体化网站。

**Architecture:** 保留采集、正文提取、管理认证和阅读基础，改造统一 publication 读取层，使原文发布不依赖模型。私人状态和归档放在 `modules/reader`，通过已有模块机制及必要的小范围接点连接核心；公开数据与管理员数据分别读取。

**Tech Stack:** 沿用仓库的 Node.js、TypeScript、Fastify、React Router、PostgreSQL、pg-boss 与现有 HTML 清洗、图片处理能力；Node 要求以当前 `package.json` 的 `>=24.22.1` 为准。

**Spec:** [已确认设计](../specs/AGIDawn改造设计方案.md)。代码调查基线是 `D:/AgentPro/AGIDawn`，提交 `aa8e5b1`；实施前重新核对基线及工作区，不覆盖后来增加的修改。

## 全局约束

- 实施使用隔离工作副本和全新数据库，保留原项目及已有数据。
- 所有公共读取继续集中在 `packages/backend/src/publication/`。web 只通过 HTTP 访问 api，公开页面不调用模型。
- 访客无需登录即可阅读允许展示的全文；只有单一管理员使用私人收藏、阅读状态与读后感。
- 原始标题和正文保留原文语言；缺作者不补造，缺日期明确使用收录时间。
- 首次接入默认最多 30 篇、近 12 个月，来源可以调整。历史浏览不保留原有 2,000 条访问上限。
- 来源停用只停止采集；下架是持久人工决定，同一规范化身份再次采集不能恢复公开。
- 公共正文与资源可见性缓存窗口不超过 60 秒，禁止旧内容的过期兜底；私人接口使用 `no-store`。
- 阅读状态为“待读、阅读中、已读”；打开文章最多进入阅读中，显式操作才进入已读。
- 归档按确定版本保存正文与图片；只有所有必要图片校验成功才标为完整。ZIP 含离线 HTML、Markdown、图片与元数据。
- 不提供读者账号、公共评论、自动热点／日报、首版 AI 写作、视频音频离线下载或原网页脚本执行。
- `site_fulltext` 默认关闭；来源许可与提取质量分别验收。输入 RSS 保留，原 RSS 输出、MCP、公开 v1 及旧公开 Markdown 下载入口退役；离线导出通过管理员的指定版本 ZIP 提供。
- 历史迁移不可修改；核心迁移放 `database/migrations/`，reader 专属表及索引放 `modules/reader/migrations/`，复用现有迁移扫描。新迁移一文件一条允许语句，索引按仓库规则使用 `CONCURRENTLY IF NOT EXISTS`。破坏性清理只针对明确的新库，不使用 `CASCADE` 隐藏依赖。
- 开发与自动测试不调用真实模型或发送推送。涉及付费提取器时沿用回执与预算，不因移除模型而误删这些基础能力。

## Review Focus

1. 旧正文任务晚于人工下架或新修订完成：不能恢复公开，也不能覆盖新正文。由 T03、T04、T10 验证。
2. 页面、浏览器数据缓存和图片缓存叠加：下架或撤销全文后，缓存不能重新获得完整寿命。由 T07、T11 验证。
3. 同时存在未知日期、补齐日期、相同时间和超过 2,000 篇旧文：时间显示准确，筛选和翻页可到达全部记录。由 T02、T06 验证。
4. 无登录、会话过期和两个编辑窗口：私人数据不能进入公共响应，旧笔记不能覆盖新笔记。由 T08、T09 验证。
5. 下载中断、正文换版和备份期间新增资源：归档不能拼接版本或虚报完整，恢复后的清单可校验。由 T10—T13 验证。

## 计划分组与执行次序

| 任务 | 交付单元 | 前置任务 | 详细计划 |
| --- | --- | --- | --- |
| T01 | 隔离环境、基线、来源样本与退役清单 | 用户明确开始开发 | [收录与发布](../plans/01收录与发布实施计划.md) |
| T02 | 无模型文章投影及统一公开契约 | T01 | 同上 |
| T03 | 自动收录、正文处理、重试与修订闭环 | T02 | 同上 |
| T04 | 旧出口、后台任务与闲置状态退役 | T03 | 同上 |
| T05 | 技术正文质量与缺失状态 | T03、T04、来源样本 | 同上 |
| T06 | 来源、主题、日期筛选与完整历史检索 | T02、T04 | [查找与私人阅读](../plans/02查找与私人阅读实施计划.md) |
| T07 | 公开阅读页面与缓存一致性 | T05、T06 | 同上 |
| T08 | 管理员私人状态及笔记接口 | T04 | 同上 |
| T09 | 私人阅读界面及冲突处理 | T07、T08 | 同上 |
| T10 | 不可变正文快照与事务接点 | T05、T08 | [归档与交付验证](../plans/03归档与交付验证实施计划.md) |
| T11 | 图片归档、公共资源授权与恢复处理 | T10 | 同上 |
| T12 | 指定版本离线 ZIP 导出 | T11 | 同上 |
| T13 | 数据与资源配套备份、恢复验证 | T11 | 同上 |
| T14 | 真实来源、品牌部署及全链路验收 | T09、T12、T13 | 同上 |

T02—T04 是一次核心流程替换的连续子任务，可分别提交和运行针对性检查，但必须在同一开发阶段完成清理并通过集成验收后才能交付。不能把中间状态部署为完成版，也不能长期保留一套已经退役的任务和状态。

核心流程稳定后，T06 与 T08 可以分开推进；T12 与 T13也可在归档契约稳定后独立推进。任何共享的 contracts、模块接点、迁移命名和测试环境由主代理串行整合，验证期间不修改被验证状态。

## 跨任务接口约定

以下是实施计划确定的接口名称和责任，当前尚不存在的接口由标注任务创建。具体函数体留给实施者，不据此重复建立通用框架。

| 接口 | 定义与拥有者 | 消费者 |
| --- | --- | --- |
| `ReaderBodyState`、`ReaderItemSummary`、`ReaderItemDetail` | `packages/contracts/src/site.ts`，T02。保留文章 ID、原始标题、来源 ID/名称、作者、原文链接、日期；正文状态区分 pending/ready/partial/unavailable/not-permitted，并独立记录 `refreshPending` | T03、T05—T07、T09—T11 |
| `publishArticleTx(tx, articleId)`、`publishArticle(articleId)` | 保留现有名字，T02 替换决策依据；始终应用人工覆盖和来源权限 | 采集、修订、管理员修正 |
| `ReaderListQuery`、`ReaderListPage`、`loadReaderList(query)` | `site.ts` 与 `publication/pool.ts`，T06。查询参数为 `sourceId/category/topic/from/to/q/cursor/limit`；响应 `{items,nextCursor}` | 首页、全部文章、来源页、主题页 |
| `canReadArticleBody(articleId)` | `publication/access.ts`，T02，返回当前是否可公开正文；不读取私人数据 | T11 公共资源访问与核心正文读取 |
| `ReaderState`、`ReaderNote`、对应 Patch 类型 | `modules/reader/contracts.ts`，T08，纯数据类型，无后端导入 | 私人 API、T09 UI |
| `ModuleHttpContext.adminHandler` | `packages/backend/src/modules.ts`，T08 声明可注入的 guard 类型；api 装配时传现有管理员 guard | `modules/reader/server.ts`，避免模块反向导入 apps 或复制鉴权 |
| `MaterialCapture`、`articleMaterialStored` | `packages/backend/src/modules.ts`，T10。正文与元数据的确定版本，在内容事务内发送给模块 | `modules/reader/archive/snapshots.ts` |
| `PublishedBodyInput`、`publicationBody` | `packages/backend/src/modules.ts`，T11。在 publication 已确认全文权限后，将对应版本图片引用改到归档资源 | 公开文章详情；不更换为其他版本正文 |
| `ArchiveSnapshot`、`ArchiveLimits`、`ArchiveManifest` | `modules/reader/contracts.ts`，T10—T12 补充，所有生产者和消费者共用 | 归档、资源读取、ZIP、恢复校验 |

`from`、`to` 为 `YYYY-MM-DD`，按 Asia/Shanghai 日历日解释，起始日含、结束日含，后端转换为 `[起始日零点, 结束次日零点)`。缺日期文章按收录时间进入相同查询。列表固定按有效文章时间、文章 ID 倒序；默认 40 条，最大 100 条，不限制总页数。参数或游标无效返回 400，不静默吞掉筛选。

## 命令约定与基线检查

以下命令均从独立工作副本根目录运行。使用 WSL/Linux 的 POSIX shell 示例；不将包含密码的 URL 写进文档或命令输出。`reader_test` 必须是专用临时模板库，账号需有创建和删除测试副本库的权限。

```bash
# Q1 全仓类型检查
npm run typecheck

# Q2 单组数据库测试：保留全局迁移和每文件数据库隔离
DATABASE_URL=postgres://127.0.0.1:5432/reader_test node --test-global-setup=tests/databases.ts --import ./tests/databases.ts --test --test-concurrency=1 --test-timeout=120000 tests/publication.test.ts

# Q3 无数据库测试
node --import ./tests/standalone.ts --test --test-timeout=120000 tests/markdown-body.standalone.test.ts

# Q4 前端纯逻辑测试，无需浏览器或构建
node --test --test-timeout=120000 apps/web/tests/day-header-year.test.ts

# Q5 前端构建及浏览器/其他前端测试，需要已安装的 Playwright Chromium
npm run build -w @agidawn/web
node --test --test-timeout=120000 apps/web/tests/*.test.ts

# Q6 集成阶段完整后端测试
DATABASE_URL=postgres://127.0.0.1:5432/reader_test npm test

# Q7 启动本地新站后运行，smoke 契约在 T04/T14 更新
node scripts/smoke.ts --base http://localhost:3000
```

子计划中的 `Q2 文件A 文件B` 表示将 Q2 示例最后的文件路径替换为这组文件，其他初始化参数保留；Q3、Q4、Q5 同理。成功条件是命令退出码 0、相关断言通过且没有误连真实付费服务；不把“命令已启动”当成通过。

PowerShell 中应先单独设置 `$env:DATABASE_URL = 'postgres://127.0.0.1:5432/reader_test'`，再运行同样的 Node 命令；不过项目的 `pg_dump`、`tar` 与 `/dev/null` 等部署工具链按 WSL/Linux 验证，不能仅凭 Node 可运行宣称 Windows 原生全链路可用。

根 `npm test` 的 `*.test.ts` glob 也会匹配 `.standalone.test.ts`，但 `tests/databases.ts` 对后者跳过数据库副本；`npm run test:standalone` 则只选择 standalone 测试。模块测试必须放在 `modules/reader/tests/` 第一层，避免被当前单层 glob 漏掉。

## 检查、提交与交付规则

每个业务任务先加入能证明新行为的失败测试，再实现，最后运行限定范围检查。环境清单、品牌文字等低影响修改不为了形式增加测试。一个任务完成后提交其明确文件，提交信息由各任务给出；不使用 `git add .` 混入其他工作。

重大契约修改由主代理定点复核，并可安排一位新只读审查代理；不让审查代理接管实现。各任务只做必要检查，通过后不无理由反复运行全套。T04 和 T14 执行阶段集成检查。

原规划轮次曾仅形成文档。后续用户授权的Linux实施已完成本机功能验收，环境、测试与已知边界见 `docs/reader/acceptance.md`；保留隔离分支与工作副本，不推送远端或公开部署。

