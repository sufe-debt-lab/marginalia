# Marginalia 渐进式 Spec 索引（历史归档）

这组文档是早期拆分产品闭环时的执行资料，保留作背景和路线图素材。它不再是当前开发入口；当前实现与协作规则以源码、顶层 `docs/`、根 `README.md` 和 `CLAUDE.md` 为准。

这组文档把原始大 spec 拆成可独立交付的小闭环。开发时按编号推进，每个 spec 都应该能单独设计、实现、验收。

原始总览保留在 `docs/internal/specs/2026-05-24-marginalia-design.md`，只作为 vision backlog 和上下文来源，不作为直接执行计划。

## 推进顺序

| 顺序 | Spec | 目标 |
|---|---|---|
| 00 | `00-product-boundary-and-roadmap.md` | 固定产品边界、术语、阶段顺序 |
| 01 | `01-local-shell-and-server.md` | 桌面壳启动本机 pi-server，并能看到健康状态 |
| 02 | `02-workspace-session-quick-chat.md` | workspace、session、Quick chat 和消息持久化闭环 |
| 03 | `03-provider-and-streaming-chat.md` | provider 配置、模型选择、SSE 流式对话闭环 |
| 04 | `04-document-read-context.md` | 文件树、Reader、文档读取和 `@文件` 上下文闭环 |
| 05 | `05-agent-write-permission-diff.md` | agent 写文件、权限、diff、落盘闭环 |
| 06 | `06-mcp-one-server-poc.md` | 一个 MCP server 的发现和调用闭环 |
| 07 | `07-version-snapshot.md` | 弱化版版本快照、历史、diff、回退闭环 |
| 08 | `08-settings-debug-recovery.md` | Settings、Debug、Recovery 收口 |
| 09 | `09-skills.md` | Skills 扫描、启停、触发闭环 |
| 10 | `10-remote-control-local-agent.md` | 远程控制本机 agent 闭环 |

## 规则

- 每个 spec 只包含本闭环需要的功能，不提前实现后续 spec。
- 后续 spec 可以依赖前面 spec 的稳定接口，但不能要求回头重写前面的大块设计。
- 每个 spec 必须有可手动验证的验收清单。
- 发现 scope 变大时，优先拆新 spec，不往当前 spec 继续塞功能。
