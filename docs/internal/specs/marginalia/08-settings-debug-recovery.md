# 08. Settings、Debug 与 Recovery

## 目标

把前面 spec 中分散的配置、状态和排障能力收口到可用界面。用户能管理关键配置，开发者能定位问题，用户能备份和恢复本地数据。

## 依赖

- 01. 本机桌面壳与 pi-server。
- 02. Workspace、Session 与 Quick Chat。
- 03. Provider 与流式 Chat。
- 04. 文档读取与上下文。
- 05. Agent 写文件、权限与 Diff。

## 范围

包含：
- Settings 基础页面。
- Provider 管理。
- File Access 权限策略。
- Debug View。
- SQLite 导出/导入。
- 日志导出。

不包含：
- 完整 MCP 管理平台。
- Skills 管理。
- 远程控制配置。
- 云同步。

## Settings

MVP 页面：
- General：默认 workspace、语言、启动行为。
- AI：默认 provider、默认模型、推理预算。
- Providers：key、base URL、测试连接。
- File Access：写工具开关、默认权限策略。
- Web Fetch：开关，默认关闭。
- Debug：pi-server 健康、最近错误、token 统计。
- Recovery：导出/导入 SQLite。

## Debug

Debug View 显示：
- pi-server health。
- 当前 session id。
- 当前 provider/model。
- 最近 run 错误。
- MCP POC 状态，如果已实现。
- 日志导出按钮。

## Recovery

导出内容：
- SQLite db。
- 不包含 workspace 文件内容。
- 默认不导出明文 API key。

导入策略：
- 导入前备份当前 db。
- schema version 不兼容时拒绝导入并显示原因。

## 验收

- 能在 Settings 修改默认 provider 和模型。
- 能查看 pi-server 健康状态和最近错误。
- 能导出 SQLite。
- 导入前会自动备份当前 SQLite。
- 导入不兼容数据库时不会破坏当前数据。
- 日志导出能生成一个可读文件。

