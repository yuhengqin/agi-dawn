# Article quality fixes implementation plan

**Goal:** 修复文章复核中已确认的显示、内容结构、清洗和翻译完整性问题，并定向恢复可核实的旧内容。

**Spec:** `/tmp/agidawn-review/VERIFIED-2026-11-13.md`，用户已要求实施。

**Architecture:** 确定的历史结构优先经现有展示清理兼容；新采集在既有adapter/组件管道纠正。公开读取权限与原文/译文版本契约不变。数据恢复与程序更新分开验证。

**Tech stack:** Node.js 24.22.1、TypeScript、React Router、CSS container queries、Cheerio、PostgreSQL 17。

## 全局约束

- 仅桌面目标；不新增依赖、来源、分类含义或公网发布。
- 原无摘要保持为空；合法代码、类型占位符、产品名、私人快照及阅读位置保留。
- 不把original改名冒充译文，不为修样式重跑全站或调用真实模型。
- 不提交或推送；常驻副本及工作树构建隔离。
- 数据操作核对目标、备份、修订与表示哈希，并记录可审阅差异。

## 需重点核对的输入

- 有/无目录、侧栏两端宽度、三档阅读宽度跨转换点，正文不得骤窄。
- 浮层与图片查看器打开时Escape只关闭当前层；滚动面板内部仍可操作。
- 纯文字figure、图例、嵌入降级和真实缺图不混淆；不能全局删除图内文字。
- 短英文标题、带少量汉字的英文长段、产品名/代码/URL例外分别验证。
- 已存译文、资源、私人锚点在展示清理和数据修订后各遵循原版本身份。

## Task 1 桌面阅读布局和控制

Files: `apps/web/app/app.css`、`apps/web/app/routes/item.tsx`、`apps/web/app/features/item/ReadingDisplay.tsx`、`apps/web/app/features/feed/ReaderNavigation.tsx`、`apps/web/app/features/item/ArticleBody.tsx`，对应`apps/web/tests/article-outline.test.ts`、`reader-public.test.ts`、`code-blocks.test.ts`。

- [x] 为专注Escape层次、页面滚动关闭设置、空摘要提示和代码软换行加入行为回归，先见失败。
- [x] 修段落节奏、视频主动宽度、meta信息分组。
- [x] 按正文偏好与实际容器宽度显示侧目录，空间不足沿用正文前入口；保持专注占位与目录折叠语义。
- [x] 提供代码换行开关，提示词/纯文本默认换行，复制保留原文。
- [x] 构建与受影响桌面web测试；布局用实际浏览器测量，不新增CSS类名断言。

## Task 2 清洗及旧结构兼容

Files: `packages/backend/src/content/presentation.ts`、`sanitize.ts`、`reading.ts`，现有presentation、reading和sanitize standalone测试。

- [x] 为图注分隔、CODE工具栏、Ghost控件/署名/卡片、无href锚点、重复降级与纯文字figure误判补失败用例。
- [x] 精确、幂等清理已确认结构；安全mailto保留，危险协议继续拒绝。
- [x] 扩展确定的开头摘录去重和省略处理，不按模糊相似度删正文，不补写摘要。
- [x] 样本比较与对应standalone测试通过。

## Task 3 新提取的源结构与标题

Files: 由实际原HTML复现确定`content/adapters`、`components.ts`、`pipeline.ts`、`sources/rss.ts`及所属测试。

- [x] 确认Uber图注/标题和OpenAI遗漏章节的具体阶段，为源结构建立失败回归。
- [x] 在丢失结构信息之前修正规范化；不在outline简单过滤整个图N标题。
- [x] 保留纯文本RSS标题中的合法`<T>`，继续清理真实标记与危险内容。
- [x] 真实公开样本或保存样本比较；未取得的原文明确保持待核实。

## Task 4 翻译完整性

Files: `modules/reader/translation/body.ts`、`modules/reader/tests/translation-body.standalone.test.ts`。

- [x] 加入短普通标题原样返回、英文长段仅添汉字、产品名/原中文/URL/代码例外的失败回归。
- [x] 校验可译文字确实发生翻译，仍保留未译原文并按既有次数重试。
- [x] 验证旧片段缓存也使用新校验，不改付费回执身份或隐式重译完成记录。

## Task 5 定向恢复与交付

Files: 必要的有界维护脚本、所属测试、`docs/reader/article-controls.md`、翻译说明、`docs/deploy.md`。

- [x] 核对本机服务、数据库和归档归属，只读核查当前问题记录及修订。
- [x] 对能从原文证实的遗漏章节、作者和未译片段生成定向修复差异；不运行全量模型工作。
- [x] 有状态更新时先备份和隔离演练，按已有更新契约复用有效译文及资源并保留私人资料。
- [x] typecheck、相关standalone/集成回归、web构建与桌面web测试；最后独立代码审查。
- [x] 同步当前约定与升级说明，记录实际修复和仍无法证实的范围。

## 进度

- 在隔离工作树完成实现与回归后，已把审阅过的变更同步回本机常驻副本；没有提交或推送分支。
- 14篇定向数据修复及Uber运行时配置已应用；同组备份、隔离恢复、CAS冲突、私人资料与许可撤回均已验证。本机服务已恢复。
- 实际结果与不能恢复的来源限制见`docs/reader/article-quality-2026-11-13.md`。
