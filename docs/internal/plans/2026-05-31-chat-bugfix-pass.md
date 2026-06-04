# Chat 功能修复计划（apps/desktop/src/chat 全面 review）

分支：`codex/ui-align-design`。现有 UI-align WIP 已落 `a4cbd41` 隔离。
交付：分多个小 PR（commit），每个 PR 先 TDD（红→绿）再提交，跑 touched 包的 typecheck+test。

## 架构决策（已与用户确认）

- **SSE 单一真相**：服务端只发 `agent_event` 原始流；客户端与重开会话共用同一套
  「pi 事件 → UiMessage」归约逻辑（按 `message_start/message_end` 切分气泡、支持 thinking）。
- **共享包**：新建 `packages/chat-core`，放 UiMessage/UiToolCall 类型、toolSubtitle/resultText/
  stringifyContent、以及「pi message/event → UiMessage」投影 + 实时累加器。desktop 与 pi-server 共用。
- **@mention vs +attachment**：两者都嵌入全文（发送语义一致），仅 UI 不同。
  - `@file` → 在 textarea 内保留内联文本 token `@path`（不产生附件卡）；发送时从正文提取 `@path` 并并入嵌入列表。
  - `+upload` → 附件卡（contextFiles store），嵌入全文。

## PR 拆分

### PR-1：Composer 交互（附件发送 + @/+ 拆分 + 禁用语义）

- 新增 `disabled?: boolean` prop；send 按钮 enabled 条件 = `!disabled && !sending && (draft.trim() || contextFiles.length>0)`。
- 只有附件、无文字时可发送（修 `submit() if(!text) return` 与 `disabled={!draft.trim()}`）。
- `@mention` 选中 → 插入内联 `@path ` 文本 token，不再 `onAddContextFile`。
- `+` picker → 仍 `onAddContextFile`（附件卡）。用 pickerMode 区分两种菜单来源。
- 新增 `extractMentions(text)` 工具；ChatView.submit / pendingPrompt 路径把 `@path` 并入 files。
- NewThreadView 用 `disabled={!canSend}` 取代 `sending={!canSend}` 的语义滥用。

### PR-2：retry / 乐观消息回滚 + 工具卡片 id

- 失败时回滚刚 append 的乐观 user+空 assistant 气泡（useStreamingChat catch / ChatView）。
- retry 不再重复 append。精简 lastSent（只在能正确回滚的前提下保留）。
- tool_updated/tool_completed 缺 toolCallId 时不要各自生成新 id（修重复卡片/卡 running）。

### PR-3：滚动 / key / 竞态

- MessageStream 自动滚动同时依赖最后一条内容长度或 streaming，流式时滚到底。
- AppShell `<ChatView key={sessionId}>`。
- useMessages 切 session 竞态（`current.length>0?current:loaded`）修正。

### PR-4：共享包 + SSE 单一真相 + thinking UI（最大）

- 新建 `packages/chat-core`，抽取共享纯函数 + 归约器（先 4a 抽函数、再 4b 服务端只发 agent_event、4c 客户端单一真相 reducer + 思考中 UI）。
- 服务端 app.ts 去掉 typed 事件重映射，只发 agent_event。
- 客户端按 message_start/end 切分气泡，统一工具状态单一数据源（删 looseToolCalls 死代码）。
- 处理 thinking_start/delta/end → 「思考中」UI；处理 message_end stopReason=error。

## 完整问题清单（review 结论）

见对话；核心：实时与重开两条路径各自拼消息导致结构不一致（问题 1/2/5/6/7 同源）。
