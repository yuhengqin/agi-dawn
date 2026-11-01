# 正文组件转换 Implementation Plan

> 使用 superpowers:executing-plans 在当前会话执行；本侧聊禁止子代理。实现和产物仅放在本工作副本。

**Goal:** 明确提取管道与转换策略，修复 Browser Use 特殊组件的可读性。

**Architecture:** 现有 HTML 处理链保持顺序。组件转换器复用代码/表格渲染；显式来源适配器在通用清洗前处理作者和已知图表。

**Tech Stack:** Node.js 24.22.1+、TypeScript、linkedom、Readability、现有 Node 测试入口；不新增依赖。

**Spec:** `docs/superpowers/specs/2026-11-01-article-content-adapters-design.md`

## Global Constraints

- 不操作运行数据，不变更共享 HTTP 契约，不启动 worker；初次实现阶段不提交或合并，后续按使用者明确授权本地合回 main，不推送。
- 保留 HTML 清洗、安全与隐藏内容规则；来源专用行为必须显式配置。
- 使用隔离工作副本和清除凭据后的 standalone 验证。

## Review Focus

- 非指定来源不受适配影响。
- 代码、公式、图片及原有来源规则不因拆分丢失。
- 任一数据行失败时不输出缺行或列错位的表格。
- 不同显示版本不一致时不任意选择数据。
- 降级提示仅属于最终正文内保留的组件。

## Task 1: 管道、转换器与来源适配

**Files:** `packages/backend/src/content/{extract,pipeline,components}.ts`、`packages/backend/src/content/adapters/`、`packages/backend/src/sources/config-keys.ts`、`tests/browser-use-body.standalone.test.ts`。

- [x] 添加并运行作者、完成数量、双评判、推理力度与异常数据回归，确认目标用例失败。
- [x] 提取现有预处理与通用组件代码；保留现有入口和处理顺序。
- [x] 增加 `PageRules.bodyAdapter` 和注册表，严格验证来源配置。
- [x] 实现 Browser Use 识别与表格转换，使用安全文本和完整结构校验。
- [x] 运行新旧相关 standalone 回归。

## Task 2: 配置、说明和验收

**Files:** `industry/sources.json`、`docs/sources.md`、`docs/deploy.md`。

- [x] 在 Browser Use 初始化模板声明适配；说明现有数据库需后台显式配置，不重复 seed。
- [x] 对真实公开 HTML 比较输出表格、作者及降级状态，不写真实数据库。
- [x] 执行完整 standalone 集合、类型检查、`git diff --check`；复核 diff 并报告工作副本及未上线边界。

## 执行记录

- 已创建独立副本；应用侧聊无法注册附件，后续均显式使用该目录。
- shell 默认 Node 为 24.16.0；验证改用已可用的 Node 24.22.1。依赖从锁文件安装到本副本，未更新依赖声明。
- 最终完整 standalone：242/242，通过；类型检查、web 构建与 `git diff --check` 通过。首次全量验证的13项环境失败在构建本副本 web、显式复用既有 curl_cffi Python、保留 systemd 用户会话变量后消除，没有修改测试断言来绕过失败。
- 真实公开样本：三张表分别保留15、3、14行，10位作者均保留；孤立图例图片消失，仅保留封面。曲线图继续文字降级，正文仍为 partial。使用本站构建样式在1440px桌面 Chromium 核对，三张表均在772px正文容器内，无横向溢出。
- 最后复核补充了桌面与替代列表数值分歧、隐藏 SVG 数据组、标签文本转义回归；数值有歧义时不输出表格。
- 初次交付时实现和验证产物均位于此工作副本，尚未提交或合并；未操作运行数据库、未重采存量文章、未切换服务。验证材料在本副本忽略的 `.data/verification/article-content-adapters/` 中。
- 2026-11-01 后续授权：使用者要求合回 main；本地提交并在相同基准上快进合并，保留运行服务与文章数据，不推送远端。
