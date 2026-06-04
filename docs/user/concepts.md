# 核心术语

本文说明 Marginalia 的产品边界和常用术语，并标注当前实现状态。历史路线图归档在 `docs/internal/`，只作背景参考。

## 产品定位

Marginalia 是**本地优先的桌面端 AI 文档协作器**。它把本机 workspace、文档预览、会话历史和模型 provider 配置放进一个桌面应用，由本机 agent 协助文档精读与写作。目标用户先聚焦个人重度文档工作者。

### 非目标

- 不做 IDE、代码编辑器入口、Language Server。
- 不内置 bash、终端、PTY 或系统命令执行。
- 不做专业 Git UI（branch/merge/rebase/push/pull）。
- 不做 GUI / 浏览器自动化。
- MVP 不做多人协作、云账号、自动更新、Skills 市场。

## 术语

| 术语                    | 含义                                                            | 状态                                      |
| ----------------------- | --------------------------------------------------------------- | ----------------------------------------- |
| **Workspace / project** | 用户的资料目录 + 其下的会话集合。                               | ✅ 已实现（`workspaces` 表 + 文件接口）   |
| **Session**             | 一次 agent 对话，属于某个 workspace。                           | ✅ 已实现（`sessions` 表）                |
| **Quick chat**          | 临时对话，自动归属到最近打开的 workspace。                      | 部分实现（后端 `POST /quick-chat` 已有，桌面端暂无独立入口） |
| **Provider**            | LLM 服务商配置（key/baseUrl/模型）。                            | ✅ 已实现（见[配置](./configuration.md)） |
| **Run**                 | 一次 agent 执行，以 SSE 流式返回事件。                          | ✅ 已实现（`runs` 表 + `POST …/runs`）    |
| **Agent output**        | agent 创建的普通文件，额外用 SQLite 元数据标记来源。            | 🚧 路线图                                 |
| **Snapshot**            | 用户视角的版本快照，底层可用 Git commit 实现。                  | 🚧 路线图（`/branch` 接口尚未实现）       |
| **Remote control**      | 外部入口（手机/Web/IM）控制本机 agent，执行仍在本机 pi-server。 | 🚧 路线图（P1）                           |
| **MCP server**          | 接入外部资料源/数据库的 MCP 服务。                              | 🚧 路线图                                 |

> 状态以当前代码为准。「路线图」项在内部 spec 中有设计，但尚未在本仓库实现——文档不会把它们描述成已有能力。

## 路线图背景

历史 spec 曾把产品拆成可独立交付的小闭环：本机壳与 server → workspace/session/quick chat → provider 与流式 chat → 文档读取上下文 → agent 写文件/权限/diff → 一个 MCP server POC → 版本快照 → settings/debug/recovery → skills → 远程控制。

这些 spec 现在归档在 `docs/internal/specs/marginalia/`，仅作背景参考；当前能力以本文状态列和源码为准。

## 相关文档

- [系统架构](../developer/architecture.md)
- [API 参考](../developer/api.md)
