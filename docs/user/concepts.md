# 核心术语

Marginalia 是本地优先的桌面端 AI 文档协作器，主要处理文章解读和基于资料的写作。代码和 shell 是可选的 agent 工具，不是产品的 IDE 入口。当前实现状态以[产品状态](../product/status.md)为准，历史 spec 只作背景参考。

## 产品边界

- 不做 IDE、Language Server、完整终端或 PTY。
- 不做专业 Git UI。
- 不做 GUI 或浏览器自动化。
- 不做多人协作、云账号或自动更新。
- Skills v1 已接通本地发现、显式选择、运行时注入、blocked-turn 修复和只读管理；安装/编辑生态与 MCP 仍未实现。
- Agent tools 使用当前系统用户权限；现有 Workspace 和审批不是安全沙箱。

“本地优先”表示资料目录、数据库和会话默认保存在本机。它不表示所有内容都留在本机：提示、显式附件和 agent 工具结果会发送给所选模型服务商。

## 术语

| Term                | Meaning                                        | Current state                                             |
| ------------------- | ---------------------------------------------- | --------------------------------------------------------- |
| Workspace / project | 本地资料目录及其 session 集合                  | partial；CRUD 和文件接口可用，隔离边界仍有 P0             |
| Session             | 属于某个 workspace 的 agent 对话               | implemented；并发 run 与恢复仍不完整                      |
| Quick chat          | 自动归属最近打开 workspace 的临时 session      | partial；后端 API 已有，桌面端无独立入口                  |
| Provider            | 模型服务商、key 和默认模型配置                 | partial；GLM/小米预设映射不可用，Base URL/Test 语义不完整 |
| Run                 | 一次 agent 执行及其 SSE 事件和数据库状态       | partial；同进程同 session single-flight 可用，恢复未完成  |
| Approval            | 标准访问下 Protected Action 的暂停、决定和记录 | 结构化 effect 判定；批准的 shell 仍是宿主操作             |
| Context file        | 用户显式附到 prompt 的 workspace 文件          | 文本可内联；PDF、Office 等不抽正文                        |
| Saved answer        | 用户把助手回答导出或保存为 `.md`               | implemented；不等于自动 Agent output 元数据               |
| Agent output        | Agent 自动创建并额外标记来源的文件             | planned                                                   |
| Snapshot            | 用户视角的版本快照，可由 Git 等机制实现        | planned；`/branch` 服务端路由未实现                       |
| Skill               | 按任务加载的专业指令和资源                     | partial；选择、注入、修复和只读管理可用，无安装/编辑生态  |
| MCP server          | 向 agent 提供外部数据和工具的 MCP 服务         | disabled；无配置、连接或注入链路                          |
| Remote control      | 从手机、Web 或 IM 控制本机 agent               | planned；没有已确认里程碑                                 |

Skill candidate 有四种 catalog 状态：`effective` 是当前按发现顺序生效的同名首个候选；`shadowed`
是被更高优先级同名候选遮蔽的候选；`disabled` 是按 canonical path 显式停用的有效候选；`invalid` 是
无法解析为 Pi Skill 的候选。Invalid 和 disabled candidate 都不占用名称，因此后续 enabled valid
candidate 可以接替成为 winner。

`disable-model-invocation` 会映射为 `explicit-only`：candidate 仍可成为 effective，但不会进入模型可
自动发现的 Skill metadata，只允许用户显式选择。普通 effective Skill 的名称、描述和位置作为 Pi 的隐式
可发现 metadata；用户显式选择后，服务端把 snapshot 中保存的完整正文放进本轮开头的 `<skill>` block。
`noSkills: true` 只关闭 Pi 自身再次扫描磁盘，Marginalia 会把 revision-pinned snapshot 注入 loader，并不
禁用 runtime Skills。

Pi session/history 保存的是实际发给 agent 的完整 Skill blocks 和附件 envelope。实时 user bubble 与重开
会话只使用展示副本，把已验证的 leading blocks 归一化为有序 `$name` markers，再显示用户正文；不会修改
落盘历史，也不会根据当前 catalog 重新解释或改绑旧 identity。因此 Skill 后来被删除，历史仍能显示当时
保存的名称，而 agent history 仍保留当时的完整 prompt。

## 历史资料

`docs/internal/` 保存早期路线图、spec、plan 和设计资产。Internal 中的阶段名和完成描述不代表当前状态；需要继续执行的工作应出现在产品状态、developer issue 或活跃 Superpowers 文档中。

## 相关文档

- [使用指南](./guide.md)
- [配置](./configuration.md)
- [产品状态](../product/status.md)
- [系统架构](../developer/architecture.md)
