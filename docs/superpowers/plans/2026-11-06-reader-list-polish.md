# Article List Polish Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking. Repository authorization and scope rules take precedence over generic commit or full-suite steps.

**Goal:** 完成已确认的五项文章列表优化并验证本机运行版本。

**Architecture:** 筛选目标从 React Router 在途 URL 派生，保留现有已完成查询作为结果展示依据。局部调整桌面样式和空结果恢复操作，复用既有假 API 和浏览器回归。

**Tech Stack:** Node.js 24.22.1、React 19、React Router 8、Vite、Playwright。

**Spec:** [设计与验收边界](../specs/2026-11-06-reader-list-polish-design.md)。

## Global Constraints

- 桌面验收；不新增依赖、迁移、来源、权限或付费调用。
- 测试清除真实凭据与代理，使用假 API 和隔离 web；生产构建在服务切换前保留。
- 不提交或推送；原工作区若出现并行修改，仅整合本次文件中的明确变更。
- 保留现有输入法、防抖、日期草稿、无 JS、历史与分页语义。

## Review Focus

- 在途 URL 不得覆盖完成后的新输入；搜索防抖闭包不能持有过时来源/日期。
- 侧栏类别、主题、日期、来源行、清条件及分页须一致保留在途条件。
- 空结果恢复仅移除目标条件；日期恢复及 limit 不被清除。
- 吸顶工具栏不得遮挡 Tab 焦点、日期浮层或恢复的文章链接。
- 本机 API 与 web 都加载当前版本；不执行采集、迁移或重复启动 worker。

### Task 1: 连续筛选状态

**Files:** 新增 `apps/web/app/features/feed/useReaderQuery.ts`；修改 `ReaderFilters.tsx`、`ReaderNavigation.tsx`、`ReaderDatePicker.tsx`、`ReaderPage.tsx`、`ReaderPagination.tsx`；测试 `apps/web/tests/reader-public.test.ts`。

**Interfaces:** `useReaderQuery(query: Record<string,string>): Record<string,string>` 返回最新在途首页条件或原 query；现有 `readerLink` 继续负责单项修改与清 page。

- [x] 在所属测试文件添加受控慢响应连续筛选、请求完成时输入保留用例，确认原实现失败。
- [x] 让构造导航目标的调用方使用最新在途条件；搜索提交读取最新条件，完成旧请求时保留之后的输入。
- [x] 运行新增用例与原搜索/日期/分页/历史回归；预期全部通过。

### Task 2: 列表布局与空结果

**Files:** `apps/web/app/app.css`、`ReaderFilters.tsx`、`ReaderNavigation.tsx`、`ReaderPage.tsx`、`ReaderPagination.tsx`、`apps/web/tests/reader-public.test.ts`。

- [x] 添加来源/关键词空结果恢复回归；在现有桌面工具测试补吸顶操作与焦点遮挡检查，确认原实现失败。
- [x] 桌面列表外侧顶部 padding 28→16px，行 padding 24→16px，摘要间距 8→6px，元信息间距 12→8px，主题上距 20→8px；保留字号。
- [x] 搜索/来源/日期栏吸顶，测量实际高度留出焦点滚动空间；空结果新增两个独立恢复链接。
- [x] 核对 README 对应段落；类型检查、web 构建、reader-public 与 page-width 测试通过，并检查 Chrome 桌面默认/深色/缩放/滚动交互。

### Task 3: 整合与本机生效

**Files:** 本次变更文件及 `docs/deploy.md` 中相关更新说明。

- [x] 独立只读审查本次未提交 diff，修复发现的有效问题并执行必要回归。
- [x] 重新核对原工作区变更与服务归属，将本次变更整合回原工作区；保留旧 web 构建供回退。
- [x] 同步验证过的 web 构建，重启需要加载当前代码的本机 API/web；不切数据库、不启动额外 worker。
- [x] 服务就绪后 smoke，Chrome 实测 4040 连续筛选、密度、吸顶、空结果及已有零值/点击范围改进；检查 diff 后交付。

## 本次验证

- `npm run typecheck`、`npm run build -w @agidawn/web` 通过；`node --test --test-timeout=120000 apps/web/tests/reader-public.test.ts apps/web/tests/page-width.test.ts` 67/67 通过。测试使用清空继承凭据与代理的环境、假 API 和隔离 web。
- 新用例先确认旧实现失败；独立审查发现的“日期请求在途时重开面板”问题也先复现，再改为从在途日期初始化，回归通过。
- Chrome 156 在 1280×800 下完整显示四篇；核对浅色、深色、125% CSS zoom 布局、日期浮层、键盘焦点与空结果恢复。4040 上人为延迟搜索后切来源，关键词和来源均保留；两个空结果操作各只清除一个条件。
- 2026-11-06 同步 12 个任务文件，构建 48 个文件逐一校验。原 API/web 已重启，worker 进程保持；`node scripts/smoke.ts --base http://localhost:4040` 全部通过。
- 旧构建保存在原工作副本 `.data/deploy-backups/reader-list-20261106-140804/previous-web-build`。未执行迁移、采集或付费请求，未提交或推送 Git。
