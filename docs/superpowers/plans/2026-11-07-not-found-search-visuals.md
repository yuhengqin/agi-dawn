# 404 图形、搜索与按钮交互实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按用户指定参考重新设计 404 页面，加入可用的文章搜索与邮件联系入口。

**Architecture:** 将 404 内容提取为独立组件及局部 CSS；根 ErrorBoundary 保留其他错误分支。搜索使用原生 GET 表单提交至首页的 `q` 参数，联系邮箱复用 `SITE.contactEmail`。

**Tech Stack:** React、React Router、CSS、Playwright；不新增依赖。

**Spec:** 本次用户请求：借鉴 random404 的斜切圆形数字、particles404 的按钮滑入换色；加入搜索框；使用“糟糕！找不到这个页面！”及指定两段说明、两个按钮、邮件文案和地址。

## Global Constraints

- 桌面浏览器为设计和验收目标，保留侧栏、站点配色与字体。
- 数字使用静态 404；两个按钮的覆盖层从相反方向滑入，键盘聚焦同样有反馈，减少动态效果时关闭过渡。
- GET 搜索仅提交用户输入的 `q`，不继承失效链接中的旧筛选；输入期间不导航，无 JavaScript 时仍可提交。
- 保留真实 404、no-store、错误页元信息和非 404 重试；不操作真实数据或切换服务。
- 使用 Node 24.22.1、白名单环境、隔离副本构建及本地假 API 验证。

## Review Focus

- 中文、空格及 `&` 等字符通过回车和搜索按钮正确到达文章列表。
- 未知地址和失效文章均提供搜索及两个可用导航入口；非 404 不引入搜索。
- 图形不遮挡文字、无外部字体或脚本依赖；浅深色、窄桌面和页面放大后仍可用。
- 邮件入口仅打开用户指定的 mailto，不自动发信。

### Task 1: 实现与验证

**Files:** `apps/web/app/components/NotFoundPage.tsx`、`apps/web/app/components/NotFoundPage.css`、`apps/web/app/root.tsx`、`site/site.ts`、`apps/web/tests/reader-public.test.ts`、`README.md`、`docs/customize.md`。

- [x] 在既有桌面 web 测试中先验证错误页搜索的回车、按钮提交和恢复路径，并确认旧实现失败。
- [x] 实现斜切数字、原生搜索、指定文案、相向滑入换色按钮与邮件入口；同步配置及说明。
- [x] 隔离执行类型检查、web 构建、错误页搜索与既有导航/HTTP 回归。
- [x] 浏览器核对浅深色、按钮鼠标/键盘状态、减少动态效果、无脚本搜索和桌面截图。
- [x] 独立审查及最终 diff 检查。

**References:** [random404](https://joashp.github.io/404-pages/random404.html)、[particles404](https://joashp.github.io/404-pages/particles404.html)。已通过在线源码与浏览器截图核实；沿用图形和交互构成，使用现有站点 token 与真实文本。

**Results:** Node 24.22.1 下类型检查与 web 构建通过；HTTP 回归 12/12，错误页搜索及既有导航回归 4/4（Chromium/WebKit）通过。新增搜索回归在旧实现中因缺少搜索框失败，加入实现后通过。另在两个浏览器核对 1440px 浅深色、相反方向的 300ms 覆盖层、键盘焦点、减少动态时零过渡、无 JavaScript 的 GET 搜索、1100px 桌面窗口的 125% CSS 页面放大，以及非 404 重试保留查询参数后恢复。独立静态审查未发现可操作问题。基线构建和新构建均有既有 `::highlight(article-search)` 优化器警告，未导致失败；未切换常驻服务。

**Separate observation:** Chromium 直接打开带 `#chapter` 锚点的 503 页面时，重试链接的实际 DOM `href` 未保留锚点。该重试目标表达式与本次修改前一致；本次仅记录此既有行为，未修改或宣称已验证锚点恢复。
