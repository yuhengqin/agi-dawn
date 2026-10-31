# 配套备份与恢复记录

数据库和文章资源必须成组备份、成组恢复。使用PostgreSQL17的`pg_dump`/`pg_restore`与`tar`；本机PG17私有工具中仅这两个命令已用于验收，不能据此声称该私有目录的`psql`可运行。连接凭据来自私有环境文件或PG环境变量，不写入本文。

## 操作方式

在独立工作副本中运行：

```bash
node --env-file=.env scripts/backup-reader.ts --local-only
```

显式本地模式输出 `uploaded:false`、`target:local-only`。默认生产路径需要对象存储配置，不会把“未配置上传”当成功。对象存储凭据项见 `.env.example` 的 `DB_BACKUP_STORE_*`；本轮仅对假存储与本地模式验证，未向真实云端上传。

每组含独立时间戳/UUID的dump、tar.gz和group.json。只有数据库导出、资源验证、冻结清单打包及所需上传全部成功才发布complete清单，清单最后写入/上传。ready文件先完整落盘后才入库；不做自动物理GC，备份期间新文件作为超集允许存在。当前保留最近三个本地完整组；生产对象存储的生命周期需另行配置。

1. 只选择 `complete:true` 的group.json，核对两个artifact的文件名、大小及SHA256，不能混用不同组。
2. 创建另一个空库和空目录；用`pg_restore --exit-on-error --no-owner`恢复该dump，用`tar -xzf ... -C ...`解包同组资源。不能覆盖开发库或原站。
3. 将`DATABASE_URL`指向恢复库，执行 `node scripts/verify-reader-archive.ts --data-dir /绝对路径/恢复目录`。任何ready文件缺失、大小或哈希不符返回非零。
4. API/worker的数据库与`AGIDawn_DATA_DIR`一起切到恢复位置；检查管理员笔记/版本/资源，重新导出指定版本ZIP并断网打开。pending任务仍按持久快照恢复处理。

生产切换前保留旧实例和对应备份；破坏性DDL不能通过旧代码直连新schema来回退。完整命令模板见 [部署说明](../deploy.md)。本机临时日志及工具不等于可迁移部署依赖；磁盘须容纳在线资源、数据库dump、tar包与恢复副本，不设未经负载验证的容量承诺。

## 2026-10-28 实际演练

停止本次开发worker后，从 `reader_dev` 生成组 `20261027160946670-ae9177b9-275c-4cd2-8349-767894bbea01`（文件名时间为UTC），保持API只读服务。备份组位于 `.data/backups/`：

| 产物 | 字节 | SHA256 |
| --- | ---: | --- |
| `reader-dev-20261027160946670-ae9177b9-275c-4cd2-8349-767894bbea01.dump` | 2,214,049 | `56ac62f40b0d7f5003e310ef9beaec4b4f75ff3212f79aeefd51045acafa58ce` |
| `reader-dev-files-20261027160946670-ae9177b9-275c-4cd2-8349-767894bbea01.tar.gz` | 37,369,960 | `cae3267f91333596e34fca05bcc9a43a43d3d2b3681b597c944eebcfda20d1e6` |

恢复目标：全新 `reader_release_restore_test`，资源目录 `.data/reader-release-restore-JRId5U`。`pg_restore`成功；96篇文章、150个版本、0条笔记与备份前一致；校验241个ready图片文件、39,685,855字节。数据库与文件恢复及校验耗时2,033ms，仅代表当前小数据集及本机磁盘。

随后在恢复库只读会话生成四份ZIP，逐项核对清单字节与SHA256、断网打开和图片加载，结果见 [验收记录](acceptance.md)。真实库尚无笔记；`modules/reader/tests/backup-restore.test.ts`单独在新库恢复指定笔记正文及version=7，并验证恢复后导出。

自动测试还覆盖打包失败不发布complete、文件缺失/损坏拒绝成功、同时间重复备份互不覆盖及新文件不进入已冻结清单。没有以`pg_dump`成功代替文章资源恢复成功。

## 2026-10-29 新版私人资料演练

已完成[第四阶段整体验收与新版恢复演练](phase4-final-restore-acceptance.md)：原库备份先恢复到独立准备库，只在准备库创建非空笔记、收藏/阅读状态、两个命名视图和阅读位置，再备份并恢复到第二个空库/目录。完整业务摘要及246个ready资源（40,606,304字节）一致；搜索、已有视图、图片、继续阅读、单篇/批量笔记Markdown与指定版本正文ZIP均通过，正文ZIP阻断网络后可读。

主副本位于 `.data/phase4-final-restore/run-20261029012002_a1ff5f98/`。新备份组独立保留，未触发原目录轮转，原书库、原图片及既有备份文件摘要保持。隔离API/web已关闭，原服务与timer恢复。新增自动回归核对私人文本、版本、时间及恢复后只读行为，信号中断和恢复命令报错也不产生错误完成标记。详细库名、清单、命令及浏览器验证边界见上述验收记录。
