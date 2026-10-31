# AGI黎明分类与主题落地计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 在本机应用已确认的 6 类、14 主题和 96 篇试分，验证阅读筛选及数据保留。

**Architecture:** 主题沿用 `industry/topics.json`，一次性标注清单放在 `industry/reader-taxonomy.json`。维护脚本默认预览，显式指定数据库和 `--apply` 后复用现有管理员事务函数原子建立分类、合并标签并重新发布投影；不写正文或私人记录。

**Tech Stack:** Node.js 24.22.1、TypeScript、PostgreSQL 17、现有 postgres/zod、Node test、Playwright。

**Spec:** `docs/reader/category-topic-proposal.md`（用户于2026-10-28确认6类+14主题）；逐篇依据见 `docs/reader/category-topic-draft-mapping.md`。

## Global Constraints

- 仅本机 Linux；复用隔离工作树 `codex/article-reader`，不公开上线，不推送。
- 保留“待分类”；一篇一个分类、可多个主题，21篇仅摘要的判断保留暂定依据。
- 分类可后台新增和改名；主题配置维护，不增加主题编辑器或自动分类。
- 不调用模型、付费提取或外部服务；不改采集、公开全文和通知策略。
- 不提交 `.env`、密钥、`.data/`；既有正文、归档、笔记和下架决定不得被覆盖。

## Review Focus

- 原有手工标签及继承来源标签，包括隐藏的 `entity:` 标签，添加主题时完整保留；超过20个拒绝。
- 已有分类与清单冲突、目标缺失或配置引用无效，预览与应用均拒绝，不悄悄覆盖。
- 第二篇写入或审计失败时，分类、第一篇覆盖、发布和审计全部回滚。
- 人工下架与已有标题/摘要保持；来源变动造成发布可见性变化时回滚。
- 只改分类/标签，不改原始文章与正文版本；再次执行已满足的清单不新增覆盖和审计。

## Task 1: 词表和事务性应用工具

**Files:** `industry/topics.json`、新建 `industry/reader-taxonomy.json`、`scripts/apply-reader-taxonomy.ts`；修改 `packages/backend/src/admin/categories.ts`、`content.ts` 提取可接受现有事务的入口；扩充 `tests/category-corrections.test.ts`。

**Interfaces:** `addCategoryTx(tx,input,actor)`、`overrideFieldsTx(tx,id,input,actor)` 保持原验证、CAS、审计与发布行为；原API继续自行开启事务。`applyReaderTaxonomy(input:unknown,{database:string,apply?:boolean})` 解析清单、读取完整旧标签、拒绝冲突，返回聚合预览/应用结果。CLI固定读取本仓库清单，`--database <name>` 必需，默认只读预览，`--apply` 才提交。

- [x] 先增加集成测试：预览无写入、真实主题筛选与计数、继承/手工/隐藏标签保留、下架/标题/原始版本保留、再次执行不新增审计。
- [x] 增加失败测试：错误库名、缺失文章、无效主题、分类冲突、标签超限、第二篇审计失败的全批回滚。运行定向测试，确认新入口不存在而失败。
- [x] 提取两个事务入口，编写脚本与已确认词表、96篇清单。主题标签使用可读中文名称，slug保持稳定；清单仅按URL+sourceId定位，不依赖本机文章ID。
- [x] 运行定向测试：`node --test-global-setup=tests/databases.ts --import ./tests/databases.ts --test --test-timeout=120000 tests/category-corrections.test.ts tests/topics.test.ts tests/admin-corrections.test.ts`。期望全部通过，且无外部请求。

## Task 2: 本机应用与交付验收

**Files:** 更新 `docs/customize.md`、`README.md`、`docs/deploy.md`、方案确认状态；新增 `docs/reader/phase3-acceptance.md`。忽略目录内存放预览、变更前后摘要和本地浏览器证据。

**Interfaces:** 使用Task 1的CLI；现有systemd本机管理脚本、备份脚本、公开API、分类后台及既有筛选页面。

- [x] 运行类型检查、后端完整测试、web构建及web测试；期望全部通过。用测试库，安全阀沿用测试默认值。
- [x] 操作前生成本地完整备份；核对服务归属后暂停应用，保存原始文章、正文归档和私人状态的数据库摘要及旧覆盖字段。
- [x] 在 `reader_dev` 先预览，核对96篇/6类/14主题/21篇暂定及95篇分类、1篇待分类；显式应用后再次预览应0变更。
- [x] 验证原始数据摘要、既有标签/可见性不变；重启本机服务使主题配置生效。
- [x] 对公开API逐类、逐主题和分类+主题+来源组合核对实际文章集合；验证空组合、未知值、分页；运行smoke。
- [x] 浏览器检查桌面/手机分类与主题入口及筛选，确认管理员可新增/改名（可逆的专用验收分类，无文章分配）。核对正文未授权公开、仅摘要条目状态。
- [x] 一次独立代码审查，必要修复后跑相应检查；更新验收记录，提交本地分支，不推送。

## Self-review

本计划覆盖已确认词表、现有标签保留、暂定归类依据、动态分类能力及本机验收。Task 2只消费Task 1的工具和固定清单，不增加API、表结构、后台主题管理器或自动分类。用户已明确授权实施，本轮直接连续执行，不再请求同一范围的确认。
