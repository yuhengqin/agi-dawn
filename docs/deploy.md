# Linux 部署与恢复

## 本机运行

需要 Node.js 24.22.1+、PostgreSQL 17、同主版本 `pg_dump`/`pg_restore`、`tar`，以及带 venv 的 Python 3.10+。使用专用新库 `reader_dev` 和有建库权限的测试库账号。不要把原项目 `.env` 或运营数据库接到本改造。

执行 README 的安装、初始化、迁移、显式退休状态清理、seed、构建命令。`.env` 保持0600，填写 `DATABASE_URL`、`API_BASE_URL=http://127.0.0.1:3001`、`SITE_URL=http://localhost:3000`；管理员密码和会话密钥由 `init-env` 生成。

在三个终端运行：

```bash
npm run dev:api
npm run dev:worker
npm run dev:web
```

API 默认只监听127.0.0.1:3001。真实来源需要出站代理时配置 `EGRESS_PROXY_URL`，不会自动把系统 `HTTP_PROXY` 视为采集代理。确认信源后才能设 `COLLECT_ENABLED=true`。手动真实验收命令显式带 `--live`；自动测试始终只访问假源。

开发 web 与正式 web 对公开 `.data` 导航请求采用相同的参数清理：移除 React Router 内部的 `_routes`，保留来源、主题等业务筛选条件，避免站内跳转被文章接口误判为未知筛选条件而返回400。管理员导航与写请求保留框架原有参数。

### OpenAI 文章的浏览器指纹传输

本机先安装独立 Python 环境；不会修改系统 Python 包，也不使用付费提取服务：

```bash
python3 -m venv .data/curl-cffi
.data/curl-cffi/bin/pip install --only-binary=:all: -r deploy/curl-cffi-requirements.txt
```

`site/site.ts` 的 `DEPLOYMENT.curlFetch` 仅为 `openai.com` 启用 `curl_cffi 0.17.0` / Chrome 152；RSS 仍负责发现工程文章。其他域名、显式 direct 请求及带请求体的请求沿用原传输。非默认安装位置用 `CURL_CFFI_PYTHON` 指定 Python 可执行文件；Docker 镜像已安装到 `/opt/curl-cffi`。

该传输沿用出站代理，将连接固定到已检查的公开 IP，每一跳重定向重新校验。API、worker 和手动脚本通过同一 `AGIDawn_DATA_DIR/curl-fetch/` 下的文件锁共享限速：一个请求完成后至少等待15秒，包括语言重定向，不并发、不自动重试。限速等待不占用原有累计网络超时，响应体积限制仍生效。Linux `flock` 在进程退出时释放；限速时间保存在锁文件内，正常重启后继续生效。多容器须共享同一数据卷。

升级安装依赖后重启 API 和 worker。此前已失败的正文不会因 RSS 再次成功而自动恢复，可在内容诊断页“重新提取正文”，或在运行页按失败原因重新处理。原有正文、笔记、分类和归档保持。代理或原站策略变化仍可能返回403，正文是否取得以正文处理状态为准。

## 本机常驻运行

### 新文章自动翻译

升级后执行新增迁移，再显式初始化模型预算：

```bash
node --env-file=.env scripts/migrate.ts
node --env-file=.env scripts/init-reader-translation.ts --database reader_dev
```

在当前工作副本的私有 `.env` 填写 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`，确认后设 `MODEL_CALLS_ENABLED=true` 并重启 API、worker 和重新构建的 web。本机沿用既有的 `mimo-v2.6-flash` 模型服务配置；不要复制另一数据库的连接、登录凭据或采集开关。模板默认关闭模型调用。

reader 模块每五分钟翻译新收录且已取得正文的外文文章。新建文章时事务内登记资格，已有文章即使重新发布也不自动加入。没有译文时显示原文，完成后刷新可见中文；部分翻译会提示并保留未译段落。私人快照及阅读位置继续对应原文。来源撤销全文许可时，公开页面同时隐藏原文和译文。

标题与摘要翻译升级需执行新增的 `0106_reader_metadata_translations.sql` 迁移，并重启 API、worker 和重新构建的 web。同一定时任务会补齐已有公开文章的外文标题与摘要，每轮最多30篇；没有正文或来源不允许全文时也能翻译公开摘要，正文权限保持。列表与详情优先显示已有中文译文，详情的元信息行提供来源原文入口。中文字段保持原样，缺失摘要不生成新摘要；源标题或摘要改变后旧译文立即不再展示，worker 下次处理新版本。补译继续使用现有模型与 `llm` 预算，不重译已保存正文，不删除原文、笔记或归档。

初始化保留人工预算；缺少 `llm` 预算时不发送请求。默认沿用原项目请求上限：每分钟300、每小时6000、每天40000。每批约3500字符，单篇最多处理60000字符；超出部分保留原文。关闭开关或预算等待不消耗文章重试次数，单篇处理失败三次后停止自动重试。回执结果未知时沿用现有恢复机制，不直接重发。此次升级不删除文章、笔记、归档或阅读位置。

### 文章阅读工具更新

2026-10-31。重新构建并重启本机 web 后刷新页面。普通文章不再提供站内语言切换；阅读设置移至右下角，新增专注模式，原文链接位于元信息行。无需数据库迁移或更改 worker。

此次更新删除浏览器中的旧单篇图表长期隐藏偏好（`agi-dawn-figure-notices-v1:<articleId>`），替换为仅本次访问关闭；刷新或重新进入文章后恢复提示。全局永久禁用键 `agi-dawn-figure-notices-v1` 保留，可在阅读设置里恢复。只清理显示偏好，不删除文章、笔记、归档或数据库记录。

主题切换移至公开页面右下角的太阳／月亮按钮，左侧入口移除；“我的”页面继续提供浅色、深色、跟随系统。主题偏好使用 `agidawn-theme`。重新构建并重启web后刷新即可。

2026-11-01 的 ReasonDialog/Menu 迁移新增固定版本 Radix 依赖。升级工作副本后先按锁文件安装依赖（`npm ci`），再构建并重启 web；开发 web 也需要安装新依赖。无需数据库迁移或重启 API/worker，图片加载策略保持原状。交互验收与性能成本见 [Radix 与 LCP 基线](reader/radix-lcp-acceptance.md)。

### AGIDawn 标识升级

2026-10-31。运行标识统一为 `agidawn`，文档和文件名中的项目名统一为 `AGIDawn`。本机项目目录改为 `/home/laoq/Project/AGIDawn`，已有 systemd 用户服务的工作目录、启动路径及工具链 PATH 随之更新；Codex 或编辑器需要重新打开新目录。原项目版权与品牌声明保留在 NOTICE。实际数据库名和私有 `.env` 保持原有配置；代码中的默认数据库名为 `agidawn`，已部署实例继续使用显式 `DATABASE_URL`。

本机 Python 虚拟环境的启动脚本、pip 路径，以及 Playwright WebKit 缓存中指向项目浏览器依赖的符号链接也已同步新目录。迁移其他副本时，需要一并核对这些绝对路径；仅修改 systemd 的工作目录不足以修复工具链引用。

浏览器仅使用 `agidawn-*` 品牌键，不再执行旧品牌 localStorage/sessionStorage 自动迁移。已使用当前键的偏好、草稿和搜索历史保留；仅存于旧键的外观偏好需要重新设置，旧条目不删除。文章、私人笔记、收藏和阅读位置仍保存在数据库中。

标识升级初期曾运行独立 web 预览服务：`http://127.0.0.1:3100` → 原有 API `http://127.0.0.1:3001` → 原数据库。以下预览步骤记录当时的对照方式；当前生产地址与端口以“服务管理”一节为准。预览只启动 web，不启动第二个 API/worker，不运行数据库迁移、seed 或来源配置维护脚本。网页正常访问仍经原 API 处理阅读统计及用户主动操作，不是数据库只读权限隔离。

本机预览使用独立 transient systemd 用户服务，不加载 `.env`，不设置开机自启，也不重新构建或重启原服务。复现启动（先使用本机 Node 24.22.1 工具链，并确认 3100 空闲）：

```bash
systemd-run --user --unit=agidawn-preview-web --property="WorkingDirectory=$PWD" \
  --property=Restart=on-failure --property=RestartSec=5 --property=UMask=0077 \
  --setenv=NODE_ENV=production --setenv=WEB_HOST=127.0.0.1 --setenv=WEB_PORT=3100 \
  --setenv=API_BASE_URL=http://127.0.0.1:3001 --setenv=SITE_URL=http://127.0.0.1:3100 \
  "$(node -p process.execPath)" "$PWD/apps/web/server.ts"
systemctl --user status agidawn-preview-web.service
journalctl --user -u agidawn-preview-web.service -n 50 --no-pager
systemctl --user stop agidawn-preview-web.service
```

预览与原站共用当前工作副本的已构建静态文件；对照观察期间不重新构建、不修改页面代码。需要同时比较不同构建版本时，先隔离构建目录或工作副本。浏览器 localStorage 按来源（含端口）隔离，3100 不会自动读取 3000 的本地显示偏好；Cookie 不按端口隔离，同一主机上的登录与退出由原 API 统一处理。

后续正式切换后端时，再停止 API、web、worker 及维护 timer，完成数据库和归档资源的配套备份。先核对服务所属工作副本，使用该副本的 `.env`，将下例 `reader_dev` 换成实际数据库名：

```bash
node scripts/local-reader.ts stop
node --env-file=.env scripts/backup-reader.ts --local-only
# 预览：核对待改来源数量，不写库。
node --env-file=.env scripts/rename-reader-brand.ts --database reader_dev --from '<旧配置命名空间>'
# 已确认来源配置后，将顶层键迁移为 _agidawn。
node --env-file=.env scripts/rename-reader-brand.ts --database reader_dev --from '<旧配置命名空间>' --apply
node --env-file=.env scripts/rename-reader-brand.ts --database reader_dev --from '<旧配置命名空间>'
npm run build -w @agidawn/web
node scripts/local-reader.ts start
node scripts/smoke.ts --base http://localhost:3000
```

维护脚本要求用 `--from` 显式指定 `sources.config` 中待迁移的旧命名空间，将其整值移动至 `_agidawn`；旧键不能为空，也不能等于 `_agidawn`。保留首次采集数量、月份及其他配置，并逐来源记录审计。已有新旧键且内容不同时整批拒绝；相同内容合并为新键；重复执行零变更。它不属于发布迁移，重复 seed 也不能替代此步骤。来源配置迁移与新版本代码须在同一次停机中完成；历史 `articles.raw`、旧审计、笔记和归档不改写。回退使用升级前的配套备份及旧代码。本机已核对11个来源均使用 `_agidawn`，无需再次迁移。

外部调用 `POST /api/ingest/items` 的客户端须使用 `raw._agidawn`；`backfill`、`baseline` 的含义不变。旧 OpenAPI v1 文档文件已删除，其退休地址继续返回不存在。

管理员登录 Cookie 使用 `agidawn_admin`、OAuth 状态 Cookie 使用 `agidawn_oauth_state`；从旧版升级后需重新登录，进行中的 OAuth 登录需重新发起。其他标签页应一并刷新。现有 `agi-dawn-*` 阅读显示键、匿名互动 Cookie 和私人阅读数据不变。

### 服务管理

本次Linux工作副本使用systemd用户服务托管API、生产构建web和worker，复用现有 `article-reader-pg` 容器。它是本机运行方式，始终绑定127.0.0.1，不开放公网端口。

本机生产网页使用 `http://localhost:4040`，API仍使用 `http://127.0.0.1:3001`，独立开发网页保留3000端口。生产web的systemd覆盖文件 `~/.config/systemd/user/agi-dawn-web.service.d/ports.conf` 设置 `WEB_PORT=4040 SITE_URL=http://localhost:4040`；私有 `.env` 的 `SITE_URL` 同步为该生产地址，使API和worker生成的链接一致。修改覆盖文件后执行 `systemctl --user daemon-reload`，重新构建web并重启生产API、web和worker；就绪后执行 `node scripts/smoke.ts --base http://localhost:4040`。独立开发服务不需要随生产更新重启。

先完成上述初始化与构建，再在工作副本根目录运行：

```bash
# 本机私有工具链；其他机器使用自己的Node24.22.1和PG17客户端
export PATH="$PWD/.data/pg-tools/usr/lib/postgresql/17/bin:$PWD/.data/toolchain/node_modules/.bin:$PATH"
node scripts/local-reader.ts install
node scripts/local-reader.ts start
node scripts/local-reader.ts status
node scripts/local-reader.ts logs
node scripts/local-reader.ts restart
node scripts/local-reader.ts stop
```

`install`写入当前用户的systemd目录并校验配置；unit只引用工作副本.env，不复制密钥。`start`启动已有PG容器并启用 `agi-dawn.target`，用户登录后自动启动。`stop`停止应用及两个timer，保留PG容器；不取消下次登录自动启动，如需取消运行 `systemctl --user disable agi-dawn.target`。所有控制命令核对实际加载unit的工作副本归属，不操作另一副本的同名服务。

进程异常退出由systemd自动重启，主动停止不会复活；日志用journalctl保留。`status`的active表示进程状态，启动后API监听可能晚于web，HTTP就绪再执行smoke；本机重启不承诺零停机。机器关机或休眠期间不能采集。此轮未修改用户linger设置，也未进行整机重启验收；PG容器已配置 `unless-stopped`，跟随Docker恢复。

当前11个已确认来源在本机私有.env中开启 `COLLECT_ENABLED=true`，采集间隔为720分钟（12小时），后台新增与初始化默认值相同。自动调频已移除，后台单独修改的间隔会保留。模板和测试仍关闭外部采集。原有五源全文已按站主授权开启，新增六源保持默认 `site_fulltext=false`，通知及IndexNow保持关闭。

2026-10-31采集间隔更新：执行新增迁移 `0107_source_collection_interval_default.sql`，重新构建web并重启API、worker与web；worker启动会清除旧自动调频定时任务及其待执行队列，保留历史执行记录。迁移只调整数据库默认值，不覆盖已有来源；本机11个来源另行更新为720分钟，下一次采集按上次采集完成时间加12小时重新计算，避免仍沿用旧的1小时计划。不删除文章、来源游标或私人阅读数据。失败等待不短于来源间隔；无新文章告警改为1440分钟（24小时）。若私有环境中填写过 `ALERT_QUIET_MINUTES`，也需同步调整该覆盖值。到期检查、正文处理与翻译频率保持。

本地备份timer每天上海时间04:10执行现有 `--local-only`，观察timer每天20:00写本地报告；均不上传、不发消息。可手动运行：

```bash
systemctl --user start agi-dawn-backup.service
node --env-file=.env scripts/reader-status.ts --write
```

报告在 `.data/observation/latest.json` 与按上海日期命名的JSON中，起点在 `started.json`；包含全部来源的采集、正文失败/重试、当前归档、已登记资源大小和最新完整备份，不含正文或笔记。`windowElapsed`仅表示七个日历日已过去，不等于连续运行或试用通过；一周后还要检查日报、采集间隔及实际使用反馈。详见[第二阶段验收](reader/phase2-acceptance.md)。

## 首批分类与主题标注

站主已确认六类、十四主题及首批96篇人工试分。`industry/reader-taxonomy.json` 是这一次维护的明确清单，按来源ID和原文URL匹配文章；不自动作用于未来新文章。缺少目标、已有分类冲突、标签超过20个或可见性改变时拒绝应用，不自动跳过或重试。

在该工作副本内先运行检查，再停止本机应用并做本地完整备份。PG容器会继续运行，备份不上传。使用本机Node和PG工具链：

```bash
node scripts/local-reader.ts stop
node --env-file=.env scripts/backup-reader.ts --local-only
node --env-file=.env scripts/apply-reader-taxonomy.ts --database reader_dev
# 核对预览及清单后，已批准的标注一次提交：
node --env-file=.env scripts/apply-reader-taxonomy.ts --database reader_dev --apply
node --env-file=.env scripts/apply-reader-taxonomy.ts --database reader_dev
node scripts/local-reader.ts start
node scripts/smoke.ts --base http://localhost:3000
```

默认预览是只读事务；`--database`必须与实际库名一致，CLI要求本机地址。应用把新分类、文章人工覆盖、发布投影与审计放在同一个事务中。旧手工标签优先于来源继承标签，新增主题与之合并；原文、正文版本、笔记及人工下架不改。重复应用已满足的清单不新增覆盖/审计；人工重新分类或改名后不要盲目重复执行旧清单。

第三阶段的主题文件现作为初始化模板，第四阶段网页主题管理将目录存入数据库；日常新增、改名和编辑说明在后台完成，无需重启API。旧安装升级时需执行下文的目录迁移与初始化。首批标注结果和仅摘要条目的复核范围见[第三阶段验收](reader/phase3-acceptance.md)。

## Docker 与 HTTPS

`node scripts/init-env.ts` 后运行 `docker compose up -d --build`。Compose 使用独立 `agi-dawn` 项目、`reader` 库和持久 data/db 卷；setup完成迁移、退休状态清理、seed后才启动API/worker。默认不开采集/推送。本机 PG 容器不等于已验证整套应用镜像，实际验证范围见实施记录。

公开上线前配置正式 `SITE_URL`、`SITE_DOMAIN`、管理员凭据、来源许可与站主确认的条款。反向代理存在时设置 `TRUST_PROXY=true`，保证只有可信代理能直达应用。`docker compose --profile https up -d --build` 可启用 Caddy。CDN 不得覆盖公开响应与私人接口的 `no-store`，不得提供 stale-if-error 正文。

## 备份与恢复

```bash
node --env-file=.env scripts/backup-reader.ts --local-only
```

显式本地模式不宣称已上传。配置 `.env.example` 的对象存储凭据后省略 `--local-only`，完整清单最后上传。每次备份组有独立 ID，本地保留最近三个完整组；失败产物不能作为完整组恢复。

在 `.data/backups/` 选取 `*-group-*.json`，确认 `complete:true`，逐项核对 artifacts 的文件名、字节数和 SHA256。创建**另一个空数据库**和**另一个空资源目录**，用该组的 dump 与 tar 恢复：

```bash
createdb reader_restore
pg_restore --exit-on-error --no-owner --dbname=reader_restore /绝对路径/同组.dump
mkdir -p /绝对路径/restored-data
tar -xzf /绝对路径/同组.tar.gz -C /绝对路径/restored-data
DATABASE_URL=postgres://127.0.0.1:5432/reader_restore node scripts/verify-reader-archive.ts --data-dir /绝对路径/restored-data
```

凭据用PG环境或本机凭据文件提供。验证通过后，让API/worker的 `DATABASE_URL` 和 `AGIDawn_DATA_DIR` **一起**指向恢复位置；再登录检查笔记版本、正文版本、图片和指定版本ZIP。仅恢复数据库不能恢复离线图片。归档目前不自动物理GC，预留资源容量并监控备份。

新版私人资料已完成[两次隔离恢复验收](reader/phase4-final-restore-acceptance.md)：在准备库创建非空笔记、状态、命名视图与阅读位置后备份，再恢复到第二个新库/目录；核对文本、版本、时间、资源及浏览器功能。演练备份落在独立目录，避免触发原备份的三组轮转；临时API/web使用独立端口和凭据，不启动worker或外部采集，完成或中断后关闭隔离进程并恢复原服务。完成标记需在原资料对照、服务active及smoke均通过后生成。

## 更新与回退

### 摘要与阅读显示规范化

2026-11-05。一起更新API、worker和重建后的web，无新增依赖或数据库迁移。标题摘要改用纯文本翻译要求；来源筛选统一外观，阅读设置改为三档单选，目录默认展开且保留手动折叠，公开页面省略未开放收藏占位。

公开读取先沿用来源许可、原文版本和图片快照检查，再清理本次已核实的来源杂质；展示层不重写原始记录，不调用模型，也不重新登记现有正文的翻译资格。仅为修复显示问题无需批量重新提取。Google新增来源模板还排除了头部发布日期；已有来源若需合并该选择器，应使用后台来源管理保留其他配置，不能重复seed覆盖。

本机随后获得存量修复授权，停机后生成完整备份组 `reader-dev-group-20261105010152729-be0321e3-d4d3-4f5a-be7a-585b321c413d.json`，先在独立数据库与资源目录恢复并校验，再按同一计划对57篇文章定向维护：56篇正文、12篇原摘要和11篇译文元信息的杂质得到清理（范围有重叠）。正文语义变化沿用修订入口，纯HTML变化沿用展示更新；共创建56个新快照，按原URL复用既有归档资源，保留原有缺图与partial标记，未抓取新图片或付费重译。原有快照、笔记、收藏阅读状态、命名视图、阅读位置、人工覆盖与付费回执的校验摘要保持一致；旧阅读位置仍对应旧快照，不套用到新HTML。Google运行时规则通过现有管理函数合并，保留其他配置和全文许可。本机4040服务已恢复，维护记录在私有 `.data/verification/reader-content-polish-2026-11-05/`。

单纯回退程序可切回旧代码和web构建；若还需撤销上述持久内容修复，按“备份与恢复”将同组dump与资源恢复到新库、新目录并一起切换，不能仅回退代码或只恢复数据库。

### 正文组件管道与 Browser Use 适配

2026-11-01。更新 API 和 worker；没有新增依赖、数据库迁移或前端代码变化。通用代码块、表格与图形转换从正文获取中分离，原有 `detail.preserve`、`detail.removeSelector` 规则保持原意。Browser Use 增加显式的 `detail.bodyAdapter: "browser-use"`，将已核实结构的作者区和三类图表转换为通用段落／表格；未能完整转换的图表仍提示不完整。

部署不会修改已有数据库配置。若要启用，先按本节既有要求核对服务与数据归属并完成备份，再通过后台来源管理为 Browser Use 的 `config.detail` 合并 `bodyAdapter`，保留其他配置与全文许可；不要重复 seed 覆盖来源。存量文章需要另行明确授权后通过现有“重新提取”入口更新，已有翻译资格依原流程匹配新正文，保留历史快照、私人资料和旧阅读位置。回退旧代码前先从运行配置移除 `bodyAdapter`，旧代码会拒绝这个新字段；已生成的段落／表格使用既有 HTML 格式，无需反向改写。

### 代码块元信息与阅读样式

2026-11-01。重建web并一起更新API、worker、web，无新增依赖或数据库迁移。`detail.preserve` 增加可选 `kind`（code／prompt）和 `language`（语言元素选择器），既有规则保持原意；声明语言可位于pre或code。代码块的规范元信息通过HTML清洗、翻译与归档保存，客户端提供新的行号、折叠及复制栏。

已有Claude来源需通过来源管理补充模板中的两条 `.art-code` 规则，保留其他来源配置与全文许可。仅部署不会重写已有正文。对需要规范化的旧文章先备份再显式重新提取；若逐节点核实原文只移除了组件头部、代码内容完全相同，可在当前原文／版本条件下复用原有完整译文并写维护审计，无需因显示元信息变化重新调用模型。原文确有变更时仍走现有翻译流程。旧快照保持原样；新HTML对应新归档和阅读位置身份，原有笔记、收藏及旧位置保留。

### Google Developers Blog 正文控件清理

2026-10-31。提取规则新增可选的 `detail.removeSelector`，无需数据库迁移或前端重建；更新 API 和 worker 后生效。Google 来源使用 `.navigation-container` 排除底部翻页控件，`detail.preserve` 将 `.code-block:has(pre code)` 按 `pre code` 保存，移除原站语言标签、复制提示及按钮，并保留代码语言。

模板不会覆盖已有来源。已有实例先核对服务、数据库和资源目录，停止服务并执行本地配套备份，再通过现有来源管理更新对应来源的 `config.detail`，保留其他配置与全文许可。恢复服务后，对需要清理的已收录文章使用管理员“重新提取”入口；已有翻译资格会随新正文重置，worker 按原有回执和预算更新中文。没有正文变化的文章保留已有译文。历史快照不改写，干净正文保存为新版本；笔记、收藏、分类、主题与旧阅读位置保留，旧位置不套用到变化后的正文。

普通文章列表改用数字分页：`page` 默认1，`limit` 仅接受25/50/100、默认25，接口返回总数和总页数。更新时重建web并一起更新API/web；没有迁移、回填、环境变量、依赖或已有资料变更。普通列表旧 `cursor` 地址与旧的其他limit值不再支持，需从首页重新筛选；纯筛选链接继续可用。私人书库的游标及其默认篇数保持原约定。页码和总数按当前文章集合计算，新收录或撤回后同一页的内容可能变化；超出末页的网页地址会归到实际末页。详见[文章数字分页验收](reader/pagination-acceptance.md)。

本机全文展示已通过现有信源配置启用：`reader_dev` 内五个既定信源的 `site_fulltext=true`，普通文章页无需登录即可读已保存正文和允许展示的本地图片。修改经现有管理员更新、审计与来源重发布队列完成，无业务代码或迁移变更；`industry/sources.json` 仍为默认关闭的模板，seed不覆盖既有来源。需要调整时在后台信源设置修改该项并等待重发布完成；笔记、收藏、阅读状态、私人快照和ZIP始终由管理员接口保护。当前服务只监听127.0.0.1，未进行公网部署；详见[本机全文验收](reader/local-fulltext-acceptance.md)。

第四阶段首批增加私人书库五条件筛选及文章页主题勾选，无新增依赖、环境变量或数据库迁移。更新需重建web并重启API/web。私人书库游标现在绑定筛选条件；旧版带游标的分页链接需重新点击“筛选”或“清除筛选”生成，不修改已有文章、笔记、状态或归档。详见[本机验收](reader/phase4-acceptance.md)。

第四阶段关键词搜索同样无需迁移、回填或依赖安装；先构建web，再一起更新API/web。搜索直接分批读取已有文章、当前快照和笔记，不新增持久索引。游标增加关键词规范化绑定，升级前的书库分页链接需重新筛选；已有数据不改。GET搜索会将主动输入的关键词保留在本机浏览器地址历史，API访问日志不记录query string。搜索结果仍只在管理员入口返回且 `no-store`。详见[搜索验收](reader/phase4-search-acceptance.md)。

第四阶段批量整理无需迁移、依赖或环境变量变更。重建web并一起重启API/web，列表新增的分类版本用于批次乐观检查；已有筛选链接继续可用，刷新后再勾选文章。批量修改复用人工覆盖与审计，一个事务内完成，不回填、不删除历史数据。真实本机数据采用只读预览验收，写入及回滚行为在隔离测试库验证；详见[批量整理验收](reader/phase4-bulk-acceptance.md)。

第四阶段批量收藏与阅读状态同样无需迁移、依赖、环境变量或回填。备份后重建web并一起重启API/web，刷新书库后再勾选文章。新操作使用列表已有的私人状态版本，与分类主题分别提交；单篇和批量写入协调状态版本，任一冲突或审计失败整批回滚。原筛选链接继续可用，不改变笔记、分类主题、正文或归档。详见[批量状态验收](reader/phase4-bulk-state-acceptance.md)。

第四阶段命名搜索与筛选视图新增模块迁移 `0102_reader_saved_views.sql`，仅创建独立视图表，不回填或改写已有文章资料。先核对工作副本服务归属，暂停并完整备份，再运行 `node --env-file=.env scripts/migrate.ts`、`npm run build -w @agidawn/web`，一起更新API/web后恢复服务并执行smoke。无需新增依赖或环境变量。视图记录随数据库dump保存，既有视图链接使用六项条件，不包含分页游标。删除视图不删除文章、笔记、收藏、状态或归档；详见[命名视图验收](reader/phase4-saved-views-acceptance.md)。

私人笔记 Markdown 导出本身无需迁移；配套继续阅读新增 `0103_reader_positions.sql`，只创建独立位置表，不回填、修改或删除既有文章、笔记、状态、分类主题或归档。仍先暂停已核实的本机服务并完整备份，再迁移、重建web并一起更新API/web，完成smoke后恢复worker及定时器。无需新依赖、环境变量或seed。位置与书库视图、笔记一起随完整数据库dump保存，图片仍需同组资源包。

阅读位置使用原始快照正文和格式版本的内容标识，标题、作者、来源名称变化可继续使用同一位置；正文HTML变化时各版本位置独立保存，不能只凭正文修订号恢复。目录锚点在响应时生成，不改不可变快照、历史ZIP或公开资料。导出只读服务端已保存内容，不隐式保存未提交草稿，不把私人笔记加入原有ZIP或公开接口。位置写入单独检查版本，冲突不自动覆盖；离页尽力发送最后进度，不能保证断电或断网时提交成功。详见[笔记导出与继续阅读验收](reader/phase4-note-export-reading-acceptance.md)。

私人笔记回顾与批量Markdown导出无需迁移、seed、依赖或环境变量变更。暂停已核实的本机服务并完整备份，重建web并一起更新API/web，验收后恢复worker及定时器。已有命名视图不改写；缺少笔记筛选及排序的旧记录仍按全部笔记、收录时间打开。游标保留数据库微秒并绑定新条件，升级前的带游标链接需重新筛选，普通筛选链接和视图继续可用。批量ZIP只读同一个数据库快照；其内容与原有正文ZIP分开，包含服务端已保存的私人笔记。详见[笔记回顾与批量导出验收](reader/phase4-note-review-bulk-export-acceptance.md)。

第四阶段网页主题管理新增 `0101_article_topics.sql`，只创建目录表，不改写文章、来源标签、人工覆盖或私人资料。已有安装先暂停服务并备份，再迁移、显式初始化、构建并启动：

```bash
node scripts/local-reader.ts stop
node --env-file=.env scripts/backup-reader.ts --local-only
node --env-file=.env scripts/migrate.ts
node --env-file=.env scripts/seed-topics.ts
npm run build -w @agidawn/web
node scripts/local-reader.ts start
node scripts/smoke.ts --base http://localhost:3000
```

新安装按README运行 `scripts/seed.ts` 即会初始化主题。重复运行两个初始化入口都不会覆盖后台名称、说明或匹配关系；修改模板不更新已存在的主题。运行时主题项只读数据库，初始化后新增、改名、编辑说明无需重启；分组仍由模板配置，本批管理页只新增技术主题。原14项的slug与匹配标签保留，旧书库筛选和主题链接继续可用，无需回填或删除历史数据；既有备份流程会随数据库dump保存新目录。无新依赖或环境变量。详见[主题管理验收](reader/phase4-topic-management-acceptance.md)。

此分支是新站改造，`0100_reader_drop_*` 删除模型分析、翻译、评分、事件、报刊、精选推送、模型价格表及其专属列。历史迁移不改写，DDL不带CASCADE。**不能把这些迁移直接用于原运营库。** 本机原checkout与原数据保持独立；若要导入旧站数据，应另设计备份副本上的迁移，不属于当前升级路径。

站内互动统计新增核心迁移 `0105_article_engagement.sql`，仅建表，不回填或删除已有数据。升级时完成备份后运行 `node --env-file=.env scripts/migrate.ts`，再运行 `npm run build -w @agidawn/web` 重建web并重启API/web；无需新增依赖或环境变量，依赖既有 `SESSION_SECRET` 与配置正确的 `SITE_URL`。SSH 本地端口转发可使用与 `SITE_URL` 相同协议、主机名的不同端口；互动写请求的 Origin 仍须与原始 Host（含端口）一致，不信任 `X-Forwarded-Host/Proto`。历史从统计启用后累计。文章详情进入前台时计一次，同一浏览器对同一篇文章30分钟内去重；计数不表示读完或独立人数。匿名点赞按同一浏览器同篇文章一票，可取消。公开收藏统计显示“—”，暂未开放；管理员私人收藏仍只对管理员可见。清除 Cookie 或更换浏览器无法把访问认作同一人。

更新前完成配套备份，停止worker，安装锁定依赖并迁移/构建，启动API/web/worker，再运行 smoke。失败时使用旧代码与其对应的完整备份组恢复到新库/目录；不要在已删列的新schema上直接运行旧版代码。生产服务不通过修改迁移账本回退。
