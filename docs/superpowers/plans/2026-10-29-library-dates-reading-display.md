# 日期筛选与阅读显示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 先完成私人书库日期筛选，再完成可记忆的阅读显示设置。

**Architecture:** 扩展现有书库查询、游标绑定和视图 JSON；显示偏好复用浏览器外观层，作用于文章布局和正文。主代理实现，有界只读调查和最终独立审查辅助。

**Tech Stack:** Node.js 24、PostgreSQL 17、TypeScript、React Router、React、现有 Tailwind/CSS、Playwright Chromium/WebKit。

**Spec:** `docs/superpowers/specs/2026-10-29-library-dates-reading-display-design.md`

## Global Constraints

- 本机 Linux，不公开上线；保留真实书库，不新增依赖或迁移。
- 日期北京时间、包含两端日期；快捷范围包含今天，命名视图保存固定起止值。
- 私人数据保持认证／CSRF／版本控制，批量操作只处理本页所选。
- 排版只存浏览器，普通与两种私人正文共享，条款不受影响。
- 自动测试仅用隔离测试数据库与本地假 API。

## Review Focus

- 上海午夜及结束日最后一微秒：日期筛选既不漏也不多一天。
- 空白笔记、只有上界的笔记日期：不让无笔记文章混入。
- 日期变更与旧游标、旧命名视图：拒绝串页且旧视图可打开。
- 禁用／损坏浏览器存储与跨标签：合法样式、可用控件和准确保存提示。
- 已滚动阅读后改变排版：保持章节比例，不因布局滚动误写位置。

### Task 1: 日期查询与命名视图后端

**Files:** `modules/reader/contracts.ts`、`state.ts`、`views.ts`、`tests/privacy.test.ts`。

**Interfaces:** 扩展 `ReaderViewQuery` 和 `readerViewQueryKeys`，增加 `dateField`、`dateFrom`、`dateTo`；复用 `isValidDate`、`beijingMidnight`。

- [x] 在现有 privacy 测试加入边界、验证、组合搜索／分页／两种排序、游标和视图往返断言，运行确认因缺少日期功能失败。
- [x] 实现字段校验、范围验证、SQL过滤、游标绑定和视图规范化；空日期不产生约束。
- [x] 运行 privacy 测试和 typecheck，确认通过；提交此任务。

### Task 2: 日期筛选界面与现有工作流

**Files:** `modules/reader/pages/library.tsx`、`components/LibraryDates.tsx`、`components/SavedViews.tsx`、`apps/web/tests/reader-private.test.ts`。

**Interfaces:** 消费 Task 1 字段，原 GET form 提交；快捷操作只修改日期草稿。

- [x] 在现有浏览器测试加入快捷范围、应用／刷新／翻页、视图固定日期、批量预览保存后保留日期断言；构建并运行确认失败。
- [x] 实现带标签的原生日期控件、日期依据、快捷与清除日期，补齐视图描述与帮助。
- [x] 构建并运行目标浏览器测试，两引擎与320／390／1440宽度无横向溢出；提交此任务。

### Task 3: 阅读显示与位置配合

**Files:** `apps/web/app/lib/local-state.ts`、`features/item/ReadingDisplay.tsx`、`features/item/ArticleBody.tsx`、`routes/item.tsx`、`components/ui/Page.tsx`、`app.css`、`modules/reader/components/SnapshotReading.tsx`、`useReadingPosition.ts`、`pages/article.tsx`、`pages/snapshot.tsx`，以及现有 `apps/web/tests/reader-private.test.ts`、`reader-public.test.ts` 和适用的本地外观测试。

**Interfaces:** 合法排版偏好 getter/setter/hook、文章专用 CSS 变量／属性；布局变化协调不改变服务端阅读位置契约。

- [x] 先写浏览器行为测试，验证三入口、记忆／同步／重置／坏值／拒绝存储、继续阅读后重排与草稿保留；运行确认失败。
- [x] 扩展现有外观存储、首屏应用和通知；增加可折叠控件与文章作用域样式，外层布局使用选定宽度。
- [x] 协调私人排版前后当前章节位置，排版本身不写阅读位置；不重建正文。
- [x] 构建并运行目标测试与typecheck，提交此任务。

### Task 4: 整体验证与本机交付

**Files:** README、`docs/reader/implementation-status.md`、新验收文档、上述计划进度。

**Interfaces:** 消费前3项完整实现；不新增产品功能。

- [x] 对固定代码状态执行 typecheck、后端全套、web build＋全套测试和迁移检查，读取全部结果。
- [x] 一次独立正确性／并发／契约审查，按证据修复重要问题并验证。
- [x] 在本机更新 API／web 服务并 smoke，读取真实书库验证日期查询（只读），确认私人资料及既有服务保留。
- [x] 记录检查数量、日期语义、浏览器偏好与备份边界；更新用户文档与计划，提交并给出使用入口。
