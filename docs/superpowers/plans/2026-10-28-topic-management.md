# 网页主题管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 网页管理主题名称和说明，并保持归属稳定、让现有阅读和整理入口动态读取。

**Architecture:** 新建article_topics目录表并从原JSON幂等初始化；所有运行时主题查询改为数据库读取。reader模块提供受保护的管理API及页面，既有分类与批量整理复用新目录。

**Tech Stack:** Node24、PostgreSQL17、TypeScript、React Router、Playwright；不新增依赖或环境变量。

**Spec:** `docs/superpowers/specs/2026-10-28-topic-management-design.md`

## Global Constraints

- 仅本机Linux，保留当前工作树与普通页已采集正文展示，不推送、不公开上线。
- 既有slug和匹配标签完整保留；改名不重写任何文章归属或私人数据。
- 名称1–60字符唯一，说明1–2000字符；新增slug/标签由服务端生成，客户端不编辑匹配规则。
- 新DDL只建目录表，单文件一条在线语句；初始化为显式脚本，不写入历史迁移。
- 无目录缓存；下一次读取即用新值；UI原生标签和48px控件，冲突保留输入。

## Review Focus

- 重复初始化不把管理员改名恢复成模板名称；恢复和新安装能获得同一目录。
- 改名后原slug链接、私人/公开筛选、文章勾选与批量保存都保持归属。
- 新增主题名可使用一个已改名主题的旧名称，不与旧匹配标签串联。
- 私人计数包含下架/暂停来源历史，公开计数仍过滤可见性；不泄露私人内容。
- 并发改名、重名和审计失败均保留事务与版本边界，失败不会清空编辑输入。

### Task 1: 数据库目录、管理API及所有运行时消费者

**Files:** 新建 `database/migrations/0101_article_topics.sql`、`scripts/seed-topics.ts`、`modules/reader/topics.ts`；修改 `scripts/seed.ts`、`tests/databases.ts`、`packages/backend/src/publication/topics.ts`、`pool.ts`、`detail.ts`、`rules.ts`、API site/og路由、reader state/classification/server/contracts、`scripts/apply-reader-taxonomy.ts`；扩展既有主题和隐私测试，适配discovery测试。

**Interfaces:**
- Produces: `listTopics(db?):Promise<Topic[]>`、`findTopic(slug,db?)`、`topicBrowseLinks()`；替代运行时TOPICS数组及同步查找。
- Produces: `seedTopics(db?)`；已有项ON CONFLICT(slug) DO NOTHING，不覆盖管理员编辑。
- Produces: `GET/POST /api/admin/reader/topics`，`PATCH /api/admin/reader/topics/:slug`；管理项 `{slug,name,definition,version,articleCount}`，创建 `{name,definition}`、修改 `{name,definition,expectedVersion}`。
- Consumes: 原有匹配标签、人工覆盖事务、认证CSRF、审计。

- [x] 先在既有隐私/主题测试写管理API、改名/新主题归属及初始化保护的失败用例，运行定向测试观察缺失接口失败。
- [x] 建表与幂等初始化，增加受保护管理API、严格输入、CAS及审计事务。
- [x] 将所有主题消费者切到数据库读；保留标签匹配与公开/私人范围，删除旧运行时数组及无调用的同步helper。
- [x] 适配既有主题测试夹具为数据库行，补充重名/并发/审计失败/隐藏标签/旧名再用/计数测试；运行定向测试和typecheck，通过后提交。

### Task 2: 管理页面、入口及本机验收

**Files:** 新建 `modules/reader/pages/topics.tsx`；修改reader module/web、书库/单篇主题入口、既有web测试、README和部署/定制/实施文档；新增第四阶段主题管理验收文档。

**Interfaces:**
- Consumes: Task1管理API、ReaderLibrary.filters.topics、`ownerRequest`和`expireSession`。
- Produces: 主题管理导航、列表及关联书库链接、新增和名称/说明编辑表单；管理后再次打开各阅读入口读取新目录。

- [x] 在现有web测试加入管理新增/编辑/冲突输入保留、重载、过期卸载及返回各入口用新主题的失败测试；先构建并运行，确认因缺失页面/控件失败。
- [x] 实现页面、导航及管理链接，保留其他行草稿，保存防重入；实现所有已有入口的同步读取。
- [x] 构建并运行定向web测试；运行typecheck、完整后端测试、web构建及全部web测试，确认通过。
- [x] 核对本机服务归属后暂停并完整本地备份；迁移和显式初始化，核对原14主题归属及全部旧业务表摘要不变；更新API/web并真实桌面/手机预览，验证入口同步及75篇原普通正文；恢复worker/timer并smoke。
- [x] 更新文档和本地提交；一次独立只读审查，处理重要发现，保留工作树和服务，不推送或公开上线。
