# 使用指南

本文面向使用 Marginalia 的用户。开发环境、测试和打包命令见[本地开发指南](../developer/development.md)。

## 基本流程

1. 选择一个 workspace 目录。Marginalia 只把目录路径和会话信息记录到本地数据库，不会复制或移动你的文件。
2. 在 Settings -> Providers 添加一个模型服务商。可以选择内置预设，也可以添加自定义 provider。
3. 回到 New chat 输入问题。选择 workspace 后，消息会创建为该 workspace 下的一条 session。
4. 用 `@文件` 或附件按钮把 workspace 内的文件加入上下文。文档面板可以浏览、搜索和预览 workspace 文件。

## Workspace 与会话

Workspace 是一个本地目录加上它下面的会话集合。删除 workspace 只会删除 Marginalia 本地数据库里的 workspace 记录、会话历史和 run 记录，不会删除磁盘上的原始文件。

当前 UI 的 New chat 会直接在所选 workspace 下创建普通 session。后端已有 `quick_chat` 来源和 `/quick-chat` API，但桌面端还没有单独的 Quick chat 入口。

## Provider 与模型

Settings -> Providers 里内置了 OpenAI、智谱 GLM、MiniMax、小米 MiMo 预设。预设会填好 base URL、默认模型和可选模型。

自定义 provider 需要同时满足两点：

- provider name 能映射到 pi 运行时支持的 provider id；
- 默认模型能被 pi 运行时识别。

如果 provider/model 不被支持，发起对话时会失败并提示 unknown model。添加 provider 后可以先用 Test 检查连通性。

## 文件上下文

文件一直保留在你的 workspace 目录里。只有当你主动把文件作为 `@文件` 或附件加入对话时，Marginalia 才会读取该文件，并把可预览文本内联到发给所选模型服务商的请求中。

PDF、图片、音视频和 Office 文件当前走 raw preview：桌面端可以用原始字节流预览其中一部分类型。把这些文件加入对话上下文时，当前实现不会自动抽取正文，只会给 agent 一个附件占位提示。

文本预览有大小和行数限制，详见[配置](./configuration.md#文档读取限制)。

## 权限

Composer 里可以选择工具权限：

- Full access：使用 pi 默认工具能力。
- Ask each time：保留需要确认的工具流程。
- Read-only：把工具限制到只读 allowlist，例如 read、grep、find、ls。

Marginalia 不提供内置终端或专业 Git UI。工具能力仍由 pi agent 运行时和当前权限共同决定。

## 本地数据

主要本地状态：

| 内容 | 位置 | 说明 |
| --- | --- | --- |
| SQLite 数据库 | `~/.marginalia/db.sqlite` | workspace、session、message、provider、run 等记录。 |
| Provider API key | SQLite `env_vars` 表 | 当前记录在本地数据库中，并在 pi-server 启动时注册到 pi 运行时。 |
| pi AuthStorage | `~/.marginalia/auth.json` | pi 运行时 auth storage 路径，避免与独立 pi CLI 的默认目录混用。 |
| UI 偏好 | Electron localStorage `marginalia-app` | 语言、侧栏状态、权限、推理档位、上次模型等。 |

如果你把文件加入对话上下文，该文件内容会随请求发送给你选择的模型服务商。Marginalia 不会自动上传整个 workspace。

## 故障排查

- 没有 workspace：先通过左侧栏或 New chat 的 workspace 选择器添加目录。
- 没有 provider：去 Settings -> Providers 添加并测试一个 provider。
- pi-server 异常：Settings -> General 会显示 pi-server 状态，可点击 Restart。
- 文件预览失败：检查文件是否在 workspace 内、是否超过大小限制、是否是当前只能 raw preview 的类型。

## 相关文档

- [配置](./configuration.md)
- [核心术语](./concepts.md)
- [API 参考](../developer/api.md)
