# 私人笔记导出与阅读体验 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 登录后单篇已保存笔记 Markdown 导出，随后实现私人目录与跨次继续阅读。

**Architecture:** reader 模块只读导出 API 和下载入口；共享章节提取，独立服务端位置表和 CAS，私人正文组件提供目录与继续阅读。

**Tech Stack:** Node24、PostgreSQL17、TypeScript、React Router、Playwright Chromium/WebKit。

**Spec:** `docs/superpowers/specs/2026-10-29-private-note-export-reading-design.md`

## Global Constraints

- 仅 Linux 本机工作树；不推送、不公开上线。无新依赖、环境变量或模型调用。
- 导出只读取服务端已保存内容，不修改业务数据或审计；保留未保存草稿。
- 阅读位置单独版本，CAS 冲突不重试覆盖；不同正文修订不自动恢复。
- 自动化只连本地假源与隔离测试库；迁移仅新增一条在线 DDL。

## Review Focus

- 私人导出与位置的鉴权、缓存、CSRF；不能进入公开响应、ZIP或浏览器持久存储。
- 过期会话、切换文章、并发保存、离开页面，不泄露资料或覆盖新位置。
- 恢复与路由历史滚动、显式锚点、图片迟加载、移动视口之间的关系。

### Task 1: 已保存私人笔记导出

**Files:** reader 的 notes/client/server/OwnerTools、note-export/markdown；privacy 与 reader-private 测试。

- [x] 添加后端与浏览器测试，运行并确认旧实现失败。
- [x] 实现只读一致性导出、鉴权下载、草稿提示与错误处理。
- [x] 运行相关测试、typecheck、web构建；本地提交并记录证据。

### Task 2: 目录与跨次继续阅读

**Files:** reader 的 contracts/server/position/迁移/SnapshotReading 与共享章节工具，必要私页入口；已有相关测试。

- [x] 确定位置契约并补齐设计，添加后端/浏览器回归，验证失败。
- [x] 实现章节目录、当前章节与手机入口；独立位置版本和按正文内容匹配恢复，处理冲突与失效。
- [x] 运行相关测试和迁移检查，本地提交并记录证据。

### Task 3: 审查、本机验收与文档

**Files:** README、部署/实施状态及本次验收文档；忽略目录保存运行证据。

- [x] 固定代码，一次独立只读审查；重要问题按 RED→GREEN 修复。
- [x] 完整 typecheck、后端、web构建及web测试；全部通过。
- [x] 核对并暂停本机服务、完整备份与业务摘要，迁移并更新API/web。
- [x] 真实登录下载、继续阅读与桌面/手机 Chromium/WebKit验收，清理专属临时数据，恢复服务与定时器、smoke。
- [x] 更新文档、提交、归档本次执行记录；最终说明行为与限制。
