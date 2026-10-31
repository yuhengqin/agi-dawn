# 阅读切换动效 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 返回顶部固定占位；专注开关与文章列表进入详情提供短淡化，并保持阅读与键盘上下文。

**Architecture:** 复用motion.ts中的减少动态效果入口与现有原生View Transitions，主题和专注共享同步DOM更新。列表链接启用当前React Router8.4已有过渡接口；root导航hook区分文章入口，保留其他页面现有行为。

**Tech Stack:** React19.3、React Router8.4、TypeScript、CSS、Playwright；无新依赖。

**Spec:** docs/reader/article-controls.md 的“阅读切换动效约定”。

## Global Constraints

- 180ms按钮显隐、200ms页面／专注淡化，正文原有位置和宽度不变。
- 减少动态效果时关闭动画，缺少View Transitions时状态与导航照常工作。
- 不改模型、采集、数据库、依赖和其他路由的导航方式。

## Review Focus

- 返回顶部隐藏时不可操作，显隐不改变工具栏的位置。
- 快速切换专注最终状态正确，保持正文与章节位置。
- 浏览器后退与前进继续恢复筛选、滚动；链接和标题焦点有连续性。
- 主题与路由过渡不串用动画标记，手机与电脑均可用。
- 无动画API、减少动态效果和无JavaScript时保留可用行为。

### Task 1: 阅读动效与验收

**Files:** `apps/web/app/lib/motion.ts`、`components/shell/{Chrome,ThemeSwitch,transitions}.tsx/ts`、`features/feed/ReaderPage.tsx`、`routes/item.tsx`、`app.css`、既有`apps/web/tests/reader-public.test.ts`及阅读文档。

**Interfaces:** 共享外观更新函数接收同步更新回调，负责功能检测、减少动态效果及同步提交；文章路由保持原HTTP契约。

- [x] 在既有历史导航测试补标题／原链接焦点与无API降级验证，运行并确认失败；保留专注与位置行为验证。
- [x] 固定返回顶部槽位并渐变显隐；共享外观过渡，接入专注；链接与导航hook启用文章淡化及焦点恢复。
- [x] 类型检查、构建、专项测试；Chrome核对参考、连续帧位置与动画、手机、减少动态效果及快速操作。
- [x] 独立审查，仓库／网页回归与本机smoke；更新文档与验证证据。

验证：类型检查、生产构建、专项8/8、仓库605/605、网页97/97、本机smoke通过。Chrome156逐帧与手机验收证据保存在`.data/reading-motion/`；完整验收记录见规格文档。
