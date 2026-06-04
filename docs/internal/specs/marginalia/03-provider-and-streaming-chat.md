# 03. Provider 与流式 Chat

## 目标

交付最小可用 chat：用户能配置 provider 和模型，发送消息给 agent，看到流式 assistant 回复，并把消息持久化。

## 依赖

- 01. 本机桌面壳与 pi-server。
- 02. Workspace、Session 与 Quick Chat。

## 范围

包含：
- Provider 配置和测试连接。
- 会话级模型选择。
- pi `createAgentSession()` 的最小封装。
- `POST /sessions/:id/runs` 创建一次 agent run。
- SSE 推送 assistant 文本增量和完成事件。
- run 结束后保存 assistant 消息。

不包含：
- tool use。
- MCP。
- 文件上下文。
- 多 provider 全量配置页。

## Provider

MVP 只要求跑通 2 个：
- Anthropic。
- OpenAI。

Ollama 可以作为本地 provider 候选，但不是本 spec 的硬依赖。

API key 先存 SQLite `env_vars`，后续在 Settings spec 中收口到更完整的安全存储策略。

## 事件模型

SSE 事件至少包含：
- `run_started`
- `assistant_delta`
- `assistant_message`
- `run_completed`
- `run_failed`

每个事件包含：
- `run_id`
- `session_id`
- `type`
- `payload`
- `created_at`

## UI

Chat 主视图包含：
- 消息列表。
- Composer。
- 模型选择。
- 发送中状态。
- 出错后的重试入口。

## 验收

- 能配置 Anthropic 或 OpenAI key。
- 测试连接能返回成功或明确错误。
- 在一个 session 中发送消息后，assistant 回复以流式方式显示。
- 刷新或重启后，用户消息和 assistant 完整回复仍在。
- provider key 缺失时，发送按钮不可用或给出明确提示。

