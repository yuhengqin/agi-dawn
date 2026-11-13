# 文章完整性与显示修复计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 2026-11-13 Chrome 审查确认的 17 类问题，恢复受影响存量文章，并逐篇复查全部公开文章。

**Architecture:** 在内容第一次丢失的边界修复来源组件及清洗规则；展示问题沿用统一公开读取路径。存量维护按文章 ID、正文版本和原文条件定向执行，复用正文修订、快照、资源归档与翻译回执机制。

**Tech Stack:** Node.js 24.22.1、TypeScript、Fastify、PostgreSQL 17、React Router、Playwright 驱动的 Google Chrome。

**Spec:** 用户本轮要求，以及私有 `.data/verification/article-audit-2026-11-13/findings.json` 中 confirmed 的 F01–F11、F13–F18；F12 尚未确认，单列核实，不将其混入已修复声明。

## Global Constraints

- 只针对桌面浏览器；不新增来源、不改变分类、全文许可或公开部署范围。
- 不提交、推送或发布。保留已有工作；当前开发副本供 3000 使用，API/worker/4040 服务归属已核对。
- 真实库为本机 55432 的 reader_dev，资源为当前副本 .data；写入前完成同组备份。测试使用独立可丢弃测试库及清理过的环境。
- 保留历史快照、私人资料、人工覆盖与旧阅读位置；新正文走版本检查，不以直接覆盖绕过修订。
- 付费翻译仅处理本次明确受影响的文章，经既有预算及回执；已完成片段尽量复用，不重发未知计费请求。
- 公共媒体读取必须检查当前文章权限、当前快照与候选身份，使用 no-store，出站沿用 SSRF、重定向、超时和体积检查。

## Review Focus

- 不能把一般 hidden 内容全部展开；只转换已确认的正文标签页、KaTeX/ARIA 表格及来源组件。
- 恢复公式必须保留上下标、根式和分式含义，不能直接扁平化 KaTeX 文本。
- 脚注恢复须有当前正文内的目标及回链证据，跨文章链接不改写。
- 混合译文保留原文，准确标为不完整；代码、专名和正常引用不能被误删。
- 媒体 Range、错误 MIME、失效快照、许可撤回和重定向拒绝都需回归，不能构造任意 URL 代理。

## Task 1 根因与最小样本

**Files:** 现有 content、reader translation/archive、公开详情与相关测试；诊断产物仅写私有 verification 目录。

- [x] 核对工作区、服务、数据库与资源归属。
- [x] 读取当前原文、译文、运行时来源配置，与旧 Chrome 证据比较。
- [x] 对关键来源取得原始 HTTP 或完整 Chrome DOM，确定第一次丢失的阶段。
- [x] 为每个已确认机制提取最小代表结构，先运行相应失败回归。

## Task 2 恢复正文与组件

**Files:** `packages/backend/src/content/{components,pipeline,technical-markup,extract}.ts`、必要的来源适配器及配置校验、`industry/sources.json`、现有组件/来源/流式正文测试。

**Interfaces:** 继续输出 `ExtractedBody` 和清洗 HTML；新增来源规则同时核对校验、模板与运行配置，禁止重复 seed。

- [x] F01：识别客户端空正文壳，拒绝把简介判为完整正文；本次用已核实的完整公开 DOM 恢复存量。
- [x] F02：规范真实代码行与 prompt 组件，保留换行、缩进、语言，不混入行号和控件。
- [x] F03：将明确声明的 ARIA 表格转换为原生表格，校验行列、嵌套及可见性。
- [x] F04：根据可信数学表示恢复公式；明确覆盖分式、根式和上下标。
- [x] F05：来源适配规范正文媒体列，避免 Readability 的负类名权重删除图片与说明。
- [x] F06：在候选评分前规范 Ghost bookmark，保留作者前后评论。
- [x] F13：只将已识别、绑定标签与面板的正文组件展开成顺序章节。
- [x] 对原始样本比较提取前后字符、pre/table/img/math 和实际文本，不以数量单独判定成功。

## Task 3 阅读显示与翻译质量

**Files:** `content/{presentation,outline,sanitize,video}.ts`、来源适配器、`modules/reader/translation/`、图片正文/查看器与导出样式；现有 presentation、native-video、translation、web 阅读测试。

- [x] F07/F09：对照同版本原文核实未译段和标题污染；补输出校验及存量精确恢复，保留合法 JSON、代码和专名。
- [x] F08：保存受约束的脚注身份，并恢复历史成对脚注与回链；当前页面内往返验证。
- [x] F10：只清理已核实 Substack 模板推广、同文分享和尾部空状态。
- [x] F11/F14：保留来源图像深底语义；只选择已确认互斥的桌面/主题变体。
- [x] F15：目录文本单次解码，章节 ID 和正文不变。
- [x] F16/F18：在重解析前规范视频 fallback，使用原节点中真实海报，清理旧的确定兜底文案。

## Task 4 受约束的视频读取

**Files:** `modules/reader/archive/`、`modules/reader/server.ts`、现有公开资源及 HTTP 测试。

**Interfaces:** 媒体 URL 只包含 article/snapshot/候选哈希；不接受客户端任意地址。现有离线 ZIP 仍按其图片归档契约处理视频。

- [x] F17：为已保存快照中的视频/海报提供绑定读取入口，复用 guardedFetch。
- [x] 实现并验证单 Range、Content-Range、MIME、长度限制和出站失败行为。
- [x] 回归无权限、人工下架、许可撤回、旧快照及条件请求，不以缓存绕过检查。

## Task 5 存量恢复与交付

**Files:** 必要的定向维护脚本、部署/来源/阅读说明；证据写新的私有验证目录，不改写旧验收。

- [x] 停止已核对归属的写入服务，完成数据库与资源同组备份，保留恢复路径。
- [x] 预览受影响文章及版本，修订正文、归档新图片、按需复用/补齐对应译文；记录审计。
- [x] 恢复服务并确认 API、worker、3000/4040 就绪。
- [x] `npm run typecheck`、完整 standalone、隔离数据库回归、web 构建及 web 测试；失败明确分类与处理。
- [x] Chrome 逐篇打开并滚读全部公开文章，对 17 类问题逐条验收，补视频、脚注、明暗及桌面窗口检查。
- [x] 核对私人资料与旧快照摘要不变，检查 diff、新文件和文档命令，交付逐篇结果及剩余限制。
