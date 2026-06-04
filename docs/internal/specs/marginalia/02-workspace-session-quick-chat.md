# 02. Workspace、Session 与 Quick Chat

## 目标

交付最小会话系统：用户能创建 workspace/project，创建和查看 session，Quick chat 自动归属到最近使用的 workspace/project，重启后数据不丢。

## 依赖

- 01. 本机桌面壳与 pi-server。

## 范围

包含：
- SQLite 初始化和 migrations。
- `workspaces`、`sessions`、`messages` 基础表。
- workspace 创建、列表、切换。
- session 创建、列表、打开。
- Quick chat 创建，归属最近使用的 workspace/project。
- 消息手动保存和读取。

不包含：
- LLM provider。
- SSE 流式回复。
- 文件树和文档读取。
- agent 工具调用。

## 数据模型

`workspaces`：
- `id`
- `name`
- `root_dir`
- `last_opened_at`
- `created_at`
- `updated_at`

`sessions`：
- `id`
- `workspace_id`
- `title`
- `origin`，默认 `desktop`，Quick chat 使用 `quick_chat`
- `created_at`
- `updated_at`

`messages`：
- `id`
- `session_id`
- `role`
- `content`
- `created_at`

## API

- `GET /workspaces`
- `POST /workspaces`
- `PATCH /workspaces/:id/open`
- `GET /workspaces/:id/sessions`
- `POST /sessions`
- `GET /sessions/:id/messages`
- `POST /sessions/:id/messages`
- `POST /quick-chat`

## UI

左栏包含：
- Quick chat。
- Workspace 列表。
- 当前 workspace 最近 sessions。

首启空状态提供：
- 创建 workspace。
- 选择已有目录作为 workspace。

## 验收

- 能创建 workspace 并在左栏看到。
- 能创建普通 session 并保存至少一条用户消息。
- 点击 Quick chat 会在最近使用的 workspace 下创建 `origin=quick_chat` 的 session。
- 重启应用后 workspace、session、messages 仍在。
- 没有 workspace 时点击 Quick chat，会先引导创建 workspace。

