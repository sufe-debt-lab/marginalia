# Handoff：回合级文件变更摘要（未实现，独立立项）

日期：2026-07-11 · 状态：**零代码，未开工**。原为 P1-B 计划的 Task 13/14，范围收敛后从 message-stream 移出，独立立项。本文档是立项交接：目标、已定设计、依赖、坑位。

## 目标（来源：spec 第 2 节第 7 条）

run 结束若有文件变更，显示「修改了 N 个文件 +a -b」汇总条，点击展开逐文件 unified diff；**ask 批准、full 直通、新建文件**三种写入路径都要进摘要；重开会话时摘要可还原。

已声明的取舍（原计划头部第 3 条）：展示粒度做成**消息流末尾一条会话级聚合**，而非 spec 字面的"每回合一条"——重开会话无法可靠切分历史回合边界，聚合条是 live 与重开唯一能保持一致的形态。若将来要按回合，需要给 approvals 行补 run 边界渲染。

## 已定设计（完整任务级设计在 `docs/superpowers/plans/2026-07-10-message-stream.md` 的 Task 13/14，含执行前评审修订，直接照做）

**服务端（原 Task 13）**：

- 新 SSE envelope `file_changed`：`{ type, sessionId, toolCallId, toolName, payload }`，payload 复用 `ApprovalPayload` 的 file_edit 分支；并入 `AgentRunEvent` 联合。
- `ApprovalGateway.notifyFileChange(sessionId, …)`：仅向 `onEvent` 监听者广播，无 pending、不阻塞。
- `approval-extension` 在 `evaluate` 返回 "allow" 且工具为 edit/write 时，仍生成 diff 并 notify（bash 直通不通知——命令的文件副作用无法静态得知，此为已知边界，须写进 api.md）。
- `app.ts` 分流 `file_changed`：以 `status: "auto"` 持久化进 approvals 表（`createApproval` 增加可选 `status` 参数，insert 的 `'pending'` 字面量改绑参）后 emit 第四类 envelope。`GET /sessions/:id/approvals` 自然携带 auto 行，即重开还原的数据源。
- desktop `Approval["status"]` 联合加 `"auto"`；ToolCard 现有分支只匹配 pending/denied/expired，auto 天然不渲染审批 UI（加注释说明 auto 供摘要与展开 diff 用）。

**桌面端（原 Task 14）**：

- `useStreamingChat` 加 `onFileChanged?` 回调（解析 `event.payload.change`，缺失静默跳过，与 approval envelope 同模式）。
- `TurnSummary({ changes })`：汇总行（i18n `turnSummary.changed`，`{n}/{a}/{d}` 占位用 `.replace` 填充——`t()` 单参无插值）+ 展开逐文件 `DiffView`。
- ChatView：`Map<toolCallId, TurnChange>`，live 由 `onFileChanged` + `onApprovalResolved(approved 且 file_edit)` 双源 upsert；reopen 由 `listApprovals` 中 `kind==="file_edit"` 且 `status ∈ {approved, auto}` 的行初始化；`onUserAppend` **不**清空（会话级聚合语义）；去重键 toolCallId。MessageStream 在列表末尾（error 块之前）渲染。

## 依赖（全部已在 `feat/message-stream` 分支上，可直接用）

- P1-A 审批骨架：`ApprovalGateway`（onEvent 通用透传，`pi-coding-agent-client` 的合流**无需改动**——评审已核实）、approvals 表与仓储、SSE envelope 分流模式。
- `previewEdits` + `parseEdits`（`diff-preview.ts` / `approval-extension.ts`，commit `96bf76e` 引入）。
- `DiffView` 组件、`FakeAgentClient`（对 file_changed 事件按普通事件直接 yield，无暂停语义）。

## 坑位（执行前评审确认过的，务必遵守）

1. **edits-array 回归坑（最重要）**：直通路径生成 diff 必须走 `previewEdits(workspaceRoot, relPath, parseEdits(input))`，**绝不可用** `previewEdit(oldText, newText)` 四参旧版——pi 的 edit 工具用 `{edits:[...]}` 数组形态，旧版会产出空 diff 且 mock 测试发现不了（P1-A 真机才抓到的同一个 bug，commit `96bf76e`）。计划里已把该分支重构为共用 `buildFileEditPayload(mode, path, input, workspaceRoot)`。
2. 测试必须含 **edits 数组形态**用例（计划 Task 13 Step 1 的第二个用例已改为数组形态并断言 patch 非空，照抄）。
3. `approvals.status` 列无 CHECK 约束，加 "auto" 不需要 schema 迁移——不要画蛇添足。
4. 边框类用 `border-border-soft`，勿用 `border-soft`（无效类，commit `85a6d8b` 的教训）。

## 怎么做

- 独立分支/PR（基于含 P1-A 的主干或当前分支）；两个任务规模合计约 1–2 天量。
- 完成定义：三种写入路径进摘要（含 edits 数组形态的真实 diff）、重开还原、i18n en/zh、截图 fixture（原 Task 15 的 `turn-changes-summary` 镜头随本功能走，不留在 message-stream 的视觉收口里）。
- 收口时同步文档：api.md（file_changed envelope、auto 状态、bash 不产摘要的边界）、guide.md（变更摘要小节）。
