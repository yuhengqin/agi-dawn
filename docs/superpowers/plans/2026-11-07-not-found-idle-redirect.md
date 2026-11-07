# 404 无操作自动返回首页实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 404 页面连续 8 秒无操作后自动返回首页。

**Architecture:** 在 NotFoundPage 中使用 effect 管理单一计时器，以 `performance.now()` 记录最近活动后的截止时间。活动重置 8 秒，后台页面停计时，恢复可见重新计时；使用 `location.replace('/')` 返回首页。

**Tech Stack:** React、Page Visibility API、Playwright Clock；不新增依赖。

**Spec:** 用户要求先提交当前 404 设计，再添加 8 秒无操作自动跳转。前一版已提交为 `5de768e`。

## Global Constraints

- 只在 404 组件挂载期间启用，不影响其他错误或普通页面。
- 鼠标、键盘、输入、焦点与滚动操作重置计时；隐藏时不跳转。
- 显示倒计时及本次取消入口；不逐秒向辅助技术播报。未启用 JavaScript 时仍保留原生搜索与导航，不显示自动跳转提示。
- 搜索提交或在当前窗口点击恢复按钮后停止计时，侧栏导航加载期间暂停，避免等待响应期间被自动返回首页覆盖；取消不改变搜索能力。
- 使用 Node 24.22.1、白名单环境、隔离构建及本地假 API；不切换常驻服务。

## Review Focus

- 从最近活动开始计时，8 秒边界前不跳转；返回首页后后退不回到 404 循环。
- 取消、标签页隐藏恢复、组件卸载和搜索响应等待均不遗留导航计时器。

### Task 1: 实现与验收

**Files:** `apps/web/app/components/NotFoundPage.tsx`、`apps/web/app/components/NotFoundPage.css`、`apps/web/tests/reader-public.test.ts`、`README.md`。

- [x] 先增加确定性时钟测试，核对空闲、活动重置、隐藏恢复、取消、搜索等待和离开页面，并确认旧实现失败。
- [x] 实现计时、倒计时与取消入口，更新说明。
- [x] 隔离运行类型检查、web 构建、受影响桌面 web 与 HTTP 回归；浏览器核对提示布局。
- [x] 独立审查与最终 diff 检查。

**Sources:** [MDN Page Visibility](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)、[Playwright Clock](https://playwright.dev/docs/clock)。本任务不累计页面总前台时长，使用当前可见状态与最近活动的单调时钟截止时间。

**Results (2026-11-08):** Node 24.22.1 下类型检查、web 构建通过；Chromium/WebKit 的 idle 回归 4/4、原有搜索及导航回归 4/4、HTTP 回归 12/12 通过。初次测试在旧实现中因无倒计时失败；审查发现的慢恢复导航覆盖问题也在两个浏览器中复现，加入导航暂停后通过。原生搜索和探索的挂起场景使用真实 9 秒等待，其他计时用 Clock，避免 Playwright 在挂起的文档导航期间不能可靠控制旧页面时钟的问题。另核对浅深色倒计时、取消后的稳定状态、1100px 桌面窗口下 125% CSS 页面放大及无脚本搜索。独立复审未发现新的可操作问题。构建仍有已知 `::highlight(article-search)` 优化器警告，未导致失败。
