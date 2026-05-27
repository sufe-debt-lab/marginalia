# 10. 远程控制本机 Agent

## 目标

交付 P1 远程控制闭环：外部入口能把消息发给本机 agent，并接收结果。文件、MCP、provider 和权限仍全部由本机 pi-server 控制。

## 依赖

- 01. 本机桌面壳与 pi-server。
- 02. Workspace、Session 与 Quick Chat。
- 03. Provider 与流式 Chat。
- 05. Agent 写文件、权限与 Diff。

## 范围

包含：
- remote-control API。
- token 鉴权。
- 会话来源 `origin`。
- Web 控制端或一个 IM channel adapter。
- 远程入口创建消息、订阅结果、接收 AskUserQuestion。
- 审计日志。

不包含：
- 云端 worker。
- 云端文件同步。
- 多人协作。
- workspace 文件直接暴露给远程前端。

## 安全边界

远程控制默认关闭。用户显式开启后才创建入口 token。

远程入口不能绕过：
- workspace 路径沙箱。
- 写文件权限。
- MCP 工具权限。
- provider 配置。

写文件仍走 allow once / always / deny。远程入口只能把 AskUserQuestion 发回外部渠道，不能自动代替用户确认。

## API

- `POST /remote-control/messages`
- `GET /remote-control/sessions/:id/events`
- `POST /remote-control/questions/:id/answer`
- `POST /remote-control/tokens`
- `DELETE /remote-control/tokens/:id`

所有 API 都需要 token。

## Channel Adapter

channel adapter 只负责：
- 接收外部消息。
- 映射到 workspace/session。
- 调用 remote-control API。
- 把 SSE 结果转为渠道消息。

首个 adapter 可以选 Web 控制端，成本最低。

## 数据

`sessions.origin` 使用：
- `web`
- `feishu`
- `qq`

审计日志至少记录：
- `origin`
- `session_id`
- `action`
- `created_at`
- `result`

## 验收

- 远程控制默认关闭。
- 开启后能生成 token。
- Web 或 IM 入口能发一条消息到本机会话。
- assistant 结果能回传给远程入口。
- 远程触发写文件时，仍需要用户确认。
- 禁用 token 后，远程入口无法继续调用。
- 审计日志能看到远程消息来源和结果。

