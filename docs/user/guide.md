# 使用指南

Marginalia 当前处于 Alpha，适合在可恢复的资料副本上评估。工具权限还不是安全沙箱，Provider key 也没有加密；重要限制见[产品状态](../product/status.md)。开发、测试和打包命令见[本地开发指南](../developer/development.md)。

## 基本流程

1. 选择一个 workspace 目录。Marginalia 记录目录路径，不会复制或移动原始文件。
2. 在 Settings -> Providers 添加并启用一个 provider。
3. 回到 New chat，选择 workspace、provider 和 model 后输入问题。
4. 用 `@文件` 或附件按钮把资料加入请求；右侧文档面板可以浏览、搜索和预览文件。
5. 对助手回答可以复制、导出 `.md`，或保存到当前 workspace。

没有启用 provider 时不要发送消息。当前 New chat 仍可能先创建 session 并保留待发送 prompt，这个流程没有完整的错误引导。

## Workspace 与会话

Workspace 是一个本地目录及其会话集合。删除 workspace 会删除 Marginalia 数据库中的 workspace、session、消息和 run 记录，不会删除磁盘上的原始文件。

Workspace 目前不能视为 agent 沙箱。Full 和 Ask 下的 pi 工具可以使用绝对路径，bash 也在宿主机运行；HTTP 文件写入还存在 symlink parent 逃逸问题。不要把包含敏感资料的上级目录作为 workspace，也不要在没有备份的目录中测试写入工具。

当前 UI 的 New chat 会在所选 workspace 下创建普通 session。后端已有 `quick_chat` 来源和 `/quick-chat` API，桌面端没有单独的 Quick chat 入口。

## Provider 与模型

Settings -> Providers 提供 OpenAI、智谱 GLM、MiniMax、小米 MiMo 四个预设。当前 OpenAI 和 MiniMax 的 name/model 能被 pi registry 识别；GLM 会被错误映射为 `glm`，小米会被错误映射为 `xiaomi-mimo`，两者的 Test 当前会失败，不能用于真实对话。

自定义 Base URL 目前只会保存和显示，没有进入实际模型请求。Test 按钮只检查本地 provider/model 注册和是否已经配置凭据，不会验证 key 是否有效，也不会向服务商发送真实请求。需要确认真实连通性时只能发起对话，并留意它可能产生费用。

Provider API key 当前以明文保存在本机 SQLite。删除 provider 会同时删除它的 key 和关联 run 历史。完整配置边界见[配置](./configuration.md)。

## 文件上下文

文本文件可以通过 `@文件` 或附件加入对话。发送时，服务端读取文本并放进给模型的消息。超出大小或行数限制时会截断或报错。

文档面板的能力与上下文抽取不是同一件事：

| Type                           | In-app preview     | Context sent with prompt       |
| ------------------------------ | ------------------ | ------------------------------ |
| Markdown、纯文本、代码、CSV 等 | 文本或高亮预览     | 读取到的文本，受大小和行数限制 |
| PDF                            | 逐页视觉预览       | 不抽正文，只发送附件占位提示   |
| 图片、音频、视频               | raw 媒体预览       | 不抽内容，只发送附件占位提示   |
| Word、Excel、PowerPoint        | 当前不支持内置预览 | 不抽正文，只发送附件占位提示   |

Marginalia 不会在创建 workspace 时批量上传目录。运行对话后，agent 仍可能调用 read、grep、bash 等工具读取其他文件，并把工具结果发送给模型服务商；当前 Full/Ask 工具也不受可靠的 workspace 隔离。

## 工具权限

Composer 提供三个档位，默认值目前是 Full access：

| Mode          | Current behavior                                     | Important limitation                                            |
| ------------- | ---------------------------------------------------- | --------------------------------------------------------------- |
| Full access   | 使用 pi 默认 coding tools，不经过 Marginalia 审批    | 可读写绝对路径并运行宿主 shell                                  |
| Ask each time | 通过审批 extension 检查 bash、edit、write 和未知工具 | 名称与实际语义不完全一致：部分 shell 前缀和新文件写入会自动放行 |
| Read-only     | 新建 AgentSession 时只请求 read、grep、find、ls      | 缓存 session 可能保留旧工具配置，不能作为强安全保证             |

切换权限会改变产品意图，但当前实现不能提供操作系统级隔离。处理重要资料时，先准备备份，并把 agent 工具视为拥有当前用户权限的本地程序。

## 审批卡

Ask 档下，需要审批的工具调用会暂停并显示卡片：

- 命令卡展示 shell 命令和工作目录。勾选“本次会话总是允许此前缀”后，系统只保存命令首 token，不理解完整 shell 语义。
- 文件卡展示 unified diff、增删行数和预览是否精确。预览失败时会显示近似 diff 或错误说明。
- Allow 继续工具调用；Deny 可以附带理由，模型收到理由后继续当前 run。
- SSE 断开或 run 结束时，仍挂起的审批会被标记为 expired。

当前策略按字符串前缀识别一部分只读命令，没有完整解析命令替换、变量展开等 shell 语义；新建文件也默认不弹审批卡。审批链路便于协作和审计，不能当作防止恶意命令的安全边界。

## 复制、导出和保存

鼠标移到助手消息上可以使用消息操作：

- Copy：复制回答中的文本内容。
- Export：通过系统保存对话框导出 `.md`。
- Save to workspace：填写相对路径后写入当前 workspace；目标存在时会再次确认覆盖。

Save to workspace 是用户直接触发的写入，不经过 agent 审批卡。当前 HTTP 写入的 symlink 边界仍有已知问题，保存到含 symlink 的目录前应自行确认目标位置。

## 本地数据与网络边界

| Data             | Location                               | Current behavior                                        |
| ---------------- | -------------------------------------- | ------------------------------------------------------- |
| SQLite           | `~/.marginalia/db.sqlite`              | 保存 workspace、session、provider、run、approval 等记录 |
| Provider API key | SQLite `env_vars`                      | 明文保存，启动时注册到 pi 运行时                        |
| pi AuthStorage   | `~/.marginalia/auth.json`              | 与独立 pi CLI 目录分开                                  |
| UI preferences   | Electron localStorage `marginalia-app` | 保存语言、布局、权限、推理档位和模型选择                |

本机 pi-server 监听随机 loopback 端口。每个 Electron server 进程会生成独立 capability token，
所有 run 请求必须同时通过 bearer 和 Origin 检查；CORS 不再反射任意网页来源。但 workspace、
provider、文件、审批等既有 route 仍未认证，缺少 Origin 的本地请求也不受 CORS 约束。
`127.0.0.1` 和这项局部 run 防护都不是整套 API 的授权边界；在 `P0-SEC-001` 完整修复前，
不要把 Alpha 版本用于高敏感资料。

## 当前不可用

- Skills：运行时设置 `noSkills: true`，设置入口禁用。
- MCP：没有 server 配置、连接或工具注入，设置入口禁用。
- 独立 Quick chat 入口、版本快照、自动更新和数据导入导出仍未完成。
- Slash menu 会显示 clear/help/model，但选择后当前不会执行对应动作。
- Resume last session 开关会持久化，启动流程尚未读取它。

## 故障排查

- 没有 workspace：通过左侧栏或 New chat 的 workspace 选择器添加目录。
- 没有可用 provider：在 Settings -> Providers 添加并启用 provider；Test 只检查本地 registry 和是否配置凭据，不验证 key 是否有效。
- pi-server 异常：Settings -> General 可查看状态并手动 Restart。进程在 ready 后崩溃时，UI 可能仍暂时显示 ready。
- 文件预览失败：确认文件仍存在、类型受支持且没有超过读取限制。
- 对话停在审批：处理当前卡片；关闭流后挂起审批会过期。

## 相关文档

- [配置](./configuration.md)
- [核心术语](./concepts.md)
- [产品状态](../product/status.md)
- [API 参考](../developer/api.md)
