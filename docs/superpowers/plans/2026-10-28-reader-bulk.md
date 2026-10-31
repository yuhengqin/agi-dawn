# 私人书库批量整理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 在私人书库当前筛选页多选文章，原子地分配分类及增删主题。

**Architecture:** 列表返回分类乐观版本，批量 PATCH 接口复用 `overrideFieldsTx` 在同一事务保存；客户端以本页为选择边界，确认后提交并重验原查询。

**Tech Stack:** Node.js24、PostgreSQL17、TypeScript、React Router、原生表单、Playwright。

**Spec:** `docs/superpowers/specs/2026-10-28-reader-bulk-design.md`

## Global Constraints

- 仅在本机 Linux，服务只监听回环地址，不公开上线；保留普通页已采集正文展示。
- 无新依赖和数据库迁移；不提交 `.env` 或 `.data/`。
- 选择限当前页，最多100篇；整批事务和共同乐观版本；保留未指定字段及私人数据。
- 按既有界面与原生表单规范，点击目标至少48px；错误、忙碌和确认范围明确。

## Review Focus

- 搜索与五筛选组合后，只提交当前选中文章；翻页、改条件、重载不会保留隐藏选择。
- 主题添加/移除为增量，未指定主题和隐藏标签保留；无操作不冻结来源继承。
- 任一冲突或审计失败，先前文章的修改与投影也回滚；重叠批次不会产生部分覆盖。
- 分类不改变与明确待分类区分；无效分类即使与现值相同也不静默接受。
- 保存成功后仍用原查询，失败保留选择；会话失效立即卸载私人内容。

### Task 1: 批量分类事务与书库版本

**Files:** 修改 `modules/reader/classification.ts`、`contracts.ts`、`state.ts`、`search.ts`、`server.ts`，测试 `modules/reader/tests/privacy.test.ts`。

**Interfaces:**
- Consumes: `overrideFieldsTx(tx,id,{fields,version,reason},actor)`、`ClassifiedArticle`。
- Produces: `PATCH /api/admin/reader/classification`，输入 `{articles:[{id,expectedVersion}],category?:string|null,addTopicSlugs:string[],removeTopicSlugs:string[]}`，输出 `{selected:number,changed:number}`；列表每项新增 `classificationVersion:number`。

- [x] 在现有隐私测试文件加入 HTTP 行为测试，证明批次增量、认证、CSRF、原始及私人数据不变。
- [x] 运行 `node .data/phase4/run-backend.mjs modules/reader/tests/privacy.test.ts`，观察新增断言因缺失接口失败。
- [x] 实现严格输入验证，去重及重叠主题拒绝、分类存在性、确定锁顺序、版本核对及同事务保存；空变更不写。
- [x] 加入无效输入、无变化、混合版本、标签超限、审计回滚和重叠并发批次验证；运行同一命令，全部通过。
- [x] 提交后端功能及测试，记录结果。

### Task 2: 本页选择、确认与本机验收

**Files:** 修改 `modules/reader/pages/library.tsx`，创建 `modules/reader/components/LibraryOrganizer.tsx`，测试 `apps/web/tests/reader-private.test.ts`；更新 README、`docs/customize.md`、`docs/deploy.md`、`docs/reader/implementation-status.md` 与批量验收记录。

**Interfaces:**
- Consumes: Task1 的列表版本与批量 PATCH 接口；`ownerRequest`、`expireSession`、当前筛选查询。
- Produces: 本页复选框、全选、分类和主题增量表单、所选标题确认、失败保留及成功重验。

- [x] 在现有浏览器测试中加入两项：多选/确认/请求/原查询重验；冲突/分页清选/过期卸载。
- [x] 先构建并运行 `node --test apps/web/tests/reader-private.test.ts`，观察缺少批量选择入口失败。
- [x] 实现原生控件与范围确认，防重入，版本随选择提交；页面边界变化或显式刷新清选。
- [x] 重新构建并运行上述测试，全部通过。
- [x] 运行 typecheck、完整后端测试、web构建和全部web测试；更新本机服务后 smoke，并在真实书库用1440/390/320宽度只读检查，不提交真实批量修改。
- [x] 写明本页范围、原子冲突、保留数据及验证结果，提交功能与文档；进行一次独立只读整体审查并处理重要发现。
