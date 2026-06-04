# 06. 单个 MCP Server POC

## 目标

先跑通一个 MCP server 的完整调用链，验证 pi-extension adapter 是否可行。这个 spec 只做一个 server，不做完整 MCP 管理平台。

## 依赖

- 01. 本机桌面壳与 pi-server。
- 02. Workspace、Session 与 Quick Chat。
- 03. Provider 与流式 Chat。

## 范围

包含：
- 配置一个 stdio MCP server。
- 启动和关闭 MCP 子进程。
- `ListTools` 工具发现。
- MCP tool schema 转 pi ToolDefinition。
- agent 调用 MCP 工具。
- 工具错误展示。

不包含：
- 多 MCP server 并发管理。
- MCP 市场。
- per-tool 权限 UI。
- SSE/HTTP transport。

## 推荐 POC

优先选 SQLite MCP：
- 可控。
- 容易准备测试数据。
- 能验证文档精读里的“查询补充数据”场景。

如果 SQLite MCP 不稳定，退回到一个最小自建 MCP test server，只暴露一个 `echo` 或 `query_sample` 工具。

## Adapter 规则

- 工具名转换为 `<mcp_name>__<tool_name>`。
- schema 转换失败时，该工具不注册，并在 Debug 中显示原因。
- MCP 子进程异常退出时，agent 侧工具调用返回明确错误。
- POC 期间只在 session 创建时注册工具，不做运行时热更新。

## UI

Settings 中只需要一个 POC 面板：
- command。
- args。
- env。
- test connection。
- tool list。

Chat tool card 需要显示：
- MCP 工具名。
- 输入摘要。
- 输出摘要。
- 原始 JSON 展开区。

## 验收

- 能保存一个 MCP server 配置。
- 能测试连接并看到工具列表。
- agent 能调用其中一个工具。
- 工具结果能进入 assistant 回复。
- MCP server 启动失败时 UI 显示明确错误。
- POC 结论能回答：pi-extension adapter 是否可继续投入完整实现。

