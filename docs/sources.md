# 信源配置

当前11个来源及真实采集限制见 [来源验收](reader/source-inventory.md)，可运行的配置位于 `industry/sources.json`。`scripts/seed.ts` 只插入不存在的ID；后台 `/admin/sources` 可新增、修改、预览和暂停，修改带版本检查与审计。

默认采集间隔为720分钟（12小时），后台新增、API与初始化共用 `site/site.ts` 的 `SOURCE_DEFAULTS.intervalMinutes`；数据库默认值由迁移维护。当前11个来源也使用720分钟。后台可以单独修改，程序不再按文章数量自动调频。worker每分钟检查到期来源；成功采集后从完成时间再等待一个间隔，不固定在每天某两个整点执行。

支持 RSS/Atom（`rss`）、HTML/Markdown列表（`web_list`）、JSON列表（`json_list`）、X搜索（`x_search`）、微信公众号（`mp_account`）和外部推送（`external`）。当前实际接入RSS、HTML和页面内嵌JSON。仅 `participation_mode=editorial` 的文章可公开；其他参与模式不会进入阅读列表。

## 常用配置

RSS 使用 `feedUrl`，可用 `allowCategories` / `denyCategories` 限定范围。摘要不足正文时排入提取；只有来源明确说明摘要就是正文，才配置 `summaryIsBody=true`。不要把媒体文件地址当作文章页。

HTML列表使用 `url`、`parseMode=html`、`itemSelector`、`linkSelector`、`titleSelector`、`publishedAtSelector`。用 `allowUrlPrefixes` / `denyUrlPrefixes` 排除栏目导航。一个列表里的重复URL会先判重再使用详情预算。

Browser Use 的RSS没有分类字段，因此使用 `json_list` 的 `mode=html_json_key` 读取页面内嵌 `posts`，包含置顶文章。现有 `requireBoolean` 配置实际对 `path` 指向的值执行严格相等比较；该源用 `{"path":"category","equals":"Engineering"}`，缺失分类和其他分类全部排除。不要改成抓取全部 `/posts/` 链接，也不要根据标题中的 Engineering 字样判断类别。

`detail` 可配置 `maxFetches`、`titleSelector`、`summarySelector`、`authorSelector`、`publishedAtSelector` / `publishedAtRegex`；作者读取声明的署名元素，缺失时保留为空。`publishedAtUtcOffset` 指定无时区时间的来源偏移，默认 `+08:00`。只有来源日期规则确实权威时使用 `publishedAtAuthoritative`，否则允许页面元数据补齐。

代码组件可用 `detail.preserve` 声明 `{selector,as:"pre",code,caption,kind,language}`：`code` 指定正文元素，`caption` 是保留在块外的说明；可选 `kind` 为 `code` 或 `prompt`，`language` 是组件内声明语言的元素选择器。代码原有的首尾缩进与换行保留。规范HTML使用 `pre[data-code-kind][data-language] > code.language-*`，类型和语言跨正文清洗、翻译及归档保留，顶部栏只显示一次。显式语言优先于自动识别，Prompt与Text不自动高亮；Markdown导出保留标准语言fence，Prompt类型仅保留在HTML中。

Claude来源的 `.art-code.art-prompt` 保存为Prompt，其他 `.art-code` 从 `.ch .lang` 读取Text／Shell／TypeScript等语言；原站 `.ch` 工具条及复制按钮不进入正文。表格组件用 `{selector,as:"table"}`。安全代码、表格、MathML和可静态保存的SVG会保留。样式依赖、无法保存的公式／图表和互动内容会标记不完整。

`detail.removeSelector` 是可选的非空 CSS 选择器，在正文识别和图表转换前移除匹配元素及其内容；只用于已核实的非正文控件，不按文字删除段落。Google Developers Blog 使用它排除底部 `.navigation-container`，并用 `preserve` 将 `.code-block:has(pre code)` 整体替换为 `pre code` 的内容，保留代码语言、清除重复语言标签和复制状态。来源模板只初始化新来源；已有来源需通过后台更新运行时配置，已有文章另行重新提取并更新译文。

配置项按来源类型校验，未实现的项返回错误，不能靠填写未知字段扩展采集器。完整允许字段见 `packages/backend/src/sources/config-keys.ts`。

## 范围、权限与重试

首次默认最多30篇、近12个月，可在 `_agidawn.initialBackfillLimit` / `initialBackfillMonths` 修改。正文处理与手动刷新最多三次，刷新失败保留旧正文并显示状态；并发旧结果不能覆盖新修订。来源暂停保留历史，人工下架不会因重采集撤销。

来源采集失败逐次延后，等待上限为6小时与该来源间隔中的较大值，因此12小时间隔失败后仍等待12小时。付费预算耗尽单独等待15分钟，不累计来源失败。整站超过24小时没有新文章才触发停收告警；它判断内容产出，不等于每个来源都发生了采集故障。

`site_fulltext` 默认关闭。获得RSS正文、成功提取页面与获得公开再发布许可是不同条件。来源未授权时只公开摘要与链接，管理员私人归档仍使用独立认证接口。公开搜索只检索当前获准公开的正文。

出站请求检查地址、重定向、体积和超时；只有管理员配置的内网订阅主机可作为列表入口，正文与图片继续拒绝私网地址。付费Jina/SocialData/Dajiala保留收据和预算，自动测试仅用本地假服务。

OpenAI 工程继续读取官方 RSS 的 Engineering 分类，`openai.com` 的公开 GET/HEAD 请求由站点部署配置启用 `curl_cffi` 浏览器指纹传输；其他域名沿用原实现。每个 HTTP 请求（包括语言跳转）完成后至少间隔15秒，API、worker 和手动脚本共用限速。原站可能按语言偏好跳转到中文正文，原文链接与文章身份仍保留 RSS 地址；这不代表模型翻译。安装及失败正文重跑见 [部署说明](deploy.md#openai-文章的浏览器指纹传输)。
