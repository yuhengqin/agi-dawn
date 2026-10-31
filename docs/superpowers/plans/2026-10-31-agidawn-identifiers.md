# AGIDawn 标识统一实施计划

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将当前运行代码、配置和测试的旧品牌标识改为 agidawn，保留已有数据。

**Architecture:** 普通标识同步替换。浏览器在首屏脚本中迁移已有 localStorage/sessionStorage 键；数据库中的来源配置通过显式指定库名的维护脚本迁移，发布迁移不承担数据回填。

**Tech Stack:** Node.js 24.22.1、TypeScript、PostgreSQL 17、React Router、Playwright。

**Spec:** 用户已确认本会话上一条盘点方案：运行代码统一为 agidawn，浏览器与数据库字段配套迁移；保留 NOTICE、历史记录、实际数据库名和项目目录。

## 约束与验收

- 不改历史 SQL、不改 .env、不在实际数据库运行维护脚本；只在隔离测试库验证。
- localStorage/sessionStorage 写成功后才删除旧键；已有新键优先；存储不可用时页面仍可使用。
- 来源配置迁移保留完整值及其他配置；新旧键冲突时整批中止；重复运行无变化。
- 旧 ingest raw 字段的调用方需改用 `_agidawn`；历史文章原始载荷保留。
- Cookie 改名导致管理员重新登录；匿名统计与私人阅读数据不变。

## Task 1: 浏览器和运行标识

- [x] 在 tests/local-font.standalone.test.ts 添加首屏迁移回归：偏好/草稿/会话保留、新值优先、写失败保留旧值。
- [x] 运行上述测试，确认新回归失败。
- [x] apps/web/app/lib/local-state.ts 添加首屏迁移；同步 CSS、release 标记、SSR header、Cookie、测试/CI临时名称和数据库默认值。
- [x] 运行浏览器存储相关 standalone 测试及类型检查。

## Task 2: 来源配置与退休接口资料

- [x] 核对 sources.config、ingest raw 的读写及旧 OpenAPI 引用。
- [x] tests/migrations.test.ts 增加维护脚本验证：库名保护、值保留、重复运行、冲突回滚。
- [x] scripts/rename-reader-brand.ts 提供显式 --database 维护入口；同步 `_agidawn` 的代码、示例及文档；清理已退休且未引用的 OpenAPI 文件。
- [x] 在隔离 PostgreSQL 测试库验证脚本与完整后端测试。

## Task 3: 验证与交付

- [x] docs/deploy.md 写明备份、暂停服务、字段迁移、重建与重启、Cookie 及浏览器键变化；历史记录不改写。
- [x] npm run typecheck；npm test（独立 *_test 数据库）；npm run build -w @agidawn/web；node --test apps/web/tests/*.test.ts；smoke。
- [x] 独立只读审查；最终检索残留，区分历史/许可证和迁移入口。
- [x] 本次改动保留工作区待审，不自动提交或更新实际服务。

## 后续统一：文档、文件名与本机目录

用户进一步要求仅保留 NOTICE 中的原项目版权与品牌声明，其余旧品牌字样统一为 `AGIDawn/agidawn`。因此同步历史文档与文件名，并将本机目录及服务引用改为 `/home/laoq/Project/AGIDawn`。

来源配置维护脚本改为通过 `--from` 指定旧键，继续验证值保留、冲突拒绝和幂等性；不硬编码旧品牌。浏览器首屏移除旧品牌键迁移，保留 `agidawn-*` 的当前数据读取与存储不可用时的处理；对应测试改为验证当前偏好、草稿和会话数据保留。本机11个来源已使用当前命名空间，无需写库。

本轮验证：类型检查、609项后端测试、222项独立测试、web构建、97项web测试和站点冒烟检查均通过。真实文章详情及抽查的3张本地图片均返回200；API、web、worker和两个timer从新目录正常运行。目录迁移后，首次web检查发现Playwright缓存中的70个浏览器依赖链接仍指向旧目录；更新链接后验证WebKit启动，并重跑整套web测试通过。Python虚拟环境的启动脚本与pip路径同步更新，38份本地验收日志文件改名。NOTICE未修改，仓库源码与文档检索仅该声明保留原名称。验证日志在 `/tmp/agidawn-rename-*.log`；改动未提交。
