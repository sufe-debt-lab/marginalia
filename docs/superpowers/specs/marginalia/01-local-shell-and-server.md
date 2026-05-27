# 01. 本机桌面壳与 pi-server

## 目标

交付一个能启动的 Electron 桌面壳，并由主进程拉起本机 pi-server 子进程。用户能看到 server 是否可用，开发者能定位启动失败。

## 范围

包含：
- pnpm workspace 基础结构。
- `apps/desktop` Electron + Vite + React。
- `apps/pi-server` Node 服务，先只提供 `health` 和基础日志。
- Electron 主进程 fork pi-server，并把 server URL 暴露给 renderer。
- 首启空状态占位页。

不包含：
- provider 配置。
- agent 对话。
- workspace 文件读写。
- MCP。

## 架构

桌面端只访问 `127.0.0.1:<random-port>`。pi-server 由 Electron 主进程启动和关闭，renderer 不直接 require server 代码。

pi-server 需要支持：
- 随机端口绑定。
- `/health` 返回服务状态、版本、启动时间。
- 结构化日志输出到 stdout。

Electron 主进程需要支持：
- spawn/fork pi-server。
- 捕获启动失败。
- app 退出时关闭子进程。
- preload 只暴露 server URL 和 server 状态。

## UI

Renderer 初始显示：
- pi-server 状态：starting / ready / failed。
- ready 后显示首启空状态入口。
- failed 时显示错误摘要和重试按钮。

## 验收

- `pnpm dev` 能启动桌面 app。
- 桌面 app 启动后自动启动 pi-server。
- renderer 能通过 preload 拿到 server URL。
- `/health` 可访问，且状态显示在 UI 上。
- 关闭桌面 app 后 pi-server 子进程退出。
- pi-server 启动失败时 UI 能显示错误并允许重试。

