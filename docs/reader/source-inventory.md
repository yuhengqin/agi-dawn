# 来源清单与接入验收

## 2026-10-30 OpenAI 工程正文传输

`openai.com` 的公开 GET/HEAD 请求已接入 `curl_cffi 0.17.0` / Chrome 152，RSS 仍按 Engineering 分类发现文章。API、worker 和手动脚本共享每次请求完成后至少15秒的间隔，包括语言跳转；连接固定到校验后的公开 IP，重定向、累计网络超时和响应体积限制继续生效。其他域名沿用原传输。

新代码真实读取 Symphony 和 Core dump 两篇样本，均返回200并通过原有正文提取，分别约5521和7726字符，状态 ready；原站按语言偏好跳转到中文正文，RSS原地址与文章身份保留。未调用Jina或模型兜底。21篇既有失败正文已通过带审计的原有重新提取入口排队；补采按上述间隔在后台执行，正文是否取得以各篇处理状态为准，图表缺失仍标记partial。

验证：类型检查、595项完整后端测试、89项网页测试、生产构建、运行站点smoke通过；Docker基础运行镜像构建完成，并在无网络容器内确认固定版本的Chrome指纹可加载。并行检查时曾出现告警限速和WebKit计时用例失败，降低并行负载后完整复验通过，未修改相关断言。安装与更新见[部署说明](../deploy.md#openai-文章的浏览器指纹传输)。

## 2026-10-30 新增六个来源

用户指定的六个入口已加入 `industry/sources.json`，沿用每120分钟采集、首次最多30篇和近12个月的限制。配置默认 `site_fulltext=false`，不改变原有五源的本机全文设置。

| 来源 | 实际入口与范围 | 列表实测 |
| --- | --- | --- |
| Latent Patterns | [官方合并RSS](https://latentpatterns.com/rss.xml)，覆盖 Blog 与 Newsletter | 2条；包含日期和摘要，RSS未提供作者和正文 |
| Google Developers Blog · AI | [官网AI筛选页](https://developers.googleblog.com/search/?technology_categories=AI)，读取 `.search-result` | 首页10条；保留官网认定的AI多分类文章，不按卡片首个标签再次缩小范围 |
| Uber Engineering · AI / ML | [Uber AI栏目](https://www.uber.com/us/en/blog/engineering/uber-ai/)，仅取带 `AI / ML` 标签的文章卡 | 首页12条；文章地址在 `/us/en/blog/` 下，不能用栏目路径作为文章前缀 |
| Geoffrey Huntley | [官方RSS](https://ghuntley.com/rss/)，整个个人博客 | 15条；含作者、日期和正文 |
| Browser Use · Engineering | [文章页](https://browser-use.com/posts)的内嵌 `posts`，精确匹配 `category === "Engineering"` | 全部58条中保留23条 Engineering，包含置顶的 Odysseys2；首次入库仍受近12个月限制 |
| The Official Microsoft Blog | [根站官方RSS](https://blogs.microsoft.com/feed/)，不限定AI分类 | 10条；含作者、日期和正文，不代表所有 Microsoft 子站博客 |

Browser Use 的 [RSS](https://browser-use.com/rss.xml) 实测58条但无分类字段，不能用RSS分类过滤；HTML首页置顶文章只显示 Latest 标签，也不能只选普通文章卡。内嵌JSON保留每篇真实分类，现有采集器可直接过滤。自动回归使用本地生成的页面验证置顶文章保留，以及其他六类、缺失分类、近似分类和标题含 Engineering 的非工程文章均排除。

Google 全站RSS没有分类和发布日期，因此使用用户给定AI筛选页。该页标记425条结果，无筛选搜索页为2843条；浏览器通过JS回填选中的checkbox，静态HTML没有checked属性不代表参数失效。Uber指定栏目首页的12张卡均带AI / ML标签。两个HTML来源仅读取当前页；订阅源也只读取当次feed窗口，不自动补齐全部历史分页。

本机已执行seed，新增6源、保留原有5源；后台首次采集全部成功，共新增69篇：Latent Patterns 2、Google AI 10、Uber AI / ML 12、Geoffrey Huntley 15、Browser Use Engineering 20、Microsoft Blog 10。Browser Use另外3篇超过首次回填窗口，未收录；逐篇比对已入库20篇与页面分类，全部为Engineering，包含置顶文章。公开来源API已显示11源。新增文章68篇已取得正文；Latent Patterns的博客介绍仍为 `unconfirmed`，保留摘要和原文链接。

验证：Browser Use分类回归、类型检查、591项后端/模块测试、网页构建及运行站点smoke通过。网页测试首轮88/89通过，WebKit日期草稿用例输入不可见超时，单独重跑通过。真实验收脚本 `scripts/validate-reader-sources.ts --live` 已改为读取配置中的所有来源；原五源保留固定样本，新增来源默认检查最新文章。它会实际收录及归档，仅在需要再次真实验收时显式运行。

以下为首批五源的历史验收记录。

第二阶段2026-10-28复验：五源增量采集均成功，无重复identity；当前96篇、75篇正文。21篇OpenAI工程英文原文实际请求均403（不只是中文栏目403），已记录直接失败原因及有界重试。8篇样式依赖图表仍partial，具体状态见[第二阶段记录](phase2-acceptance.md)。以下保留首轮接入证据。

用户于2026-10-27提供以下五个URL。实际接入、提取质量与公开全文许可分开验收。来源默认 `site_fulltext=false`；有RSS正文不代表已获得公开全文再发布许可。

| 来源 | 入口与范围 | 读取方式 | 全文公开范围 |
| --- | --- | --- | --- |
| Shrivu’s Substack | <https://blog.sshh.io/> | 官方RSS <https://blog.sshh.io/feed>，实测200，20项；含作者、日期、正文 | 未确认公开全文授权 |
| OpenAI Developer Blog | <https://developers.openai.com/blog> | HTML资源卡片；文章页header读取作者和完整日期；正文 `article#mainContent` | 未确认公开全文授权 |
| OpenAI新闻中心·工程 | <https://openai.com/zh-Hans-CN/news/engineering/> | 全站RSS <https://openai.com/news/rss.xml>，按category `Engineering`过滤；英文feed，不承诺中文正文 | 未确认公开全文授权 |
| Anthropic Engineering | <https://www.anthropic.com/engineering> | SSR列表 `main#main-content article[data-listing-row]`，行内链接与time；链接可能落在 `/research/` | 未确认公开全文授权 |
| claude.dev | <https://claude.dev/> | 官方摘要RSS <https://claude.dev/rss.xml>，实测200，16项 | [条款](https://claude.dev/terms/)明确限制未经书面许可复制/再发布文章、图片、视频；代码样例MIT不能扩大到文章 |

开发者博客首页声明的 <https://developers.openai.com/rss.xml> 虽返回200，但本次138项没有 `/blog/` 条目，不能将其当作博客覆盖验收。Anthropic主页本次未找到官方RSS；不能据此认定全站永久没有RSS。

## 代表性阅读样本

| 样本 | 已确认结构 | 正文对照状态 |
| --- | --- | --- |
| [Shrivu 安全样本](https://blog.sshh.io/p/i-asked-100-agents-to-hack-me) | 图片、引用、列表、脚注 | 正文 ready，11/11 图片；恢复后断网打开无HTTP请求 |
| [OpenAI 技能评测样本](https://developers.openai.com/blog/eval-skills) | 代码块，文章header有作者与日期 | 7个代码块；作者/日期已补齐，断网打开无HTTP请求 |
| [OpenAI 系统故障样本](https://openai.com/index/core-dump-epidemiology-data-infrastructure-bug/) | RSS可确认标题和日期 | 本机正文请求未成功，明确 unconfirmed，不虚填正文或作者 |
| [Anthropic MCP工程样本](https://www.anthropic.com/research/code-execution-with-mcp) | 代码、文件树、架构图 | 声明CodeBlock保留规则后，原网页12个代码块全部保留，逐块文本一致；默认提取曾丢失这些组件，已修复配置 |
| [Claude 代码审查样本](https://claude.dev/blog/solving-code-review-at-anthropic/) | 表格与依赖原站样式的SVG流程图，多位作者 | 表格及图片可离线阅读；图表替代表示仍标 partial，不声称完整 |

字节数是只读调查的响应体积，未包含图片总量，不作为最终归档容量预算。上述样本未确认包含LaTeX公式；公式支持使用本地生成样本验证，不虚称覆盖真实公式来源。

## 本机接入结果

2026-10-27—28，本机Linux实际采集五源共96篇：Shrivu 13、OpenAI Developer Blog 32（首次30，后续补齐2）、OpenAI工程RSS 21、Anthropic 14、claude.dev 16。当前74篇有私人可读正文，96篇有来源日期；缺失作者不补造。正文数量会随后续来源修订与提取变化。

本机直接请求开发者博客/claude.dev曾失败，使用明确配置的出站代理后可读取。OpenAI中文工程栏目仍返回403，因此该源使用官方RSS的Engineering分类，**英文标题、英文原文链接，不代表中文栏目全文已接通**。部分页面/图片会拒绝抓取，系统保留原文链接与失败状态。

所有真实来源 `site_fulltext=false`，当前获准公开全文数量为0；上面的正文/图片结论用于管理员私人阅读与技术验收。公式只验证了本地生成的MathML/公式源样本，不虚称真实来源公式覆盖。

站名已由用户确定为 **AGI黎明**。分类保留“待分类”，支持新增和改名；[候选分类](category-candidates.md)未写入实际词表。正式域名、最终分类/主题、公开全文许可与条款生效内容仍待站主确定；不影响本机功能验收，不进行公开部署。
