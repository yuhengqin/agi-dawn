# 文章数字分页实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在独立 `codex/article-pagination` 分支实现带总数、任意跳页和每页 25 / 50 / 100 篇选项的传统分页。

**Architecture:** 普通文章接口使用 `page` 与 `limit`，返回 `{items,total,page,limit,pageCount}`；默认第一页、每页 25 篇。一次 PostgreSQL 语句从同一可见结果集计算总数与分页，保持时间和 ID 倒序，越界页码归到末页；空结果为 page=1、pageCount=0。网页提供原生链接与 GET 表单，保留筛选及页面大小，筛选或大小变化时回第一页；浏览器历史继续负责列表与正文位置恢复。

**Tech Stack:** Node.js 24.22.1、PostgreSQL、TypeScript、React Router、Tailwind、Playwright。

**Spec:** 本次用户要求：新分支和 worktree、传统分页、总数、任意跳页、25 / 50 / 100 三档。默认 25、越界回末页为本次实现选择。

## Global Constraints

- 全部改动在 `/home/laoq/.codex/worktrees/article-pagination/AGIDawn`，原目录已有未提交改动保持不动。
- 前端只通过 HTTP 读取公开 publication 层，不触发采集、模型或推送。
- 仅退休普通文章列表 cursor 机制；私人书库和采集 cursor 保持各自契约。
- 不改历史迁移、依赖、锁文件、规则文件或已有用户数据。
- 25 / 50 / 100 是完整允许集；默认 25。页码为安全正整数。
- 小屏导航保持可点，提供总页数、跳转和页面大小；页数不足不制造无效导航。

## Review Focus

- 组合筛选及全文权限同时影响 items 和 total，不泄露撤回或未允许全文的搜索命中。
- 并列时间戳、数据库微秒精度和任意跳页排序保持一致。
- 空结果、末页、超大合法页码与非法数字参数均有明确结果。
- 筛选、大小切换、旧主题/来源重定向与浏览器后退保留正确 URL 和位置。
- 页码链接、GET 跳页与无 JavaScript 大小切换可用，320px 和深色外观不溢出。

## Task 1: 查询契约和数据库分页

**Files:** `packages/contracts/src/site.ts`、`packages/backend/src/publication/pool.ts`、`apps/api/src/routes/site.ts`、`tests/reader-query.test.ts`、`tests/query-nul.test.ts`。

**Interfaces:** `ReaderListQuery` 使用 page/limit，`ReaderListPage` 返回 items/total/page/limit/pageCount；共享 `READER_PAGE_SIZES` 定义三个选项。搜索容量限制和正在进行的重复请求共享机制保留，键包含完整筛选、页码和大小。

- [x] 在已有查询测试中替换游标遍历为数字分页，增加总数、直接跳末页、越界、三种大小、无结果及非法参数行为断言，并观察失败。
- [x] 实现接口和同语句计数/查询，移除普通列表签名游标代码与依赖。
- [x] 运行查询、权限、搜索共享与 API 参数相关测试，确认新分页及现有隔离规则。

## Task 2: 页面导航与 URL

**Files:** `ReaderPage.tsx`、新增同目录 `ReaderPagination.tsx`、`reader.server.ts`、`ReaderNavigation.tsx`、`ReaderFilters.tsx`、`ReaderDatePicker.tsx`、`packages/contracts/src/http-policy.ts`、已有网页及重定向测试。

**Interfaces:** 沿用 `/` 查询地址，分页链接保留全部筛选；筛选链接和 GET 表单去掉旧 page，保留 limit。大小切换去掉 page，跳页表单保留筛选与 limit；API 规范化越界页后网页重定向到实际页。当前位置写入文档标题。

- [x] 更新公开列表 fixture，在现有 reader-public 浏览器测试加入总数、数字翻页、跳页、大小切换、刷新/后退与筛选重置，先运行确认功能缺失。
- [x] 实现分页组件、loader 越界规范化与筛选/重定向同步；保持网站现有样式、焦点提示和原生无脚本操作。
- [x] 构建后运行定向浏览器测试，覆盖 Chromium/WebKit、手机/桌面及无脚本操作。

## Task 3: 验收与交付

**Files:** `README.md`、`docs/architecture.md`、`docs/customize.md`、`docs/deploy.md`、相关阅读站验收说明。

- [x] 更新当前分页契约和升级说明；历史验收明确标记已被本次分页替代。
- [x] 运行 typecheck、隔离 reader_pagination_test 后端全套测试、生产构建及网页全套测试。
- [x] 在隔离预览服务进行 smoke 与实页截图检查，覆盖组合筛选、末页、页面大小和任意跳页。
- [x] 独立只读代码审查，处理有证据的问题，核对 git diff 与需求后提交本分支；保留 worktree 供用户检查。

## 验证记录

- 基线：typecheck 通过；原 reader-query 测试 4/4 通过。
- 环境：使用现成 npm 缓存的 Node 24.22.1；系统 pg_dump/pg_restore 是14，需要为完整备份测试使用17客户端。
- 使用原目录已有PostgreSQL17工具和curl_cffi Python，未更改依赖。完整后端605项、类型检查、生产构建、浏览器定向4项和隔离预览smoke均通过；完整网页93项全部通过。
