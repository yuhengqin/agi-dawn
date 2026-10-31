# 首页导航与站内互动实施计划

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task.

**Goal:** 在 main 实现已确认的侧边类别、顶部主题及无摘要文章列表，提供真实阅读数和匿名点赞。

**Architecture:** 类别与主题沿用公开查询的交集语义，URL 保存条件。公共计数由 publication 读取；浏览器身份使用独立签名 Cookie，数据库原子更新每篇每浏览器的访问及点赞状态。

**Tech Stack:** Node 24、PostgreSQL 17、Fastify、React Router、Tailwind、Playwright。

**Spec:** 本聊天已批准设计：取消日期分组与摘要；标题下显示来源、上海日期、阅读、点赞、收藏占位；类别和主题各自清除，保留其他条件且重置游标；详情前台打开计数，同浏览器同篇30分钟去重；匿名一票可取消；收藏显示“—”。

## 约束与审查重点

- 直接在 main 执行；不变更依赖或私人阅读数据；所有公开读取经过 publication。
- 新迁移每文件一条语句；不编辑历史迁移；不开启采集、模型或通知。
- 检查并发重复请求、撤回文章、跨站写入、缺少 Cookie、网络失败。
- 桌面类别、手机类别面板、更多主题都可达，筛选可刷新、返回、分享。

## 任务

- [x] 在 tests/reader-query.test.ts 添加接口行为测试并确认失败；建立 visitor 记录、publication 计数、匿名接口；确认通过。
- [x] 在 apps/web/tests/reader-public.test.ts 更新日期展示和组合导航测试；修改 Sidebar、ReaderPage、ReaderFilters，新增 ReaderNavigation 和 ArticleEngagement；补浏览器互动测试并确认通过。
- [x] 更新 README、architecture、deploy 与现有首页验收文档，说明升级与统计口径。
- [x] 运行 typecheck、完整后端测试、web build 和全部 web 测试；独立审查后修正问题。
- [x] 应用新增迁移并重启本机 API/web，以 Chrome 检查桌面与手机，执行 smoke；提交前保留可审阅 diff。

验证结果见 [首页验收记录](../../reader/explore-acceptance.md#2026-10-30-首页与互动检查)。改动保留在 main 工作区，未创建提交。
