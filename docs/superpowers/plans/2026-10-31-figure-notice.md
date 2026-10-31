# 图表完整性提示 Implementation Plan

> 历史方案：旧菜单和单篇长期隐藏已由[文章阅读工具调整](../../reader/article-controls.md)替代，以下只保留实施记录。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将文章中的图表质量提示收成一行，并允许查看详情、访问原文、按文章或长期隐藏及恢复。

**Architecture:** 复用现有 Menu 与 local-state 存储订阅。逐篇隐藏使用独立存储键，避免标签页尚未收到 storage 事件时覆盖其他文章的选择。图表提示独立于其他正文质量问题，隐藏偏好只留在当前浏览器；阅读显示设置提供恢复入口。

**Tech Stack:** React、React Router、TypeScript、Tailwind、Node test、Playwright Chromium/WebKit。

**Spec:** 用户已在对话中确认下述设计并授权实施。

## 已确认设计

- 默认显示“部分图表可能显示不完整”，旁有始终可见的 ⋯ 和单色 ×。
- ⋯ 菜单依次提供“查看详情”“打开原文 ↗”、分隔线和“不再提示图表显示问题”；菜单项不带展开箭头。
- 详情原位展开，菜单关闭；× 直接隐藏本篇，刷新和再次访问保持。
- 长期隐藏适用于所有文章的图表提示，可在“阅读显示设置”中恢复全部图表提示（包括逐篇隐藏）。
- 显示偏好与其他阅读偏好一样存入浏览器，同源标签页同步；存储受限时在当前标签页生效并说明无法记住。

## Global Constraints

- 不增加依赖、后端接口或数据库状态；公开数据仍由原有 HTTP 接口读取。
- 仅隐藏 `missing-figure` 提示，不影响公式、正文截断等其他质量说明。
- 菜单支持键盘进入、方向键、Home/End、Esc、焦点恢复与外部点击关闭，窄屏不得溢出。
- 测试放入已有 `apps/web/tests/reader-public.test.ts`，只连本地假 API。

## Review Focus

- 隐藏文章 A 后文章 B 仍提示；长期隐藏后全部图表提示消失。
- 恢复后当前文章及其他标签页重新提示；其他正文质量提示保持可见。
- 菜单打开不依赖悬停，原文链接保留真实 href 及新标签行为。
- 刷新、损坏存储及存储拒绝不导致页面报错；文章数据不因偏好修改而写入。
- 桌面与 320px 手机视口可操作菜单、详情和恢复设置。

## Task 1: 提示菜单与浏览器偏好

**Files:** 修改 `components/ui/Menu.tsx`、`lib/local-state.ts`、`features/item/ReadingDisplay.tsx`、`routes/item.tsx`；新增 `features/item/FigureNotice.tsx`（均位于 `apps/web/app/`）；扩展 `apps/web/tests/reader-public.test.ts`；更新 README。

- [x] 编写并运行图表提示浏览器测试，在旧实现复现缺少一行提示及操作入口。
- [x] 完成 Menu 的键盘、焦点和链接支持，复用存储通知实现图表隐藏偏好。
- [x] 接入图表提示与阅读设置恢复；保留其他质量问题的独立说明。
- [x] 运行定点测试、类型检查、后端测试、网页构建与全套浏览器测试、smoke。
- [x] 独立只读审查并处理发现，记录最终验证结果。

## 验证记录

- 新增用例在旧实现的 Chromium/WebKit 下均失败，原因是缺少一行提示及操作入口；实现后两项通过。
- 独立审查指出逐篇隐藏列表在跨标签事件延迟时可能被整体覆盖。新增双标签延迟事件用例在两个引擎均复现文章 A 的隐藏丢失；改用逐篇独立键后通过，未增加锁或重试。
- 使用本机 Node 24.22.1，类型检查、网页构建通过；图表提示及私人继续阅读定点 4/4 通过。
- 后端首轮 590/603 通过，13 项备份/恢复失败均有 pg_dump14 与服务端17版本不匹配证据。使用已有 PG17.11 工具及 Node24.22.1 重跑完整 `npm test`，603/603 通过，0失败/跳过/取消。
- 网页首轮完整 92/93 通过；既有 WebKit 私人继续阅读用例在历史页 Router 初始化时超时，定点复跑通过。最终完整回归仍为 92/93，失败项为既有 `outline keyboard scrolling stays inside its boundary in WebKit`，同样在 `visit` 等待 Router 初始化时超时；该项独立复跑 1/1 通过。未修改这两个用例或其断言，未确定偶发初始化超时根因，不将定点通过表述为整套全部通过。
- 本机网页服务已重启，`smoke` 全部通过；真实 A2UI 文章在1440×1000、390×844、320×844和320×420验证菜单、键盘、详情、本篇隐藏、长期隐藏与恢复。无横向溢出或页面脚本异常，原文只核对链接，测试浏览器拦截业务写请求和外部媒体请求。
- 日志保存在 `/tmp/agidawn-figure-*.log`，浏览器验收截图保存在忽略目录 `.data/figure-notice-acceptance/`，不提交私有配置或二进制产物。
