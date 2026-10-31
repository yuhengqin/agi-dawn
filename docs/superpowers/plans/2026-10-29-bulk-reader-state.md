# 私人书库批量收藏与阅读状态 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 本页多选文章后批量收藏、取消收藏或设置阅读状态，预览确认，冲突整批回滚。

**Architecture:** 在reader状态模块增加批量事务，单篇和批量使用相同文章锁协调默认版本0。书库复用现有选区和预览，分类主题与私人状态分别调用对应API。

**Tech Stack:** Node24.22.1+、PostgreSQL17、TypeScript、React Router、Playwright Chromium/WebKit。

**Spec:** `docs/superpowers/specs/2026-10-29-bulk-reader-state-design.md`

## Global Constraints

- 在既有 `codex/article-reader` Linux工作树执行；暂不公开上线，不推送。
- 最多100篇、本页选区，未指定的收藏/状态保留；笔记、分类、主题、正文和资源不改。
- 状态缺省未收藏、待读、版本0；全部版本检查、状态和审计在同一事务内。
- 无新依赖、环境变量、迁移、数据回填或自动重试；测试只连隔离库和本地假源。

## Review Focus

- 未存状态行的无变化操作仍须与单篇并发写入正确串行化，不能漏过过期版本。
- 相反顺序的重叠批次不得部分成功或形成死锁。
- 分类版本与私人状态版本不同，前端必须发送对应版本。
- 一个字段未指定时不得重置另一个；无变化不得增加版本或审计。
- 保存后不再匹配收藏/状态筛选的文章移出列表；失败与会话失效保留/清除的边界正确。

### Task 1: 私人批量状态事务

**Files:** 修改 `modules/reader/state.ts`、`contracts.ts`、`server.ts`，扩充 `modules/reader/tests/privacy.test.ts`。

**Interfaces:** `BulkReaderStatePatch={articles:Array<{id:string;expectedVersion:number}>;starred?:boolean;status?:ReaderState['status']}`，`BulkReaderStateResult={selected:number;changed:number}`；`saveBulkState(input:unknown,actor:string):Promise<BulkReaderStateResult>`；PATCH `/api/admin/reader/state`。

- [x] 在现有privacy测试新增实际保存/保留、输入边界及无变化、审计失败与并发回滚测试；至少覆盖收藏和取消、三态、单字段保留、版本0和单篇/批量交错。
- [x] 运行 `PATH="$PWD/.data/pg-tools/usr/lib/postgresql/17/bin:$PWD/.data/toolchain/node_modules/.bin:$PATH" node .data/phase4/run-backend.mjs modules/reader/tests/privacy.test.ts`。Expected: 新测试因API不存在返回404失败，已有测试通过。
- [x] 实现严格输入校验、按ID锁定文章、等锁后逐篇状态版本检查、只写变化、同事务审计；单篇写入复用锁和内部写入函数。
- [x] 重跑privacy文件并运行typecheck。Expected: 全部通过。
- [x] 提交后端代码及测试，记录结果。

### Task 2: 共用选区的私人批量表单

**Files:** 修改 `modules/reader/components/LibraryOrganizer.tsx`，扩充 `apps/web/tests/reader-private.test.ts`。

**Interfaces:** 消费Task1的PATCH与类型；文章请求使用 `item.state.version`，分类主题仍使用 `classificationVersion`。

- [x] 在既有web测试增加新整理内容、收藏/状态保留、预览返回、精确选区/版本、防重复、冲突保留、清选区/原筛选重验、401卸载测试。
- [x] 生产构建后运行 `node --test apps/web/tests/reader-private.test.ts`。Expected: 新控件缺失导致新测试失败，现有测试通过。
- [x] 添加“分类与主题”/“收藏与阅读状态”可见单选项；新操作默认保留，预览显示两字段，单批只走对应API；沿用48px控件和反馈。
- [x] 重跑typecheck、生产构建、完整web测试。Expected: 全部通过。
- [x] 提交界面与测试，记录结果。

### Task 3: 独立审查、本机交付与文档

**Files:** 更新 `README.md`、`docs/deploy.md`、`docs/reader/implementation-status.md`，新增 `docs/reader/phase4-bulk-state-acceptance.md`；忽略目录保存验证脚本与日志。

**Interfaces:** 消费前两项最终代码；真实数据验收仅只读/未提交预览，业务写入由隔离测试证明。

- [x] 对基线c27d7ea至最终代码进行一次独立只读审查，若有重要发现，复现RED后修正GREEN并重跑完整检查。
- [x] 运行完整后端 `node .data/phase4/run-backend.mjs`、typecheck、web构建与完整web测试。Expected: 零失败/取消/跳过。
- [x] 确认systemd工作树归属，暂停服务，本地完整备份并保存业务表摘要；无迁移/回填，重建并启动本机版本。
- [x] 运行smoke、真实私人API与Chromium/WebKit1440/390/320px预览、取消、筛选和会话失效验收。Expected: 无有效业务写入、横向溢出、脚本错误或自动外网请求。
- [x] 核对前后业务数据摘要相同、API/web/worker和两个timer恢复active且只绑定127.0.0.1；更新验收/使用/升级记录并提交。
