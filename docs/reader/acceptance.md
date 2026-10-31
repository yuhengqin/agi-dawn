# AGI黎明 Linux 本机验收

本文保留2026-10-28的历史验收。普通文章列表的签名游标现已由[数字分页](pagination-acceptance.md)替代，私人书库仍使用独立游标。

验收日期：2026-10-28（Asia/Shanghai）。基于 `79d962e`，在分支 `codex/article-reader`、独立工作副本 `/home/laoq/.codex/worktrees/article-reader/AGIDawn` 完成。原 checkout `/home/laoq/Project/AGIDawn` 保持干净，未迁移原运营库。

本机功能验收通过，未公开上线。Node 24.22.1、PostgreSQL 17.11、Linux；网页使用生产构建，API/web/worker 分进程运行，数据库仅绑定本机。环境搭建及原始基线见 [baseline.md](baseline.md)。

## 功能与检查

| 范围 | 实际结果与证据 |
| --- | --- |
| 无模型收录与发布 | 原始标题/摘要/日期直接投影；假源验证立即收录、首次历史裁剪、去重、日期补齐、旧任务拒绝覆盖、下架重采不恢复；提取失败保留旧正文 |
| 查找与权限 | 来源/分类/主题/上海日期/关键词组合，签名游标；2,105条历史全部可达，正文尾部可检索；全文撤权后不再命中受限正文 |
| 公开阅读 | API及SSR no-store；不以旧正文兜底；缺作者不补造，缺原日期标收录时间；手机代码与表格可横向滚动 |
| 私人空间 | 收藏、三态阅读、20,000字符纯文本笔记；真实会话/CSRF/CAS；两窗口冲突保留草稿，会话失效清空私人数据；公共SSR/API/导出不含笔记 |
| 分类 | 初始“待分类”，后台新增、改名和分配；[四个候选分类](category-candidates.md)只作讨论，未自动启用 |
| 版本与资源 | 正文事务捕获不可变版本与归档任务；当前权限控制公开资源，管理员可读历史；指定版本ZIP含HTML、Markdown、图片和哈希清单 |
| 容量与失败 | 每图8 MiB、每篇64 MiB、128张图、4任务并发、20秒请求、16M像素；超额文件不落正式目录，缺失明确标partial，无无限文件内存缓存 |
| 旧功能退役 | 旧模型/翻译/评分/事件/报刊/精选推送、v1/RSS输出/MCP/Agent/旧公开Markdown入口移除；48条新迁移清理26表22列，历史迁移不改；见[清单](retirement-inventory.md) |
| 类型检查 | `npm run typecheck` 退出0，`.data/reader-typecheck-final.log` |
| 完整后端 | `DATABASE_URL=<专用reader_test> npm test`：534/534通过，0跳过/取消，56.1秒；`.data/reader-backend-final.log` |
| 前端 | `npm run build -w @agidawn/web` 退出0；`node --test apps/web/tests/*.test.ts`：24/24通过，含Chromium/WebKit的320/393/1024宽度；`.data/reader-{build,web}-final.log` |
| 迁移与运行 | `node scripts/check-migrations.ts --base 79d962e` 退出0；运行后执行 `node scripts/smoke.ts --base http://localhost:3000`，检查新入口与旧入口拒绝行为；日志 `.data/reader-{migrations-final,local-smoke}.log` |
| 实际后台登录 | 使用私有环境凭据登录本机web，经代理读取私人列表/分类页均200且no-store；退出后相同会话读私人入口401，`.data/reader-runtime-admin.log` |

测试数量比原站减少，是因退役行为及其专属断言一起移除；保留采集、权限、认证、并发、付费回执和运维检查。自动测试只访问本地假源，真实来源验收使用单独的显式命令，不调用模型或付费正文兜底。

独立只读审查覆盖公开发布/权限、私人状态、资源归档、导出和备份。已修复并回归：数据库微秒刷新令牌经JS Date截断、SVG本地xlink引用失效、超额图片提前落盘、同刻备份命名碰撞、Markdown元数据注入和缺失文件错误泄露服务器路径。关键代码与审查发现均在对应既有行为测试中验证。

## 真实来源与断网恢复

五源共96篇，74篇取得私人可读正文，96篇有来源日期。来源差异、失败与权限详见 [source-inventory.md](source-inventory.md)，不据此声称任意网站都支持。

配套备份恢复到空库 `reader_release_restore_test` 与新目录，核对96篇文章、150个不可变版本、241个图片文件（39,685,855字节），全部ready文件大小及SHA256正确。真实库暂无用户笔记；独立恢复测试另验证笔记内容及版本7。恢复操作约2.03秒，详见 [backup-restore.md](backup-restore.md)，不作为生产恢复时限承诺。

从恢复库指定版本重新导出，逐项校验ZIP文件哈希，Chromium打开解包后的本地HTML并阻断HTTP/HTTPS请求：

| 来源样本 | 代码块 | 表格 | 图片 | 完整性 | 自动远程请求 |
| --- | ---: | ---: | ---: | --- | ---: |
| Shrivu安全样本 | 0 | 0 | 11 | complete | 0 |
| OpenAI技能评测 | 7 | 0 | 0 | complete | 0 |
| Anthropic MCP工程 | 12 | 0 | 1 | complete | 0 |
| Claude代码审查 | 0 | 1 | 1 | partial | 0 |

所有包内图片均正常加载。Anthropic的12个代码块另与原网页逐块比对，文本一致；此前Readability忽略来源代码组件，现已通过来源preserve规则保留。Claude的CSS依赖图表仍只能保留替代表示，界面及ZIP明确“不完整”。真实公式来源未覆盖，MathML/公式源使用本地生成样本验证。

原始证据保存在忽略目录：`.data/reader-real-{backup,restore,offline}.json`、`.data/reader-anthropic-code-fidelity.json`、`.data/acceptance/offline/`。不将第三方全文、私人数据、日志或凭据提交到Git。

## 已知边界

- 五个真实来源的公开全文许可均未确认，`site_fulltext=false`；匿名当前可看元数据、摘要和原文链接，管理员用于私人阅读的正文不公开。匿名全文路径通过本地获准假源验收。
- OpenAI中文工程栏目本机返回403；实际使用官方RSS的Engineering分类，英文标题及原文链接，不代表中文全文接通。
- 定时采集、内部通知和IndexNow保持关闭；手动来源验收已完成，未开启长期自动外网采集。已移除模型调用入口，无需模型密钥。
- 完整应用Docker镜像、生产对象存储、正式HTTPS域名、长期负载和真实进程崩溃注入未验收。资源重试、文件缺失/损坏、事务回滚及配套恢复有自动化覆盖；不把这些等同于全部生产故障场景。
- 正式域名、最终词表、全文许可和条款生效内容由站主决定。当前条款为开发草稿；本轮交付本机运行与部署说明，不含公开部署。
