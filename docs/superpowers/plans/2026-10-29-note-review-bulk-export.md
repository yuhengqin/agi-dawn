# 私人笔记回顾与批量导出 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 先完成私人笔记回顾与原有筛选/命名视图组合，再完成本页多选笔记Markdown ZIP导出。

**Architecture:** 扩展书库现有条件schema、精确时间keyset查询和视图条件；在已有选区旁加入独立只读下载，服务端共用单篇格式并以一次只读快照生成ZIP。

**Tech Stack:** Node24、PostgreSQL17、TypeScript、Fastify、React Router、现有fflate、Playwright。

**Spec:** `docs/superpowers/specs/2026-10-29-note-review-bulk-export-design.md`

## Global Constraints

- 本机Linux工作树codex/article-reader；不推送、不公开上线。不改依赖、环境变量或迁移。
- hasNote空白语义明确；默认排序保留；新排序无笔记在后，相同时间稳定分页，保留数据库时间精度。
- 命名视图兼容缺少新条件的既有记录；仅保存已应用条件，不包含游标或页大小。
- 导出只读全部选中文章的服务端内容，使用单次一致性事务；不修改私人资料和审计，不自动保存草稿。
- 导航/结果或选区变化/会话失效后，迟到下载不得生效；不引入用户未请求的确认流程。
- 自动化只连隔离测试库和本地假源。

## Review Focus

- 关键词扫描及普通查询都按所选排序翻页，微秒时间和无笔记区间不丢项。
- 新字段完整进入查询、游标、命名视图摘要/相等性/更新/打开；旧视图语义保持。
- 片段是已保存纯文本；公开响应没有私人内容。
- ZIP当前元数据与笔记来自同一事务，每篇对应所选ID，缺失项不产生部分包。
- 下载与现有整理操作互不提交草稿，保存期间防重复；迟到响应和Blob URL生命周期正确。

### Task 1: 笔记回顾查询和视图契约

**Files:** reader `contracts.ts`、`state.ts`、`search.ts`、`views.ts`、既有privacy测试。

- [x] 添加笔记空白/片段/时间、原五筛选＋关键词交集、更新时间/默认排序、精确时间分页和搜索扫描测试；新视图条件与旧视图往返及更新回归。
- [x] 运行privacy测试，确认旧实现因不识别新条件/缺少字段失败。
- [x] 实现查询、游标及视图条件；运行privacy/typecheck后本地提交并记录证据。

### Task 2: 私人笔记回顾页面

**Files:** `pages/library.tsx`、`components/LibraryOrganizer.tsx`、`components/SavedViews.tsx`、既有reader-private网页测试。

- [x] 添加入口、笔记筛选/排序、片段时间、刷新/分页、命名视图组合与旧视图回归，旧构建确认失败。
- [x] 实现控件、快捷入口和纯文本片段，保持选择清理规则与命名视图草稿行为。
- [x] 类型检查、构建和相关web验证通过；本地提交并记录证据。

### Task 3: 本页批量笔记 Markdown ZIP

**Files:** `note-export.ts`、`server.ts`、`client.ts`、`components/LibraryOrganizer.tsx`、必要独立下载组件，以及privacy/reader-private既有测试。

- [x] 添加批量鉴权/CSRF/输入、ZIP与单篇一致、只读与缺失整包失败测试并确认失败。
- [x] 在一个只读一致性事务中复用格式读取所有文件，打包并返回。
- [x] 添加实际下载、仅选中ID、保留整理草稿、失败与重复点击、导航/重载/选区变化/过期后的迟到下载回归，旧构建确认失败。
- [x] 实现独立按钮及取消/失效保护；运行相关后端/web及类型、构建验证，本地提交并记录证据。

### Task 4: 独立审查与本机交付

**Files:** README、部署与实施状态、验收文档；忽略目录保存证据。

- [x] 固定代码一次独立只读审查，重要问题按失败复现修正。
- [x] 完整typecheck、后端、web构建/测试及迁移安全检查通过。
- [x] 核对并暂停服务、完整备份和原业务摘要，更新API/web，无迁移/seed。
- [x] 真实HTTP与Chromium/WebKit1440/390/320验收；已有私人资料只读，确认原业务摘要一致。
- [x] 恢复worker/timer、smoke、文档与本地提交，归档本计划执行记录。
