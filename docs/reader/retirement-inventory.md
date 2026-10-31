# 退役清单与顺序

调查基线：79d962e。只针对本项目新建开发/测试库，不承诺从运营中的AGIDawn数据库迁移。

先替换publication原文投影，再替换采集后的提取与恢复链，然后清理后台、出口、worker生产者和消费者，最后运行新迁移。不改历史SQL，不用CASCADE。

- `publication/publish.ts` 当前读取 analyses/fact_articles/facts/stories，并写 selected_state/selected_ledger；`items.ts` 联接stories/translations/quote_translations。
- `content/materials.ts`、`provenance.ts`、`jobs/content.ts` 当前仍引用分析、归组和译文状态。
- `admin/content.ts` 的 `editorial_overrides` 是持久下架和人工修正的真相，保留表与版本，不因模型退役丢掉人工决定。
- 保留来源采集、正文清洗、Markdown转换、付费提取回执/预算、认证与审计、运行记录。已核实告警与反馈直接使用飞书集成，不依赖精选投递账本；因此 deliveries、delivery_leases、notify_targets 一并退役。
- 删除模型编辑、events、reports成刊实现与专属测试/提示词，删除v1、RSS输出、MCP/agent、旧公开Markdown路由；RSS输入保留。
- 退役普通队列：content.analyze、events.group、events.digest、notify.selected。现有cron清理不能替代普通队列清理。
- 退役排程：content.translate、hot.rank、hot.snapshot、stories.links、reports.compose。source-health为运维来源健康报告，仍有意义。
- settings的models.*、model.circuit.*与旧告警键在有审计的升级操作中按明确范围处理，不在单语句发布迁移塞DELETE。

SQL依赖：report_revisions→reports；fact_articles→facts→stories；story_*→stories；selectbench_results→selectbench_runs。publications上的analysis_id/story_id/fact_id没有外键。articles.grouping_receipt_id指向保留receipts，删除该列即可删除其自身外键。

本轮新增 `0100_reader_drop_001_*` 至 `0100_reader_drop_048_*`，共删除26个退休表和22列，历史迁移未改、无CASCADE。包括模型价格表及旧译文、评分、归组、事件、报刊、精选和推送状态；核心收据/预算、审计、认证、反馈、来源与文章保留。详情以迁移文件为准，迁移检查及新库集成测试已执行。

`scripts/retire-reader-state.ts --database <明确的新库名>` 清理 models.*、model.circuit.*、退休服务的停止键和预算并写审计；本机实际移除6个模型预算，3个付费采集预算保留，历史费用回执不删除。旧普通队列与cron由排程注册清理。旧签名图片代理及其密钥、MCP依赖、模型凭据组、初始化选项、示例变量与过时文档均已移除。
