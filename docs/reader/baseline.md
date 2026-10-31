# Linux 开发基线

日期：2026-10-27（Asia/Shanghai）。实现与验证均在本机 Linux 执行。

- 原仓库：`/home/laoq/Project/AGIDawn`，保持原状。
- 独立工作副本：`/home/laoq/.codex/worktrees/article-reader/AGIDawn`，分支 `codex/article-reader`。
- 基线：`79d962e`，包含原方案 `aa8e5b1` 之后两个上游修复。
- Node：项目私有安装 `24.22.1`，不替换系统 `24.16.0`。
- PostgreSQL：独立容器 `article-reader-pg`，17.11，端口仅绑定 `127.0.0.1:55432`。专用开发库 `reader_dev`、测试模板库 `reader_test`。
- 数据库客户端：项目私有 PostgreSQL 17.11（Ubuntu jammy 官方 PGDG 包）；系统默认客户端仍为14.24。
- 开发 `.env` 已设置采集、模型、推送、IndexNow 全部关闭，随机管理员凭据保存在该忽略文件中；本文不记录密钥。

进入工作副本后，当前会话使用：

```bash
export PATH="$PWD/.data/pg-tools/usr/lib/postgresql/17/bin:$PWD/.data/toolchain/node_modules/.bin:$PATH"
export LD_LIBRARY_PATH="$PWD/.data/browser-deps/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
```

基线证据均在忽略的 `.data/` 下：

| 检查 | 初始结果 |
| --- | --- |
| `npm ci --no-audit --no-fund` | 通过，锁文件未变 |
| `npm run typecheck` | 通过，`baseline-typecheck.log` |
| Markdown standalone | 通过，`baseline-standalone.log` |
| 前端生产构建 | 通过，`baseline-web-build.log` |
| 全后端 `npm test` | 946项，935通过、11失败；全部为 `pg_dump 14` 无法导出PG17；`baseline-backend.log` |
| 浏览器测试 | 首次WebKit未安装导致失败并留存测试服务器；已停止本次挂起进程。补齐浏览器及缺失的两个系统库后重跑 |

补齐环境后，备份测试12/12通过（`baseline-backup-recheck.log`），完整前端测试64/64通过（`baseline-web-ready.log`）。WebKit下载包的包装脚本覆盖了LD_LIBRARY_PATH，因此四个缺失库及其依赖同时链接到该浏览器自身的sys/lib；WebKit26.5已实际启动。初始失败均有环境原因和复测证据。

工作副本的 `.data/` 是本机临时工具与日志；可移植部署不依赖这里的路径。原仓库、原数据库、系统Node/PostgreSQL配置均未修改。
