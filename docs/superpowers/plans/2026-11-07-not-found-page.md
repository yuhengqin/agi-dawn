# 404 页面优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让公开 404 页面清楚说明情况，并提供继续浏览文章和探索主题的入口。

**Architecture:** 在现有根级 ErrorBoundary 内调整 404 分支的文案、字号和行动链接，沿用 SiteShell、颜色 token 与按钮组件。其他错误保留重试行为；不新增数据请求。

**Tech Stack:** React、React Router、Tailwind CSS、Playwright。

**Spec:** 本次会话已确认的简洁方案：保留侧栏与留白，标题约 30px、说明 16px，主按钮“浏览全部文章”到 `/`，次级链接“探索主题”到 `/explore`。

## Global Constraints

- 仅以桌面浏览器为设计与验收目标，不操作真实数据库或切换服务。
- 保留真正 HTTP 404、no-store、错误页元信息及非 404 重试。
- 本机服务正使用现有 build；构建和 web 验收在临时隔离副本进行。

## Review Focus

- 未知地址和文章不存在均提供可用的恢复入口。
- 鼠标与键盘可访问两个目的页；浅色、深色与桌面缩放均可读。
- 非 404 错误仍提供重新加载，不混入 404 的原因说明。

### Task 1: 调整页面并验收

**Files:** 修改 `apps/web/app/root.tsx`、`README.md`。

- [x] 修改 404 分支：30px 标题、16px 两段说明、大号主按钮和文字次级链接。
- [x] 在 README 公开导航说明附近同步 404 行为。
- [x] 隔离副本运行 `npm run typecheck`、`npm run build -w @agidawn/web`，以及受影响的桌面 web 测试。
- [x] 使用本地假 API 核对未知地址、文章不存在、非 404 重试、两条恢复路径与桌面截图。
- [x] 检查最终 diff 和 `git diff --check`；不提交或切换服务。

**Verification note:** 本次是局部文案、样式与简单导航调整，按仓库要求复用既有测试和浏览器验收，不新增仅锁定文案或样式的自动测试。

**Results:** Node 24.22.1 下类型检查和 web 构建通过；HTTP 回归 12/12、既有 Chromium/WebKit 导航回归 2/2 通过。双浏览器另核对直接访问及站内进入 404、鼠标与键盘恢复路径、503 重试恢复、浅深色和 1100px 桌面窗口下 125% CSS 页面放大；说明文字对比度分别约 5.70:1、7.99:1。独立静态审查未发现需修复问题。构建输出包含既有 `::highlight(article-search)` 样式的优化器识别警告，未导致构建失败。
