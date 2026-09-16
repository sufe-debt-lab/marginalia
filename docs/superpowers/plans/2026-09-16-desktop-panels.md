---
type: plan
record_id: PLAN-DESKTOP-PANELS-021
status: active
created: 2026-09-16
updated: 2026-09-16
target_milestone: M0-trustworthy-local-alpha
owner: repository-maintainers
source_spec_id: SPEC-P1-CHAT-CORE-001
docs_impact:
  user:
    - docs/user/guide.md
    - docs/user/configuration.md
  developer:
    - docs/developer/architecture.md
    - docs/developer/development.md
    - docs/developer/api.md
    - docs/developer/build-and-release.md
  product_status: true
---

# Issue #21：桌面面板与内容生命周期

验收来源：[Issue #21](https://github.com/sufe-debt-lab/marginalia/issues/21)，父规格 [#2](https://github.com/sufe-debt-lab/marginalia/issues/2) 故事 1–7、74，以及布局、文档生命周期和测试章节。2026-09-16 已读取 Issue 全文、评论（无）、原生 parent（#2）和 blocked_by（空）。当前 main 的起点为 `0105cbf`，原目录未提交的原型只作参考。

## 范围与现有能力

复用 ResizeHandle、DocumentPanel、Zustand persist 和原生 Electron 窗口。现有文件树、多标签、预览、草稿保持原接口；本票不改变 HTTP/SSE、ChatEntry、SQLite 或本地文档正文所有权。

生产版本没有右侧摘要与可用的 Markdown 编辑器（编辑按钮禁用）；本票保留现有组件实例供后续编辑能力复用，不迁入原型模拟摘要/正文，也不实现后续编辑任务。摘要的 260px 下限待真实摘要切片接入，本票文档面板使用 360px 下限并适配可用空间。

## 进度

- [x] 独立 worktree；确认无前置阻塞。
- [x] 文件关闭重开测试先失败（当前文件丢失），最小保留挂载后通过。
- [x] 全屏入口测试先失败，完成应用内全屏、焦点限制与 Escape 还原。
- [x] 宽度下限测试先失败，调整文档宽度与持久化。
- [x] Electron 真实拖动、窄窗口、焦点与持久化验收。
- [x] 正式文档、完整 verify、视觉逐张裁决。
- [x] implement 技能要求的 Standards / Spec 双轴评审；修复色值、旧宽度归一化和减少动态效果关闭状态。

## 验证记录

focused tests 76 项通过（另有 useDocumentContent 3 项）；所有包 typecheck 与完整 `pnpm verify` 通过。视觉 38 changed、3 new、1 unchanged 已逐张裁决并更新预期基线，见[验证记录](../../developer/issues/2026-09-16-desktop-panels-verification.md)。

失败恢复验收发现现有刷新按钮未绑定动作：先添加失败测试，再复用 useDocumentContent 实现重新读取；不新增文件协议或正文存储。

Electron 已验证鼠标拖动 180/480px 边界、文档调宽、按钮/拖动全屏与 520px 还原、Tab 循环、Escape、文件保留、503 读取失败后刷新恢复、960px 窗口、重载偏好、宽度/透明度中间帧与减少动态效果。原生按钮位置由 BrowserWindow API 核对为 (14,16)，系统全屏保持 false；native AX 确认原生关闭、全屏、最小化控件存在。

## Implementation Outcome

候选实现与本票现有生产能力的验证完成。新增面板状态保留、应用内全屏与键盘、响应式宽度、统一控件样式，复用现有本地文件读取，并补齐既有刷新入口的失败恢复。未新增协议、数据库或模拟业务数据。

正式文档已同步用户指南、配置、API、架构、开发、构建发布、产品状态和逐图裁决。Standards / Spec 评审发现的色值、旧偏好宽度、减少动态效果及设置输入焦点问题已修复；窄窗口根据截图补上聊天控制栏换行。

本记录保留 active，等待 PR 评审和合入后归档。父规格仍包含其他活跃切片，不能随本票归档；当前 diff 的新增 plan 不满足仅限 spec/plan 同时关闭的 same_change 例外，因此不绕过归档门禁。实现提交为 `927b9da`。摘要、Markdown 编辑及其他平台验证边界见验证记录，不扩大本票实现范围。

最终复验：`pnpm verify` 完整通过；`pnpm verify:visual` 为 42 unchanged、0 changed、0 new、0 orphan、0 errors。窄窗口拖动从当前显示宽度开始，只有实际拖动结束才保存偏好，按下/松开不更改原宽度；对应测试先失败后通过。

## Review 后修复

- [x] 保留标签的同时刷新重新打开的文件列表，提供列表失败重试。
- [x] 全屏 Tab 循环包含文件树 Shadow DOM。
- [x] 统一右侧拖动与正常显示宽度，避免回弹与窄窗裁切。
- [x] 内部树以实际显示宽度开始拖动。
- [x] focused tests、typecheck、完整 verify、Electron 五项回归及逐图裁决。

本轮修复五项 review findings，新增/调整失败测试后实现。66 项 focused、全部包 typecheck、完整 verify（desktop 452）通过；Electron 验证文件列表增删/失败重试、Shadow DOM 正反 Tab、900px 拖动释放、189px 树拖动和最宽左栏下文档动作。视觉 5 changed、37 unchanged，逐张裁决并更新预期基线，同批截图重比为 42 unchanged。详细证据见验证记录的 Review 修复章节。

## PR 交接

用户已授权最终复查无问题后提交、推送并创建 PR。Standards 与 Spec 最终复查均无实质问题，Issue 保持开放，合入与归档作为剩余交接工作。

实现引用：`927b9da`（feat(desktop): preserve document state across panel layouts）。PR 前再次执行 `pnpm verify` 与 `pnpm docs:check -- --base origin/main`，全部通过。
