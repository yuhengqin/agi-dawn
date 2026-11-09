# AGIDawn 本机安装

本指南供首次从源码运行 AGI黎明的开发者和编码 Agent 使用。默认准备 Linux 上的独立本机开发环境。已有实例的更新、配套备份、常驻服务和 Docker 路径见 [部署与恢复](docs/deploy.md)。

## 安装范围

- 先确认当前仓库、数据库、资源目录和端口的归属。复用已满足要求的工具链，保留已有配置与数据。缺少系统依赖时，列出需要安装的工具和版本。
- 首次初始化使用独立空库和本工作副本的资源目录。已有实例按部署文档更新，避免把首次安装中的清理操作用在存量库上。
- 采集、模型调用、飞书内部通知和 IndexNow 默认关闭。安装与冒烟检查可以在空文章库运行，无需真实模型或提取服务凭据。
- Agent 默认完成环境准备后交付启动命令。用户要求启动或验证时，才运行服务，并事先检查端口与目标配置。报告中只列配置变量名及非敏感的验证结果。

## 1. 准备依赖

如果还没有工作副本，先克隆仓库。已打开本仓库时可直接从 `package.json`、`apps/` 和 `.env.example` 所在的根目录继续。

```bash
git clone https://github.com/yuhengqin/agi-dawn.git
cd agi-dawn
```

需要 Node.js **24.22.1+**（含 npm）和可连接的 PostgreSQL **17**。使用 PostgreSQL 客户端检查目标实例，再安装锁定依赖。

```bash
node --version
npm --version
pg_isready -h 127.0.0.1 -p 5432
npm ci
```

备份和恢复需要与服务端同主版本的 `pg_dump`、`pg_restore` 和 `tar`。要抓取 `openai.com` 的正文时，再准备 Python **3.10+** 与独立的 `curl_cffi` 环境。见 [浏览器指纹传输](docs/deploy.md#openai-文章的浏览器指纹传输)。

## 2. 创建开发库并配置环境

在本机 PostgreSQL 创建专用空库，例如 `reader_dev`。下面以已有且有建库权限的 `reader` 角色为例。若由其他账号建库，请将库所有权交给应用账号，使其可创建迁移和队列所需的对象。

```bash
createdb -h 127.0.0.1 -p 5432 -U reader reader_dev &&
psql -h 127.0.0.1 -p 5432 -U reader -d reader_dev -Atc 'SHOW server_version'
```

确认 PostgreSQL 主版本为 17 后，仅在 `.env` 不存在时生成配置。脚本将文件权限设为 `0600`，并在终端打印管理员密码。下面将标准输出重定向到 `/dev/null`，密码仍会写入文件。

```bash
if [ ! -e .env ]; then
  node scripts/init-env.ts >/dev/null
fi
```

编辑仓库根目录的私有 `.env`。下列连接串仅示例角色名、主机、端口和库名，按本机 PostgreSQL 认证方式填写。

```dotenv
DATABASE_URL=postgres://reader@127.0.0.1:5432/reader_dev
SITE_URL=http://localhost:3000
API_BASE_URL=http://127.0.0.1:3001
COLLECT_ENABLED=false
MODEL_CALLS_ENABLED=false
FEISHU_INTERNAL_ENABLED=false
INDEXNOW_SUBMIT_ENABLED=false
```

保留生成的 `ADMIN_PASSWORD` 和 `SESSION_SECRET`。默认资源目录为仓库内的 `.data/`。运行前核对 shell 中同名环境变量及凭据目录的配置，因为继承值可能覆盖 `.env`。如无法确认目标为独立开发库与资源目录，停在初始化之前，并列出待核对的配置项。

## 3. 首次初始化

确认实际连接目标为上述专用空库后，逐条执行。迁移脚本不会建库，历史迁移包含 `0100_reader_drop_*` 删表操作。只有新阅读站库可走这套首次初始化流程。将清理命令的 `reader_dev` 换成实际数据库名。

```bash
node --env-file=.env scripts/migrate.ts &&
node --env-file=.env scripts/retire-reader-state.ts --database reader_dev &&
node --env-file=.env scripts/seed.ts
```

首次清理移除历史迁移带入的退休模型配置与预算。迁移会跳过已登记的文件，seed 只补缺失的来源和主题。任一步失败时先定位错误和目标库，后续步骤依赖前一步成功。日常更新按 [更新与回退](docs/deploy.md#更新与回退) 处理。

## 4. 启动与验证

确认 API 的 3001 端口和 Web 的 3000 端口可用，在三个终端分别从仓库根目录运行。

```bash
npm run dev:api
npm run dev:worker
npm run dev:web
```

开发 Web 直接使用开发服务器。若 API 使用非默认地址，把对应的 `API_BASE_URL` 显式传给 Web 进程，并让 `SITE_URL` 与浏览器访问地址一致。

API 与 Web 就绪后，从仓库根目录执行冒烟检查。确认 worker 日志出现 `worker started`。可打开 [localhost:3000/admin](http://localhost:3000/admin)，使用生成的管理员密码验证登录。

```bash
node scripts/smoke.ts --base http://localhost:3000
```

环境准备完成的依据是依赖安装及新库初始化成功。已启动的实例还需核对服务日志和 smoke 结果。交付时列明完成的步骤、剩余配置项和启动命令。遇到阻塞时说明失败步骤及下一步，日志先移除凭据。

## 开发检查

```bash
npm run typecheck
npm run test:standalone
# 使用本机可丢弃的测试库，账号须有建库权限
DATABASE_URL=postgres://127.0.0.1:5432/reader_test npm test
npm run build -w @agidawn/web
node --test apps/web/tests/*.test.ts
```

数据库测试会创建并清理克隆库，测试库名必须以 `_test` 或 `_ci` 结尾。自动测试使用本地假服务，运行前清除继承的真实服务凭据和出站代理，关闭外部推送。完整 Web 测试需要 Playwright Chromium、WebKit 和系统运行库。按改动选择检查，命令与隔离约定见 [AGENTS.md](AGENTS.md#运行与验证)。
