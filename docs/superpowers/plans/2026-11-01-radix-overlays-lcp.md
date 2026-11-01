# ReasonDialog、Menu 与 LCP 基线实施计划

> 执行方式：主代理依次实施，使用 executing-plans、test-driven-development 和 verification-before-completion；完成后进行独立只读审查。

**目标：** 将 ReasonDialog 和 Menu 的交互底层迁移到 Radix，保持现有外观与业务行为，并测量桌面生产构建的 LCP 基线。

**设计依据：** 使用者在本次会话明确同意上述范围；图片优先级等测量后再决定。保留现有 CSS、组件调用接口、原因校验、异步失败保留输入、菜单操作与偏好持久化。Dialog 提供模态焦点管理，Menu 使用非模态 DropdownMenu。其余浮层与正文清洗保持原状。

**技术栈：** React 19、React Router SSR、Radix Dialog/DropdownMenu、现有 CSS；Node 24.22.1、Playwright Chromium/WebKit。

## 约束与验收

- 不提交、推送、部署，不修改真实数据库、来源许可、正文快照或图片加载属性。
- 独立工作副本构建、测试；只连接假 API 执行业务交互回归。真实 LCP 测量仅访问普通公开读取，拦截统计和其他写请求。
- 桌面 Chromium/WebKit 验证鼠标、键盘、缩放、浅深主题；不增加移动端专项。
- ReasonDialog 保留必填原因、trim、异步返回 false 不关闭、busy、取消/Esc/遮罩关闭、每次重开清空；补齐可访问名称、焦点圈定与回焦。
- Menu 保留触发器、外部点击、Esc、方向键/Home/End、操作即关闭、原链接属性及偏好行为；定位避让不超出桌面视口。
- 对比迁移前后截图和实际加载 JS；LCP 报告写明样本、生产构建、桌面尺寸、缓存、网络/CPU条件、重复次数、元素与局限。

## 实施步骤

- [x] 在所属 web 测试中补充真实页面的对话框契约与菜单回归，先运行确认新增对话框焦点断言在原实现失败。
- [x] 固定 Dialog/DropdownMenu 依赖版本；修改 `apps/web/app/features/admin/ui.tsx`、`apps/web/app/components/ui/Menu.tsx`，必要时补充动画 CSS。
- [x] 运行类型检查、web 构建、受影响 web 测试，查看桌面浅深主题及窗口缩放。任何新增问题定点定位和回归。
- [x] 使用公开页面生产预览测量首页与不同正文图片布局的 LCP；记录最终 LCP 元素、请求时序和 JS 体积，不设置 fetchpriority。
- [x] 更新专题验收与依赖升级说明，独立审查最终 diff，将验收通过的改动带回原工作区。

## 审查重点

- 无 Radix Trigger 的受控 Dialog，能否回到实际打开它的按钮。
- 退出动画阶段是否解除模态锁定，表单失败或重开是否保留正确草稿状态。
- 非模态菜单关闭是否吞掉外部按钮点击，触发器因业务操作卸载时是否出现焦点异常。
- Portal 是否保留颜色、层级和可见视口中的位置。
- LCP 是否来自真实生产 HTML、是否包含误写统计、是否把文字 LCP 错判为图片。
