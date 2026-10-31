# AGI黎明本机日常使用实施计划

> 使用 superpowers:executing-plans，由主代理实现，按用户规则委派有界只读调查、验证和最终审查。用户已经授权执行第二阶段，不重复询问执行方式。

**Goal:** 本机稳定采集、真实诊断、顺畅私人阅读并开始一周观察。

**Architecture:** systemd用户服务托管既有进程；原有采集/任务/备份保持单一实现。reader模块承载私人阅读改进，公共publication不加入私人数据。

**Tech Stack:** Node24.22.1、PostgreSQL17、systemd249、既有React Router与Playwright。

**Spec:** [设计](../specs/2026-10-28-local-daily-use-design.md)。基线1cc0939。

执行状态：2026-10-28实现与即时验证通过，详见[验收](../../reader/phase2-acceptance.md)。

- [ ] 完成七天实际观察并复核日报及阅读反馈；2026-11-04 05:50:40前不能据短时测试标完成。

## Global Constraints

- 本机loopback；不公开部署、不推送、不改正式分类、不开放真实来源全文。
- 私有.env不提交；模板采集/推送关闭，自动测试只用假源。
- 保留旧正文、人工下架、当前权限、版本一致性与笔记CAS。
- 不重复实现调度或进程监督；一周观察如实记录，不伪造经过时间。

## Review Focus

同名unit属于其他worktree；异常停止与主动停止的区别；无Jina时根因与旧正文；元数据/正文换版不能读错历史；草稿取消导航及会话失效；试用不足一周的报告。

### Task 1: 本机托管与启动命令

Files: scripts/local-reader.ts、tests/local-reader.standalone.test.ts、docs/deploy.md。

- [x] 先测试本机地址校验、其他worktree unit不能覆盖；运行观察失败。
- [x] install生成API/web/worker target及本地备份/观察timer；start/stop/restart/status/logs使用systemctl用户管理器。Node与PATH来自实际本机工具链，非硬编码用户路径。
- [x] 本机systemd-analyze verify及受管worker异常退出/主动停止验证；记录命令。

### Task 2: 直接提取失败诊断

Files: content/extract.ts、既有error-page-extraction与processing-recovery测试。

- [x] 假源403、200无正文及连接失败，无Jina时断言保留直接原因和无付费请求；运行失败。
- [x] 可选Jina未配置时不调用；直接失败通过现有processing_error呈现，可靠正文仍保留、缺正文变unconfirmed，重试有界。
- [x] 限定后端测试及真实工程样本重新检查，不扩大外网范围。

### Task 3: 同页阅读和草稿保护

Files: modules/reader/server.ts、archive/snapshots.ts、pages/{article,snapshot,library}.tsx、components/{OwnerTools,SnapshotReading}.tsx、apps/web/app/routes/admin/layout.tsx、既有privacy和reader-private测试。

- [x] 浏览器先复现同页无正文、导航丢稿及筛选URL不一致。
- [x] 管理员article接口提供当前匹配snapshot；页面复用ArticleBody和OwnerTools，同页正文、笔记、导出；公开入口维持权限。
- [x] 未保存提示、路由/关闭离开保护；筛选初始化与URL同步；仅有缺失图片时显示图片重试。
- [x] 前端构建和浏览器回归（匿名无私人正文、会话失效、冲突、导航取消、筛选刷新）。

### Task 4: 本地观察、备份与集成验收

Files: scripts/reader-status.ts、tests/reader-status.test.ts、docs/reader/phase2-acceptance.md。

- [x] 测试区分来源抓取成功与正文失败、只统计当前资源状态、试用经过时间和不含私人数据。
- [x] 只读聚合报告，--write保存起点/日报告/latest；systemd timer每日观察和--local-only备份。
- [x] 安装并启动本机服务，只为已确认五源开启自动采集；真实增量、报告、备份验证。
- [x] 完整typecheck、npm test、web build/tests、运行smoke；一次独立只读整体审查并处理实质问题。
- [x] 记录实际观察起点和时长，提交本地变更，保留分支与服务，不公开上线。
