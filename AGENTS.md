# 给 Agent 的说明

AGIDawn（AGI黎明）是技术文章阅读站，当前仅在本机运行，尚未公开上线。普通文章可匿名阅读；管理员另有私人书库，保存收藏、阅读状态、笔记、正文历史、阅读位置和离线归档。文章保留原文，worker 可生成中文标题、摘要和正文译文。

旧热点、评分与写作、事件归组、日报周报月报、精选推送、模型管理、RSS 输出、公开 v1、MCP 和 Agent Markdown 已退休；RSS 输入、付费提取、翻译、认证审计、反馈和运维告警仍在使用。不要把历史文档或遗留名称当作恢复旧功能的需求。

本文件维护仓库级 Agent 规则；`CLAUDE.md` 只保留 `@AGENTS.md` 引用。先读 [README](README.md) 了解当前产品，再按任务查下面的入口。验收记录和 `docs/superpowers/` 中的计划描述各自时点；其中的旧路径、数据数量、测试结果和待办不等于当前状态，也不改写旧记录冒充本次验证。文档与实现冲突时，核实当前调用链和已确认需求，再调整本次涉及的说明。

## 当前规则与设计依据

**修复前验证问题前提。** 核实当前行为、问题触发条件与原设计前提，区分已验证事实和待验证假设。

项目规则与既有决定应结合其目标、适用前提和当前证据理解。历史选择不代表最优方案；当前提变化、出现新证据，或执行成本与收益明显不匹配时，Agent 应主动复评、指出问题并提出调整建议，不以“已有规定”或“原本如此设计”作为停止分析、拒绝调整的理由。在已有授权和决策权限内，可调整常规工程做法，并同步受影响的规范及必要理由；涉及业务、安全、授权边界或明确审批要求时，按对应约定确认。记录与验证的深度应与变更影响相称，避免为调整规则再增加不必要的流程。

## 工作范围

- 修改前检查工作区已有变更并阅读待改内容；涉及行为修改时，阅读负责该行为的代码及必要调用方。文档中的实现、命令等事实按需核对。保留使用者和其他 Agent 的成果；无关问题单独报告，不夹带重构。
- 在已授权范围内完成实现、相关验证和交付；可逆的常规工程选择自行推进。已有明确决定不重复询问。新增来源、改变分类含义、扩大全文展示范围或公开部署等业务决定，缺少授权时向使用者确认，并继续不受影响的工作。
- 站名、分类与主题已有确认结果，见 [配置说明](docs/customize.md)。正式域名、面向公网的来源许可、条款及隐私说明仍需站主上线前确认；本机全文授权不自动扩展到新来源或公网部署。
- 文件编辑不自动授权提交、推送、发布或操作真实数据。执行迁移、维护脚本或服务切换前，核对工作副本、数据库、资源目录与服务归属，遵循 [部署说明](docs/deploy.md)。

## 按任务找入口

| 任务 | 实现入口 | 对应说明 |
| --- | --- | --- |
| 跨进程、公开数据与模块边界 | `apps/api/src/`、`apps/worker/src/`、`packages/backend/src/`、`packages/contracts/src/` | [架构](docs/architecture.md) |
| 公开列表、探索与文章阅读 | `apps/web/app/`、`packages/backend/src/publication/` | [探索与筛选](docs/reader/explore-acceptance.md)、[分页](docs/reader/pagination-acceptance.md)、[阅读工具](docs/reader/article-controls.md) |
| 私人书库、笔记、分类、主题与阅读位置 | `modules/reader/`、`modules/reader/pages/`、`modules/reader/components/` | [配置与管理](docs/customize.md)、[私人阅读验收入口](docs/reader/phase4-acceptance.md) |
| 来源采集、正文提取与重处理 | `packages/backend/src/sources/`、`packages/backend/src/content/`、`packages/backend/src/jobs/`，`apps/worker/src/schedules.ts` | [信源配置](docs/sources.md)、[来源验收](docs/reader/source-inventory.md) |
| 标题、摘要与正文翻译 | `modules/reader/translation/`、`modules/reader/server.ts` | [翻译规则与验收](docs/reader/translation-acceptance.md) |
| 归档、备份与数据库迁移 | `modules/reader/archive/`、`database/migrations/`、`modules/reader/migrations/`、`scripts/` | [迁移约定](docs/architecture.md#数据库迁移)、[备份恢复](docs/reader/backup-restore.md)、[部署](docs/deploy.md) |
| 站点文案、品牌、导航与初始化模板 | `site/site.ts`、`site/brand/`、`site/pages/`、`site/public/`、`industry/` | [配置说明](docs/customize.md) |
| 本机启停、升级与观察 | `scripts/local-reader.ts`、`scripts/reader-status.ts`、`deploy/` | [本机常驻运行](docs/deploy.md#本机常驻运行) |

技术栈是 npm workspaces、Node.js 24 直接运行 TypeScript、Fastify API、PostgreSQL/pg-boss worker，以及 React + React Router + Vite 前端。后端没有构建步骤。共享 HTTP 约定在 `packages/contracts/`；站点模块由 `site/modules/index.ts`、`site/modules/server.ts`、`site/modules/web.ts` 三份清单装配，修改模块入口时核对相关清单。

## 跨模块约束

- **共享契约变更同时核对所有使用方。** 修改 `packages/contracts/`、模块契约或跨进程数据格式时，追踪数据的生产方和所有消费方，同次更新受影响的类型定义、运行时校验、API/worker、前端、模块及相关测试。核对字段含义、默认值、可选性和错误行为，不能仅以类型检查通过判定完成；涉及存量数据或部署版本衔接时，明确迁移或兼容要求并同步升级说明。
- **公开读取统一。** `apps/web` 只通过 HTTP 访问 API，不导入数据库或后端实现。公开文章、搜索、站点地图和分享图从 `packages/backend/src/publication/` 读取，沿用当前来源、人工下架及全文许可检查；管理员打开普通页面与访客看到的公开内容相同。
- **私人资料隔离。** 私人书库、笔记、收藏、阅读状态、历史快照和阅读位置经管理员接口读取。模块复用 `adminHandler`，写入保留会话与 CSRF 检查。公开文章响应不能混入私人资料；正文归档 ZIP 不含私人笔记，专用笔记导出只读服务端已保存内容，不隐式保存草稿。
- **正文许可实时生效。** `site_fulltext` 默认关闭，成功提取正文不等于取得公开再发布许可。普通正文、正文译文与公共图片都检查当前可见性及来源许可；图片还要匹配当前快照。公开文章响应、归档资源和私人接口保留 `no-store`，不以旧缓存绕过撤回或权限变化。
- **付费工作在后台。** 页面读取不触发模型或付费提取；翻译由 worker 排程执行，所有付费请求经过 `packages/backend/src/providers/receipts.ts` 与预算。未知计费结果按既有回执恢复流程处理，不直接重发。
- **区分两种翻译资格。** 标题与摘要可补译已有公开文章，不要求全文许可；正文自动翻译只为新收录文章登记资格，且要求全文许可。原字段缺失就保持缺失，不生成新摘要。译文须匹配当前原文版本，私人快照与阅读位置仍对应原文；已有正文的批量补译需要明确任务授权。
- **保留人工决定和并发检查。** 重采集、重提取与旧任务不能覆盖新正文修订或撤销人工下架。分类、主题、私人状态与笔记沿用各自版本检查及审计；批量修改任一冲突整批回滚。保存冲突或请求结果不明时保留草稿，提供重新载入核对入口；会话失效时按现有认证流程清除私人内容，避免迟到响应重新展示。
- **外部动作显式开启。** `COLLECT_ENABLED`、`MODEL_CALLS_ENABLED`、`FEISHU_INTERNAL_ENABLED`、`INDEXNOW_SUBMIT_ENABLED` 只认字符串 `true`。开发用配置默认关闭；本机既有授权配置按任务保留，测试隔离要求见下文。
- **凭据与私人数据。** 不提交 `.env`、密钥、Cookie、真实数据库、私人资料和 `.data/`。日志、截图及交付说明隐藏凭据与无关私人内容；读取、导出或处理私人资料须在任务授权范围内。

## 来源、分类与站点配置

- `industry/sources.json`、`industry/topics.json` 是初始化模板；seed 只补缺失项，不覆盖后台编辑。运行时来源、分类与主题以数据库为准，日常管理走已有后台。不要靠重复 seed、改模板或运行旧标注清单覆盖现有数据。
- 新文章先“待分类”，分类由管理员分配。主题名称、说明与稳定 slug/匹配标签分开；改名保留文章归属，批量整理保留未指定主题，单篇勾选保留目录外标签。具体规则见 [配置说明](docs/customize.md)。
- 来源专用规则先用现有采集配置表达，允许字段见 `packages/backend/src/sources/config-keys.ts`。日期缺失不补造；无时区时间按来源配置解释，默认 `+08:00`，中文来源的 CST 按北京时间核实。页面日期与日历筛选使用 `Asia/Shanghai`，测试不能依赖宿主时区。
- 出站请求复用现有地址、重定向、体积和超时检查；内网订阅入口许可不扩展到正文与图片。修改采集或清洗行为时，用代表性的真实公开样本比较前后结果，可复用已保存样本；需要实时验收时遵循下文的授权与隔离要求。样本范围见 [来源验收](docs/reader/source-inventory.md)。
- 站点专属配置放在 `site/`，私人阅读功能放在 `modules/reader/`，共享能力在现有 `apps/`、`packages/` 中修改。先搜索已有能力：模块发文件复用 `apps/api/src/routes/static.ts` 的 `sendFile`，模型连接复用 `LLM_BASE_URL` 等现有配置，不另建同类入口。

## 迁移与持久数据

- 核心迁移在 `database/migrations/`，模块迁移在该模块的 `migrations/`。按完整文件名排序和记账，同编号不同文件分别执行，完整文件名不得重复。已发布迁移不改，修正使用新文件。
- 从 `0055` 起，每文件只放一条允许在线执行的语句；索引用 `CREATE INDEX CONCURRENTLY IF NOT EXISTS`。已有表新增 CHECK/外键约束先 `NOT VALID` 再单独验证；其他语句按 `scripts/migration-safety.ts` 的允许范围及 [迁移约定](docs/architecture.md#数据库迁移) 设计。大批回填与状态清理走显式维护流程，不塞进发布迁移，不关闭检查或用 `DO`/`CASCADE` 绕过。
- `0100_reader_drop_*` 用于新阅读站库，不能直接用于原运营库。会删除使用者数据的变更须说明范围、备份与回退，并更新 [部署说明](docs/deploy.md#更新与回退)。数据库与归档资源必须用同一完整备份组成组恢复到新库、新目录；不能只恢复数据库后宣称归档已恢复。

## 运行与验证

环境要求：Node.js **24.22.1+**、PostgreSQL **17**；备份恢复需要同主版本的 `pg_dump`/`pg_restore` 与 `tar`。OpenAI 来源的浏览器指纹传输另需 Python/curl_cffi，安装步骤见 [部署说明](docs/deploy.md)。复用已有可用环境；只有任务确有需要时才重新初始化、执行 seed 或迁移，并遵守前述真实数据操作授权。

首次安装按 README；开发命令在仓库根目录分别运行 `npm run dev:api`、`npm run dev:worker`、`npm run dev:web`。已有 systemd 服务或预览时先核对归属、端口与构建目录，避免重复启动 worker 或覆盖正在对照的前端构建。

按实际影响选择检查；同一改动涉及多个范围时组合对应检查，不因文件所属目录自动扩大到全套：

| 改动 | 必要验证 |
| --- | --- |
| 不影响执行的文档或注释 | 核对内容、路径、命令与链接，运行 `git diff --check`；无需运行应用测试或新增测试文件 |
| 局部后端、模块逻辑 | `npm run typecheck` 和对应测试；无数据库用例使用 standalone 入口 |
| 前端页面、交互或导航配置 | 类型检查、web 构建、受影响的 web 测试；浏览器核对桌面/手机、键盘与必要的默认/非默认配置 |
| 跨包契约、认证/公开权限或队列 | 类型检查及受影响生产方、消费方的集成回归；按改动风险覆盖权限、失败和并发行为 |
| 数据库迁移 | 迁移安全检查、隔离测试库迁移及相关数据行为回归；接口或页面也有变化时追加对应检查 |
| 跨层广泛改动或无法可靠限定影响 | 类型检查、完整后端/模块测试、web 构建与 web 测试 |
| 备份、归档与恢复 | 相关自动测试，并在独立库和资源目录核对同组恢复、资源校验及导出；写入演练限于隔离副本，不改原库、原资源和既有备份 |

常用命令（在仓库根目录按上表选用）：

```bash
npm run typecheck
npm run test:standalone
DATABASE_URL=postgres://127.0.0.1:5432/reader_test npm test
npm run build -w @agidawn/web
node --test apps/web/tests/*.test.ts
node scripts/check-migrations.ts --base HEAD
node scripts/smoke.ts --base http://localhost:3000
```

- **数据库测试会写库。** `DATABASE_URL` 必须指向本地可丢弃的 `_test` 或 `_ci` 库，账号需要建库权限。runner 自动建库、迁移，并为各文件克隆数据库；开始与结束会清理同模板名的克隆库。独立测试命令不能并发共用同一个模板库。名称后缀检查不限制服务器，也不证明库内没有真实资料。
- 单个数据库测试保留完整准备入口，例如 `DATABASE_URL=postgres://127.0.0.1:5432/reader_test node --test-global-setup=tests/databases.ts --import ./tests/databases.ts --test --test-timeout=120000 tests/publication.test.ts`。单个无数据库测试用 `node --import ./tests/standalone.ts --test tests/url.standalone.test.ts`。
- 自动测试不加载真实 `.env`。运行前由调用方清除继承的真实服务凭据和出站代理，并关闭外部推送；现有测试入口不保证完成全部清理。采集/模型只连本地假服务。
- 真实来源验收命令为 `node --env-file=.env scripts/validate-reader-sources.ts --live`。它访问外网，并对当前配置库执行采集、正文提取和资源归档；运行前核对目标库与资源目录，确认这些写入已在授权范围内，不把它当作只读检查或自动测试入口。
- web 测试先构建，自行启动假 API 与隔离 web，不需要真实 API/数据库；完整集合需要 Playwright Chromium、WebKit 及系统运行库。启动或更新站点后，待服务就绪再运行 smoke，`--base` 指向实际目标；smoke 本身不启动服务。
- 迁移检查读取当前工作树；`--base HEAD` 用于未提交改动，检查分支整体时改为实际目标基准，不假定本地存在 `main`。
- 代码、依赖及环境未变且检查已通过时，不为提交步骤重复运行。失败先区分本次回归与环境问题；缺少工具或权限时完成可做部分，并明确哪些行为尚未验证，不能把跳过写成通过。

## 写代码、文档与交付

- 匹配周围的命名、格式与注释密度。TypeScript 保持 strict 和可擦除语法；跨包用现有 `@agidawn/*` 入口，Node 直接运行的代码使用带 `.ts` 的相对导入，前端沿用现有解析约定。选能清楚解决问题的简单方案，只定义正在使用的抽象。
- 加锁、重试、兼容层、开关或兜底前先给出真实故障或平台语义的依据。停用机制时同次清理代码、测试、文档、排程、settings、环境变量和存储状态；已发布 SQL 保留，状态清理遵循迁移与数据授权约定。
- 测试验证重要行为，回归用例优先并入所属测试文件，没有合适归属时按现有布局新建。不断言私有常量、CSS 类名或浏览器本身的行为，不为简单样式和文档修改新增测试。
- 更新拥有该事实的文档段落，不在文末不断追加相互冲突的说明。用户可见变化同步 README 或相应专题；环境变量同步 `.env.example`，配置语义同步模板，数据影响与升级步骤写入 `docs/deploy.md`。
- 交付前查看本次 diff 与新增文件，说明改了什么、执行了哪些检查、结果及剩余限制。获授权提交时只暂存明确属于本次任务的路径，保留其他改动。

只有任务要求向上游 `yuhengqin/agi-dawn` 提 PR 时，再按 [CONTRIBUTING.md](CONTRIBUTING.md) 执行其通用性、Issue、受限文件与完整检查要求。上游不接收外部规则文件/依赖等修改的限制属于贡献流程，不替代使用者对当前本地项目的明确修改授权。
