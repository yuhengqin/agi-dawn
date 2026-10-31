# 私人书库关键词搜索实施计划

> 执行：主代理使用 superpowers:executing-plans，子代理只做有界只读调查、验证与最终审查；用户已授权完整本机实施，无需重复确认执行方式。

**Goal:** 在私人书库按标题、摘要、当前已保存正文和私人笔记搜索，与五筛选组合并显示命中片段。

**Architecture:** reader模块按100条一批扫描已过滤候选，复用批量storedMaterial映射与当前快照哈希，派生纯文本并匹配全部关键词；没有历史数量上限。延用收录时间游标，搜索词进入binding；只有受保护书库响应返回有限片段。无关键词时保留直接分页查询。

**Tech Stack:** Node24.22.1、PostgreSQL17、TypeScript、React Router、Playwright，使用现有依赖。

**Spec:** [已授权范围与实现边界](../specs/2026-10-28-private-library-search-design.md)。基线57250d9，既有隔离分支codex/article-reader。

## Global Constraints

- 仅本机Linux、loopback；不推送或公开上线，不调用模型或外部采集。
- 最多200字符/6词，大小写不敏感、字面子串匹配，各词AND/字段OR；空白等同无搜索。
- 仅当前匹配快照和已保存笔记，不能让旧body_text/历史快照误命中；片段最多160字符、纯文本。
- 不写公开索引或私人内容日志，不修改用户笔记/正文、分类/主题、可见性或全文许可；无迁移/依赖/环境变量变更。

## Review Focus

当前快照缺失、同body_revision展示修正、元数据改变后的哈希匹配；人工清空摘要不回退旧摘要；中文/英文及字面通配符；跨批次和同时间分页无遗漏；空白及大小写规范化后的游标绑定与会话失效卸载。对应断言纳入下面两项。

## Task 1 — 私人搜索后端

Files: `modules/reader/state.ts`、新建 `modules/reader/search.ts`、`contracts.ts`、`server.ts`；`packages/backend/src/content/materials.ts` 提取批量 `storedMaterials(db,articleIds)` 并让既有单篇函数复用；`publication/pool.ts` 提取不转义的 `searchWords(q)`、保持 `searchTerms` 原输出；扩充 `modules/reader/tests/privacy.test.ts`。

Interfaces: `ReaderLibrary.items[].matches: Array<{field:'title'|'summary'|'body'|'note';snippet:string}>`；`readLibrary(input)` 增加q校验/绑定。无q返回空matches；五过滤和nextCursor契约保持。

- [x] 新增HTTP集成测试并运行RED：四字段/跨字段/符号、正文换版/当前快照、笔记保存更新、隐私；五条件＋q、超过100候选的分页、未知/超长/过多词和换q游标拒绝。
- [x] 实现批量material读取、分词复用、有限片段及分批匹配；只接受精确当前快照，摘要沿用人工投影语义。
- [x] 私人route对复用搜索容量耗尽返回503/Retry-After，沿用管理员守卫。
- [x] 运行定向后端测试：privacy、reader-query、snapshots、public-cache；Expected:全部通过。

## Task 2 — 搜索交互与本机交付

Files: `modules/reader/pages/library.tsx`；扩充 `apps/web/tests/reader-private.test.ts`；README、部署、实施记录和本批验收文档。

Interfaces: 消费Task1的matches与q；GET表单正式action `/admin/reader`，刷新/翻页保留q和五筛选，重新筛选丢弃cursor，清除移除q。

- [x] 浏览器RED：可见关键词输入、Enter提交、六条件刷新/翻页/重筛/清除；字段标签/片段以文字显示，失效卸载搜索片段。
- [x] 实现原生search输入、说明、忙碌状态与命中片段，保持手机布局和已有主题/笔记行为。
- [x] 运行typecheck、完整npm test（PG17工具链）、web构建与全部web测试；Expected:退出0、无失败。独立只读整体审查并修正必要问题。
- [x] 本地完整备份；停止worker时核对数据摘要、更新API/web，真实API集合/桌面1440和手机390/320只读搜索及耗时验证；恢复服务/timers、loopback核对并运行smoke。
- [x] 记录范围、数据完整性及限制，保存本地提交，不推送/公开上线。

## Outcome

最终typecheck及后端552/552、web构建与28/28浏览器测试通过。审查发现的内联断词漏检已补RED→GREEN回归并修正，正文元数据哈希边界也已验证。真实43组集合、75次分页、619个片段及三种宽度通过；当前96篇规模响应中位57ms、最慢289ms。已完整备份并核对内容、私人数据、归档及公开投影/索引摘要未变，服务与timer恢复，仅监听本机。详见[搜索验收](../../reader/phase4-search-acceptance.md)。
