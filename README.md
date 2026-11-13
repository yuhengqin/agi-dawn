# AGI黎明 · AGIDawn

AGI黎明从技术博客收录文章，提供检索、阅读和私人归档。访客无需账号即可浏览公开文章，管理员登录后可保存收藏、阅读进度、笔记和正文版本。项目目前在本机验证，尚未公开上线，界面以桌面浏览器为设计与验收目标。

[本机安装](Install.md) · [更新日志](CHANGELOG_zh.md) · [部署与恢复](docs/deploy.md) · [安全报告](SECURITY.md)

## 可以做什么

- **查找文章。** 按来源、分类、主题、日期和关键词组合筛选。已生效的条件始终显示并可逐项移除，收起侧栏后仍能看见类别限制；主题选项的篇数反映当前其他筛选条件。搜索覆盖原文与有效译文，只检索获准公开的内容。“探索”按主题和来源整理入口，筛选和分页可通过浏览器历史恢复。
- **使用桌面侧栏。** “文章”和“探索”固定在类别列表上方。可收起整栏或拖动右边缘调宽，底部“我的”提供后台入口，并在当前页面弹出关于、更新日志和反馈。右下角太阳／月亮按钮切换明暗主题。
- **在站内阅读。** 正文和图片按来源许可展示，文章页提供原文链接、目录、阅读设置和专注模式。新安装默认关闭公开全文展示，当前本机实例已按站主授权为五个来源开启。见 [阅读工具](docs/reader/article-controls.md)和 [本机全文验收](docs/reader/local-fulltext-acceptance.md)。
- **阅读中文译文。** 开启模型调用并配置预算后，worker 可补译公开文章的外文标题和摘要，并翻译符合全文许可的新收录正文。缺少的摘要保持为空，已有正文的批量补译需另行安排。见 [翻译规则](docs/reader/translation-acceptance.md)。
- **整理私人书库。** 管理员可搜索已保存的正文与笔记，按条件保存常用视图，批量整理分类、主题、收藏和阅读状态。笔记可导出 Markdown，正文版本与图片可另存为离线 ZIP，阅读位置可在对应版本中恢复。见 [私人阅读验收](docs/reader/phase4-acceptance.md)。

## 本机快速开始

从源码运行需要 Node.js **24.22.1+** 和 PostgreSQL **17**。先创建独立的空数据库（下文以 `reader_dev` 为例），再在仓库根目录安装依赖和初始化配置。已有 `.env` 时保留原文件，先核对其归属。完整步骤见 [Install.md](Install.md)。

```bash
npm ci
if [ ! -e .env ]; then
  node scripts/init-env.ts
fi
```

在私有 `.env` 中配置 `DATABASE_URL` 指向该新库，并使用默认本机地址 `SITE_URL=http://localhost:3000`、`API_BASE_URL=http://127.0.0.1:3001`。确认实际连接目标后，依次执行首次初始化。阅读站的迁移包含旧功能删表操作，只能在已确认的阅读站库上执行。迁移影响见 [部署与回退](docs/deploy.md#更新与回退)。

```bash
node --env-file=.env scripts/migrate.ts &&
node --env-file=.env scripts/retire-reader-state.ts --database reader_dev &&
node --env-file=.env scripts/seed.ts
```

在三个终端分别启动 API、worker 和 Web。

```bash
npm run dev:api
npm run dev:worker
npm run dev:web
```

打开 [localhost:3000](http://localhost:3000)，后台入口为 [localhost:3000/admin](http://localhost:3000/admin)。使用 `.env` 中的 `ADMIN_PASSWORD` 登录。新库默认关闭采集、模型调用和外部推送，初始化后的文章列表可以为空。当前站主的常驻实例使用 4040 端口，其他安装仍以各自配置为准。见 [本机常驻运行](docs/deploy.md#本机常驻运行)。

准备常驻运行或验证生产构建时，执行 `npm run build -w @agidawn/web`。

### 交给编码 Agent 安装

在本仓库的工作区中，可直接给 Codex 等编码 Agent 发送下面这句。

```text
请按仓库根目录的 Install.md 准备 AGIDawn 本机开发环境，并告诉我还缺哪些配置以及如何启动。
```

## 开发与文档

项目使用 npm workspaces。React Router Web 通过 HTTP 访问 Fastify API，worker 通过 PostgreSQL 和 pg-boss 执行采集、正文处理、翻译和归档任务。检查命令及测试库要求见 [Install.md](Install.md#开发检查)。

- [架构与迁移约定](docs/architecture.md)
- [来源配置](docs/sources.md)与 [11 个来源的接入范围](docs/reader/source-inventory.md)
- [分类、主题与站点配置](docs/customize.md)
- [部署、更新、备份与恢复](docs/deploy.md)
- [实施记录与验收索引](docs/reader/implementation-status.md)

## 贡献与许可

提交问题或改动前请阅读 [贡献指南](CONTRIBUTING.md)。漏洞通过私密渠道报告，流程见 [安全政策](SECURITY.md)。

项目代码使用 [MIT 许可证](LICENSE)。收录文章与图片的权利归各权利人，公开展示须按来源核实许可。公网部署还需确认正式域名、使用规则和隐私说明。见 [部署说明](docs/deploy.md#docker-与-https)。
