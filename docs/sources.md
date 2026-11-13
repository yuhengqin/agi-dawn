# 信源配置

当前11个来源及真实采集限制见 [来源验收](reader/source-inventory.md)，可运行的配置位于 `industry/sources.json`。`scripts/seed.ts` 只插入不存在的ID；后台 `/admin/sources` 可新增、修改、预览和暂停，修改带版本检查与审计。

默认采集间隔为720分钟（12小时），后台新增、API与初始化共用 `site/site.ts` 的 `SOURCE_DEFAULTS.intervalMinutes`；数据库默认值由迁移维护。当前11个来源也使用720分钟。后台可以单独修改，程序不再按文章数量自动调频。worker每分钟检查到期来源；成功采集后从完成时间再等待一个间隔，不固定在每天某两个整点执行。

支持 RSS/Atom（`rss`）、HTML/Markdown列表（`web_list`）、JSON列表（`json_list`）、X搜索（`x_search`）、微信公众号（`mp_account`）和外部推送（`external`）。当前实际接入RSS、HTML和页面内嵌JSON。仅 `participation_mode=editorial` 的文章可公开；其他参与模式不会进入阅读列表。

## 只读契约漂移检查

`.github/workflows/source-contracts.yml` 每周一09:17（上海时间）及手动触发时，对 `industry/sources.json` 的公开列表模板执行只读探针。它复用当前RSS、HTML和JSON解析器，再应用URL、分类和噪声筛选；不读取 `.env` 或运行时数据库，不提取正文、不调用付费服务、不收录文章，也不修改后台来源。OpenAI所需的浏览器指纹传输使用GitHub runner的隔离临时目录，报告不包含私人资料。

每个来源分为 `unchanged`（仍能解析并有通过筛选的条目）、`review-required`（解析或筛选结果需要人工对照原站）和 `check-failed`（网络、HTTP或检查器未完成）。后两类不直接证明上游损坏。JSON与Markdown报告始终保留14天；需要复核时，工作流按稳定语义指纹创建或更新一个 `source-contract-drift` Issue，同指纹不覆盖人工编辑，重复机器Issue会关闭。只有完整成功的 `unchanged` 报告才自动关闭机器Issue；检查失败保留现状。它补充现有worker信源周报，不替代真实来源验收，也不检查仅在数据库中修改过的运行配置。

本地显式运行同样只写指定报告及传输临时状态，不加载 `.env`：

```bash
export AGIDawn_DATA_DIR="$(mktemp -d)"
export CURL_CFFI_PYTHON="$PWD/.data/curl-cffi/bin/python"
node scripts/check-source-contracts.ts \
  --output /tmp/source-contracts.json \
  --markdown /tmp/source-contracts.md
```

该命令访问真实公开列表；`review-required` 以状态码2退出，`check-failed` 以1退出。自动测试通过本地替身覆盖报告与Issue生命周期，不访问真实来源。

## 常用配置

RSS 使用 `feedUrl`，可用 `allowCategories` / `denyCategories` 限定范围。摘要不足正文时排入提取；只有来源明确说明摘要就是正文，才配置 `summaryIsBody=true`。不要把媒体文件地址当作文章页。

HTML列表使用 `url`、`parseMode=html`、`itemSelector`、`linkSelector`、`titleSelector`、`publishedAtSelector`。用 `allowUrlPrefixes` / `denyUrlPrefixes` 排除栏目导航。一个列表里的重复URL会先判重再使用详情预算。

Browser Use 的RSS没有分类字段，因此使用 `json_list` 的 `mode=html_json_key` 读取页面内嵌 `posts`，包含置顶文章。现有 `requireBoolean` 配置实际对 `path` 指向的值执行严格相等比较；该源用 `{"path":"category","equals":"Engineering"}`，缺失分类和其他分类全部排除。不要改成抓取全部 `/posts/` 链接，也不要根据标题中的 Engineering 字样判断类别。

`detail` 可配置 `maxFetches`、`titleSelector`、`summarySelector`、`authorSelector`、`publishedAtSelector` / `publishedAtRegex`；作者读取声明的署名元素，缺失时保留为空。`publishedAtUtcOffset` 指定无时区时间的来源偏移，默认 `+08:00`。只有来源日期规则确实权威时使用 `publishedAtAuthoritative`，否则允许页面元数据补齐。

代码组件可用 `detail.preserve` 声明 `{selector,as:"pre",code,caption,kind,language}`：`code` 指定正文元素，`caption` 是保留在块外的说明；可选 `kind` 为 `code` 或 `prompt`，`language` 是组件内声明语言的元素选择器。代码原有的首尾缩进与换行保留。规范HTML使用 `pre[data-code-kind][data-language] > code.language-*`，类型和语言跨正文清洗、翻译及归档保留，顶部栏只显示一次。显式语言优先于自动识别，Prompt与Text不自动高亮；Markdown导出保留标准语言fence，Prompt类型仅保留在HTML中。

Claude来源的 `.art-code.art-prompt` 保存为Prompt，其他 `.art-code` 从 `.ch .lang` 读取Text／Shell／TypeScript等语言；原站 `.ch` 工具条及复制按钮不进入正文。表格组件用 `{selector,as:"table"}`，适用于多列具有相同条目名称的描述列表，以及明确声明 `role=table/row/cell` 的完整矩阵；不猜测稀疏列或合并单元格。OpenAI 行号组件保留每行代码及缩进，行号不混入复制内容。安全代码、表格、MathML和可静态保存的SVG会保留。HTML-only KaTeX 保留经白名单校验的布局树，使用固定版本的本地样式和字体，不执行来源脚本；Markdown保留其HTML，离线ZIP附带相同样式、字体和许可证。样式依赖、无法保存的公式／图表和互动内容会标记不完整。

声明式规则不足以表达来源结构时，可显式设置 `detail.bodyAdapter`；当前支持 `"browser-use"`、`"openai"`、`"anthropic"` 和 `"ghost"`，未知值会被拒绝。Browser Use 适配器将作者名单整理为紧凑段落，将 Odysseys2 已知的完成数量、推理力度和双评判结果转换为表格，保留数值、列名与图注；相邻图片仅在替代文字相同且类名明确互斥时选择桌面／浅色版本。OpenAI 适配器只展开已验证 tab 与 tabpanel 双向绑定的正文案例；Anthropic 适配器保护含正文媒体或技术组件的媒体列；Ghost 在候选评分前将书签卡片规范成引用，保留作者前后评论。无法完整校验的图表继续使用通用图形／文字降级并提示不完整，不猜测缺失数据。这些规则不计算原站 CSS，也不执行页面脚本。模板只初始化新来源，已有实例须通过后台合并配置；部署或刷新页面不会重写存量正文与译文。Latent Patterns 的客户端简介壳不再作为完整正文，仍需取得实际正文才能保存。

`detail.removeSelector` 是可选的非空 CSS 选择器，在正文识别和图表转换前移除匹配元素及其内容；只用于已核实的非正文控件，不按文字删除段落。Google Developers Blog 模板排除底部 `.navigation-container` 及头部 `.summary-container .published-date`，并用 `preserve` 将 `.code-block:has(pre code)` 整体替换为 `pre code` 的内容，保留代码语言、清除重复语言标签和复制状态。来源模板只初始化新来源；已有来源需通过后台更新运行时配置。需要持久化修改旧正文时另行授权重新提取；本次已确认的显示杂质由公开读取兼容清理，无需为此重提取或付费重译。

RSS摘要按文章标题清理匹配的末尾 `The post … appeared first on …`，不使用通用长度阈值。公开展示另省略Uber的纯品牌占位，并对Huntley末尾残缺的实体预览保留最后完整句子；合法 `AT&T`、`A & B` 与短中文摘要保留。Ghost链接卡片只合并同卡片内完全相同的标题与说明，正文中的重复措辞不作全局删除。

配置项按来源类型校验，未实现的项返回错误，不能靠填写未知字段扩展采集器。完整允许字段见 `packages/backend/src/sources/config-keys.ts`。

## 范围、权限与重试

首次默认最多30篇、近12个月，可在 `_agidawn.initialBackfillLimit` / `initialBackfillMonths` 修改。正文处理与手动刷新最多三次，刷新失败保留旧正文并显示状态；并发旧结果不能覆盖新修订。来源暂停保留历史，人工下架不会因重采集撤销。

来源采集失败逐次延后，等待上限为6小时与该来源间隔中的较大值，因此12小时间隔失败后仍等待12小时。付费预算耗尽单独等待15分钟，不累计来源失败。整站超过24小时没有新文章才触发停收告警；它判断内容产出，不等于每个来源都发生了采集故障。

`site_fulltext` 默认关闭。获得RSS正文、成功提取页面与获得公开再发布许可是不同条件。来源未授权时只公开摘要与链接，管理员私人归档仍使用独立认证接口。公开搜索只检索当前获准公开的正文。

出站请求检查地址、重定向、体积和超时；只有管理员配置的内网订阅主机可作为列表入口，正文与图片继续拒绝私网地址。付费Jina/SocialData/Dajiala保留收据和预算，自动测试仅用本地假服务。

OpenAI 工程继续读取官方 RSS 的 Engineering 分类，`openai.com` 的公开 GET/HEAD 请求由站点部署配置启用 `curl_cffi` 浏览器指纹传输；其他域名沿用原实现。每个 HTTP 请求（包括语言跳转）完成后至少间隔15秒，API、worker 和手动脚本共用限速。原站可能按语言偏好跳转到中文正文，原文链接与文章身份仍保留 RSS 地址；这不代表模型翻译。安装及失败正文重跑见 [部署说明](deploy.md#openai-文章的浏览器指纹传输)。
