# Reader Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 自动翻译新收录的外文正文，在普通文章页切换中文与原文。

**Architecture:** reader 模块接收新文章资格和正文捕获事件，保存待处理输入，由模块排程调用模型。公开读取层在原有全文门禁中装配译文，前端沿用正文和目录组件。

**Tech Stack:** Node.js 24.22.1、TypeScript、PostgreSQL、现有 paidRequest、React Router。

**Spec:** `docs/superpowers/specs/2026-10-29-reader-translation-design.md`

## Global Constraints

- 不补译部署前文章，不修改私人快照或阅读位置。
- 模型仅在 worker 发起，密钥不出后端；严格开关、付费回执和预算不可绕过。
- 不修改依赖或历史迁移；新表属于 reader 模块。

## Review Focus

- 旧文章重发或重新发布不能新获翻译资格。
- 原文在模型回答期间变化，旧答案不得显示为新正文译文。
- 已收到回包后业务保存失败，应复用回执。
- 来源撤销全文许可时不得暴露已存译文及图片。
- 预算等待和未知回执不得耗尽内容重试或导致重复计费。

## Task 1: 自动翻译与持久状态

**Files:** `modules/reader/translation/{body,model,index}.ts`、`modules/reader/migrations/0104_reader_translations.sql`、`modules/reader/tests/translation.test.ts`、`modules/reader/server.ts`、`packages/backend/src/{modules,content/materials}.ts`。

- [x] 写本地假模型行为测试并确认缺少功能时失败。
- [x] 新增 articleCreated hook 和资格记录；正文事件只更新已有资格。
- [x] 实现保护 HTML 的翻译算法、回执请求、版本条件提交和 pending 排程。
- [x] 验证资格、幂等、开关、预算、部分翻译及并发修订。

## Task 2: 公开读取和语言切换

**Files:** `packages/backend/src/{modules,publication/detail}.ts`、`packages/contracts/src/site.ts`、`modules/reader/archive/assets.ts`、`apps/web/app/routes/item.tsx`、`apps/web/tests/reader-public.test.ts`。

- [x] 增加独立译文视图字段，保留原文字段及全文门禁。
- [x] 对译文使用相同原文快照的本地资源重写。
- [x] 默认中文、原文切换、对应目录和不完整提示。
- [x] 用公开接口和 Chromium/WebKit 验证，无新增业务写入。

## Task 3: 配置、部署和验收

**Files:** `.env.example`、`scripts/init-reader-translation.ts`、`scripts/retire-reader-state.ts`、`README.md`、`docs/deploy.md`、`docs/reader/translation-acceptance.md`。

- [x] 增加安全默认配置和保留人工预算的显式初始化脚本。
- [x] 更新退休脚本与说明，保留翻译使用的 llm 预算。
- [x] 运行 typecheck、npm test、web build、web tests、smoke。
- [x] 应用新增迁移及预算，安全写入既有模型配置，重启本机服务并核对排程与旧文章未排队。
