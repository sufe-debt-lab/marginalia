# 00. 产品边界与路线图

## 目标

固定 Marginalia 的产品边界、术语和渐进式开发顺序，避免后续 spec 重新争论方向。

## 产品定位

Marginalia 是本地优先的桌面端 AI 文档协作器。它通过 MCP 接入用户自有资料源和数据库，由本机 agent 协助完成文档精读和文档写作。

目标用户先是个人重度文档工作者。P1 保留通过手机、Web 或 IM 远程控制本机 agent 的能力，但不把 workspace 或 pi-server 搬到云端。

## 非目标

- 不做 IDE、代码编辑器入口、Language Server、Sandpack。
- 不内置 bash、终端、PTY 或系统命令执行。
- 不做专业 Git UI，比如 branch、merge、rebase、push、pull。
- 不做 GUI 自动化或浏览器自动化。
- MVP 不做多人协作、云账号、自动更新、Skills 市场。

## 核心术语

- Workspace/project：用户资料目录和会话集合。
- Session：一次 agent 对话，属于一个 workspace。
- Quick chat：临时对话，自动归属到最近使用的 workspace/project。
- Agent output：agent 创建的普通文件，额外用 SQLite 元数据标记来源。
- Snapshot：用户视角的版本快照，底层可以用 Git commit 实现。
- Remote control：外部入口控制本机 agent，实际执行仍在本机 pi-server。

## 开发顺序

1. 本机壳和 server。
2. Workspace、session、Quick chat。
3. Provider 和流式 chat。
4. 文档读取上下文。
5. Agent 写文件、权限和 diff。
6. 一个 MCP server POC。
7. 版本快照。
8. Settings、Debug、Recovery。
9. Skills。
10. 远程控制本机 agent。

## 验收

- 每个后续 spec 都能归入上面的顺序。
- 新功能如果无法归入，先补路线图或拆新 spec。
- 原始大 spec 只作为 backlog，不作为实现入口。

