# 使用指南

Marginalia 当前处于 Alpha，适合在可恢复的资料副本上评估。工具权限还不是安全沙箱，Provider key 也没有加密；重要限制见[产品状态](../product/status.md)。开发、测试和打包命令见[本地开发指南](../developer/development.md)。

## 基本流程

1. 选择一个 workspace 目录。Marginalia 记录目录路径，不会复制或移动原始文件。
2. 在 Settings -> Providers 添加并启用一个 provider。
3. 回到 New chat，选择 workspace、provider 和 model 后输入问题。
4. 用 `@文件` 或附件按钮把资料加入请求；右侧文档面板可以浏览、搜索和预览文件。
5. 对助手回答可以复制、导出 `.md`，或保存到当前 workspace。

没有启用 provider 时不要发送消息。Composer 草稿按 New chat 的 workspace 或现有 session 隔离；切换
workspace、session 或 Settings 不会串用或立即清空正文与附件。New chat 只有创建 session 成功后才转移
完整草稿；若创建期间离开 New chat，迟到结果不会移动草稿或抢回导航。Desktop 收到 `run_started` 才把
本轮视为已接受；若对应草稿仍等于刚提交的快照才清空，发送
等待期间的后续编辑会保留。此前的 401/409/413 或流提前结束会保留输入，接受后的失败则可用 Retry
重发同一轮正文、附件和 Skills selection，而不会覆盖当前新草稿。只有服务端明确发送
`run_completed` 才算成功；未接受的失败只显示错误，不会出现可能重发旧消息的 Retry。
服务端报告已接受 run 失败后，Composer 会等流完全结束再开放 Retry，避免服务端仍在清理当前 run 时立即
重试并得到 `session_busy`。Retry 开始时不会先删除旧失败轮；只有替代请求收到 `run_started` 后才一次性
替换该轮的全部本地气泡。Retry 若在接受前失败，旧 accepted attempt 仍留在消息流中。

## Workspace 与会话

Workspace 是一个本地目录及其会话集合。删除 workspace 会删除 Marginalia 数据库中的 workspace、session、消息和 run 记录，不会删除磁盘上的原始文件。

Workspace 目前不能视为 agent 沙箱。Full 和 Ask 下的 pi 工具可以使用绝对路径，bash 也在宿主机运行；
HTTP 文件写入会拒绝预先存在、指向 workspace 外或已经断裂的 symlink component，但检查与最终写入之间
仍非 race-free，Agent coding tools 也不复用该边界。不要把包含敏感资料的上级目录作为 workspace，也
不要在没有备份的目录中测试写入工具。

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

| Mode          | Current behavior                                               | Important limitation                                            |
| ------------- | -------------------------------------------------------------- | --------------------------------------------------------------- |
| Full access   | 使用 pi 默认 coding tools，不经过 Marginalia 审批              | 可读写绝对路径并运行宿主 shell                                  |
| Ask each time | 通过审批 extension 检查 bash、edit、write 和未知工具           | 名称与实际语义不完全一致：部分 shell 前缀和新文件写入会自动放行 |
| Read-only     | 只请求 read、grep、find、ls；从其他 profile 切换时重建 session | 不是操作系统沙箱，工具仍以宿主用户权限读取文件                  |

切换权限会改变产品意图，但当前实现不能提供操作系统级隔离。处理重要资料时，先准备备份，并把 agent 工具视为拥有当前用户权限的本地程序。

## 审批卡

Ask 档下，需要审批的工具调用会暂停并显示卡片：

- 命令卡展示 shell 命令和工作目录。勾选“本次会话总是允许此前缀”后，系统只保存命令首 token，不理解完整 shell 语义。
- 文件卡展示 unified diff、增删行数和预览是否精确。预览失败时会显示近似 diff 或错误说明。
- Allow 继续工具调用；Deny 可以附带理由，模型收到理由后继续当前 run。
- 提交 Allow 或确认 Deny 后，卡片会立即锁定全部决策控件；请求失败时恢复，成功时等待审批结果更新。
- SSE 断开或 run 结束时，仍挂起的审批会被标记为 expired。

当前策略按字符串前缀识别一部分只读命令，没有完整解析命令替换、变量展开等 shell 语义；新建文件也默认不弹审批卡。审批链路便于协作和审计，不能当作防止恶意命令的安全边界。

## 复制、导出和保存

鼠标移到助手消息上可以使用消息操作：

- Copy：复制回答中的文本内容。
- Export：通过系统保存对话框导出 `.md`。
- Save to workspace：填写相对路径后写入当前 workspace；目标存在时会再次确认覆盖。

Save to workspace 是用户直接触发的写入，不经过 agent 审批卡。HTTP 写入会拒绝预先存在的越界或断裂
symlink component，但仍存在检查到写入之间的竞态边界；保存到含 symlink 的目录前应自行确认目标位置。

## 本地数据与网络边界

| Data             | Location                               | Current behavior                                        |
| ---------------- | -------------------------------------- | ------------------------------------------------------- |
| SQLite           | `~/.marginalia/db.sqlite`              | 保存 workspace、session、provider、run、approval 等记录 |
| Provider API key | SQLite `env_vars`                      | 明文保存，启动时注册到 pi 运行时                        |
| pi AuthStorage   | `~/.marginalia/auth.json`              | 与独立 pi CLI 目录分开                                  |
| UI preferences   | Electron localStorage `marginalia-app` | 保存语言、布局、权限、推理档位和模型选择                |

本机 pi-server 监听随机 loopback 端口。每个 Electron server 进程会生成独立 capability token，
所有 run 和 Skills 管理请求必须同时通过 bearer 和 Origin 检查；CORS 不再反射任意网页来源。但
workspace、provider、文件、审批等既有 route 仍未认证，缺少 Origin 的本地请求也不受 CORS 约束。
`127.0.0.1` 和这项局部防护都不是整套 API 的授权边界；在 `P0-SEC-001` 完整修复前，不要把 Alpha
版本用于高敏感资料。

## Skills 选择与管理

pi-server 已能刷新 Skills catalog、启停当前 snapshot 中的 candidate、读取 candidate 的截断预览，
并在受 capability 保护的 run API 中按 exact `{ name, canonical path }` 显式调用 Skill。每个 run 都会
把当前 effective Skills 固定到 agent runtime；explicit-only Skill 不会出现在模型的隐式清单中，但可
通过显式 selection 调用。

Composer 现在提供两个等价的选择入口：输入 `$` 打开仅含 Skills 的菜单，输入 `/` 打开 Commands 与
Skills 两个视觉分区。分区标题不是键盘导航项，方向键会在两个分区的可选行之间连续移动。选择 Skill
后会删除当前触发 token，并在附件上方加入有序的 `$name` chip；不会把 Skill 编码成 `/skill:*` 文本。
输入空格、删除 `$`，或以其他方式让当前 trigger 失效时，picker 会立即关闭，不修改正文或添加 Skill。
同一 canonical path 由 turn draft store 去重，chip 可移除，并通过 tooltip 展示来源与 canonical path；
warning diagnostic 和 explicit-only 状态也会显示。磁盘上名为 `skills` 的 Skill 仍只是普通 `$skills`
候选，不会成为 `/skills` 管理命令。

Catalog 会在 Composer 挂载、workspace 切换，以及每次新打开 `$` 或 `/` 菜单时刷新。加载、请求失败或
响应 workspace 不匹配时，菜单不会允许从旧 snapshot 新增 Skill，而已有 snapshot 和已选 chips 会保留；
可在菜单中重试。当前只允许选择 `name` 非空、enabled、status 为 `effective` 且 `explicitEligible` 的
candidate。菜单打开时焦点保留在输入框，option 由方向键/Enter 操作而不进入 Tab 顺序；刷新失败的
Retry 位于列表语义之外，执行后会把焦点还给输入框，成功加载后可继续键盘选择。加载、空结果和失败会向
辅助技术播报；中文/日文输入法仍在组词时，Enter 不会误选菜单项。慢文件搜索返回前若切换 workspace、
按 Escape 或把焦点移到 Permission/Model，旧结果不会重开菜单或抢回焦点。

Settings -> Skills 现在提供只读磁盘管理页。页面根据当前 workspace 展示 workspace 与 user/global 的全部
candidate；当前 workspace 无法从已加载列表解析时只展示 user/global 来源。可以按名称、描述、发现路径或
canonical path 搜索，并查看 Effective、Enabled · Shadowed、Disabled、Invalid 四种状态、warning、
explicit-only、来源及 diagnostics。选择任意行（包括 Invalid）才会按需加载服务端保存的内容预览；截断
内容会明确提示。启停不会乐观更新，而是以服务端返回的新 snapshot 为准；刷新、预览或启停失败均可重试。
新刷新或启停开始时会清除上一条 catalog 错误；请求进行中不能触发旧错误上的 Retry，避免旧刷新覆盖新的启停结果。
Settings tabs 支持 Arrow Up/Down/Left/Right、Home 和 End，且跳过禁用的 MCP 入口。

发送前若所选 Skill 已删除、停用、失效、被遮蔽或 identity 不再匹配，服务端会在 `run_started` 前拒绝
本轮。Desktop 不追加用户或错误气泡，也不清正文、附件和 chips；Composer 内联修复栏只把响应中 exact
canonical path 匹配的 chips 标红。可以刷新当前 workspace catalog、只移除指定 path，或打开
Settings -> Skills；切回对话时 scoped draft 会完整恢复。刷新成功只按最新 snapshot 清除已经恢复的红色
状态，不自动删除、替换或改绑 chip；若刷新期间又发送并得到新的 blocked response，旧刷新不会改写新
状态。chip 的移除按钮与修复栏动作至少提供 40×40 px 目标，且不使用会与相邻控件重叠的负 margin。
最终发送仍由服务端重新 preflight。

`session_busy`、401、413 和普通 pre-start EOF 也只在 Composer 内联显示，并保留完整草稿，但不会触发
catalog refresh 或显示普通 Retry。普通 Retry 只属于已经收到 `run_started` 的失败轮，并始终重发当时冻结
的完整正文、附件和 Skills selection。

Run body 最多 4 MiB；最多 16 个 raw selections，每个 name/path 最多 16 KiB UTF-8。可显式调用的原始
`SKILL.md` 文件最多 512 KiB，含 block 间空行的实际序列化总量最多 2 MiB，内容预览最多 256 KiB；
非法 UTF-8 文件显示为 Invalid，不会被发送。Skill 正文中的 XML 1.0 非法 control character，以及
name/path 中的 CR/LF 也会阻止显式发送并保留诊断；普通正文换行仍可使用。选择失效和 payload 超限分别返回稳定的
409/413；其他 run preparation 内部失败只返回通用 500，不包含内部 path、byte count 或异常消息。
Shadowed selection 的 409 会额外返回当前 winner 的 canonical `winnerPath`；其他失败原因不包含该字段。

管理后端只发现磁盘上已经存在的 Skill。它不提供创建、导入、安装、编辑或删除文件的能力。省略
workspace 时只查看三个 user/global roots；指定 workspace 时还加入该 workspace 的三个来源，详细目录
和优先级见[配置](./configuration.md#skills-磁盘发现)。

内容预览只能命中刚刷新 snapshot 中的 exact canonical path，返回的是该 snapshot 已保存的 preview，
不会按客户端提交的 path 重新读文件。未知、其他 workspace 或任意宿主 path 返回 not found。发现阶段
仍沿用 Pi 的 symlink 语义：如果磁盘上已经存在可发现、指向 source root 外文件的 Skill symlink，它的
canonical target 可以成为 snapshot member；因此不要在 Skills roots 中放置指向敏感文件的 symlink。
单独向 API 提交任意 path 不会创建这种 membership。

## 当前不可用

- Skills v1 不提供创建、导入、安装、编辑、卸载或删除文件的生态能力。
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

## 停止、退出和重启

Run 由桌面应用管理。停止会中止当前请求，断连或退出会结束执行；挂起审批过期，不会自动批准。执行清理完成前立即发送仍可能遇到“会话正在运行”，稍后可重新发送。

服务退出后，界面会显示本地服务已停止，可使用“重试”重启服务。启动时，失去进程所有者的旧运行归为失败；不会显示新的 Interrupted 类型，也不会恢复旧进程或重放未完成的工具调用。正常完成和已有失败记录保持不变。

重启只保留已经落盘的 pi 对话历史与 workspace 文件；未保存的流式文字和内存草稿不保证恢复。重新进入原会话发送“继续”或其他消息会创建新的 Run，使用已有 Session 上下文，并重新按当前文件、模型、Skills 与权限准备执行。应先检查磁盘上的实际成果，再提出后续要求。

跨页面运行连续性和持久化消息队列仍是后续任务；本次恢复能力不表示它们已完成。

本地服务突然终止时，正在执行的 Bash 命令也会被清理，避免旧命令在重启后继续覆盖文件。已经完成的写入不会回滚；继续工作前仍应检查当前文件。该生命周期处理不是系统级安全沙箱。
