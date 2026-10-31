# 私人书库命名视图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 持久保存并管理关键词和五种筛选条件，打开时实时查询，删除不动文章或私人资料。

**Architecture:** 复用书库条件schema与目录校验，reader模块新建单表与管理员CRUD；书库组件局部加载和管理视图，不加入必需loader。

**Tech Stack:** Node24.22.1+、PostgreSQL17、TypeScript、React Router、Playwright。

**Spec:** `docs/superpowers/specs/2026-10-29-saved-reader-views-design.md`

## Global Constraints

- 继续Linux隔离工作树codex/article-reader，仅本机，不推送或公开上线。
- 六条件：q/sourceId/category/topic/starred/status；不存cursor、limit或文章ID。
- 名称trim后1–60字符、唯一、无NUL/换行；版本检查、写入与审计同事务。
- 单条CREATE TABLE模块迁移，无依赖/环境变量/数据回填；测试只连隔离库与本地假源。
- 删除仅该视图行；文章、笔记、状态、分类主题、正文归档不变。

## Review Focus

- 未应用表单草稿或旧分页游标不得被保存/更新到视图。
- 创建/修改后目录刷新失败不得误报保存失败、丢其他草稿或触发重复写入。
- 重名、并发改名/条件更新/删除，以及审计失败，必须保持原记录或整笔提交。
- 缺失引用不得静默放宽条件，目录名称变化不得改变身份。
- 打开视图须清旧分页及本页批量选区；视图故障不影响文章查询，会话失效不残留私人视图。

### Task 1: 视图数据与管理员API

**Files:** 新增 `modules/reader/migrations/0102_reader_saved_views.sql`、`modules/reader/views.ts`；修改 `state.ts`、`contracts.ts`、`server.ts`；扩充 `modules/reader/tests/privacy.test.ts`。

**Interfaces:** `ReaderViewQuery`六个可选字符串字段；`SavedReaderView={id,name,filters:ReaderViewQuery,version,createdAt,updatedAt}`；GET/POST `/api/admin/reader/views`、GET/PATCH/DELETE `/api/admin/reader/views/:id`；PATCH允许name或filters，DELETE仅expectedVersion。

- [x] 扩充privacy测试：CRUD/六条件/新文章动态进入、无分页保存、删除保留业务数据；输入与鉴权；并发唯一名/CAS/审计回滚/无变化。
- [x] 运行 `node .data/phase4/run-backend.mjs modules/reader/tests/privacy.test.ts`（使用既有Node24/PG17 PATH）。Expected: 新API404，既有测试通过。
- [x] 实现单表、共用书库条件校验、CRUD与事务审计，稳定ID，无级联关系。
- [x] 运行privacy、typecheck及迁移检查。Expected: 全通过，0102为一条允许DDL。
- [x] 提交后端及测试，记录证据。

### Task 2: 书库内常用视图管理

**Files:** 新增 `modules/reader/components/SavedViews.tsx`；修改 `pages/library.tsx`、`apps/web/tests/reader-private.test.ts`。

**Interfaces:** 消费Task1类型和API；组件接收当前已应用query与目录filters；打开链接仅包含六条件。

- [x] 更新既有书库fakeAPI明确返回空视图；新增CRUD浏览器用例，以及冲突/刷新失败保留草稿/401卸载/缺失引用/分页排除。
- [x] 在旧生产构建运行新增web用例。Expected: 缺少常用视图入口失败。
- [x] 实现局部加载、名称表单、条件摘要、打开/改名、更新/删除确认与版本；失败局限于组件，48px控件。
- [x] 运行typecheck、生产构建与全部web测试。Expected: 全通过，原筛选和批量整理不回归。
- [x] 提交界面及测试，记录证据。

### Task 3: 审查、本机迁移与验收

**Files:** 更新README、部署说明、实施状态；新增 `docs/reader/phase4-saved-views-acceptance.md`；忽略目录保存证据。

**Interfaces:** 固定前两项代码进行独立只读审查和完整验证；真实CRUD仅针对本次临时视图。

- [x] 一次独立审查e58fa1e至最终代码，重要发现RED→GREEN修正并全量复验。
- [x] 完整后端、typecheck、web构建与全部web测试。Expected: 无失败/取消/跳过。
- [x] 核对服务归属、暂停、本地完整备份、业务表摘要，应用0102并更新API/web。
- [x] 真实HTTP及Chromium/WebKit1440/390/320px验证专属临时视图CRUD、动态打开、取消和会话失效；仅删除本次临时视图。
- [x] 比较旧业务表与视图清理后摘要，恢复worker/timer及loopback监听，完成smoke、文档与本地提交。
