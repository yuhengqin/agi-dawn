# Phase 4 Restore Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to execute task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 在本机Linux证明新版完整备份可恢复私人资料及阅读/导出能力，原书库保持。

**Architecture:** 原库配套备份→隔离准备库/资源→准备非空私人验收资料→新版配套备份→第二个空库/资源→真实API/web与浏览器验收。

**Tech Stack:** Node24、PostgreSQL17、现有pg_dump/pg_restore/tar、Fastify/React Router、Playwright、fflate。

**Spec:** `docs/superpowers/specs/2026-10-29-phase4-restore-design.md`

## Global Constraints

- 不公开上线、不推送，不改.env、依赖、迁移或业务功能；保留原checkout及reader_dev。
- 准备库与恢复库必须是本次新建、本机、唯一命名且以_test结尾；资源目录在本次0700运行根下。
- 样本只在准备库写，最终库验证已恢复资料，不能以事后写入代替恢复。
- 隔离进程白名单环境，采集、模型、所有通知及IndexNow关闭，无worker；浏览器阻止外网。
- 暂停当前worker及两个timer后记录和比较业务摘要，最终恢复它们原有状态。
- 凭据仅环境传递，pg_restore参数不含密码；真实资料及截图只留忽略目录。

## Review Focus

- URL、库名、端口与资源路径隔离，任何清理不得命中原库/原目录/原服务。
- source→备份→restored的笔记文本/版本/时间、状态、视图条件、正文位置身份与资源一致。
- 图片来自恢复目录；正文ZIP离线不依赖原库、原资源或外网。
- 浏览器恢复位置不创建新位置；导出与搜索不写私人记录，草稿不入导出。
- 故障或中断时隔离子进程关闭，原服务恢复；已有备份和恢复副本保留。

### Task 1: 补强隔离恢复回归

**Files:** `modules/reader/tests/backup-restore.test.ts`。

- [x] 补齐非空笔记、收藏/阅读状态、命名视图与阅读位置，记录预期值后备份到原有新库/目录。
- [x] 恢复后核对原文/版本/时间及位置身份、视图搜索、图片校验、笔记与正文导出；损坏资源仍拒绝完整备份。
- [x] 运行指定恢复测试和typecheck。此任务仅增强验证，现有实现预期通过，不为制造RED修改业务功能。

### Task 2: 真实书库副本的两次恢复与浏览器验收

**Files:** 忽略目录 `.data/phase4-final-restore/` 的复跑脚本、清单、报告与截图。

- [x] 核对环境和服务，暂停worker/timer，记录当前业务及资源摘要，生成新完整组并核验字节/SHA256。
- [x] 新建准备库/目录并恢复，校验所有ready资源；只在准备库通过现有接口准备四类非空私人资料。
- [x] 记录准备库业务摘要及预期API结果，备份后恢复到第二个空库/目录；启动前后核对摘要及资源。
- [x] 独立端口启动恢复API/web，通过HTTP检查认证、CSRF、搜索、视图、状态/笔记/位置及三种导出。
- [x] Chromium/WebKit各三种宽度验收图片、已有位置继续阅读、命名视图、笔记导出与草稿；正文ZIP解包断网打开。
- [x] 关闭隔离进程，比较原库及资源摘要，恢复原worker/timer并smoke；保留隔离产物供复核。

### Task 3: 审查、整体检查与交付

**Files:** README、`docs/deploy.md`、`docs/reader/backup-restore.md`、`implementation-status.md`、新的整体验收记录。

- [x] 对脚本隔离/清理边界与新增测试做一次只读独立审查，处理重要问题并验证。
- [x] 完整typecheck、后端、web构建/测试及迁移检查；只在失败或新修改需要时重复。
- [x] 写入实际命令、版本/数量/恢复结果、隔离副本位置、原数据保留证据和限制，本地提交并归档执行记录。
