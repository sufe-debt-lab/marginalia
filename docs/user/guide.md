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

HTTP 文件、附件和 Agent 文件工具共用 workspace 边界。只接受相对路径，支持 `/` 与 Windows
分隔符；拒绝绝对路径、父路径段、符号链接和外部目标。大小写遵循文件系统语义。
这不是操作系统沙箱：批准的 bash 命令和 Full access 下的命令仍以当前用户权限在宿主机执行。

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

Marginalia 不会在创建 workspace 时批量上传目录。运行时文件工具的结果会进入模型上下文；Standard Access 下的 bash 必须逐次批准，批准的命令可能访问 workspace 外文件和网络。

## 工具权限

Composer 提供三个档位，默认值目前是 Full access：

| Mode                        | Current behavior                                                  | Boundary                                   |
| --------------------------- | ----------------------------------------------------------------- | ------------------------------------------ |
| Full access                 | 允许工具操作，不弹 Agent 审批卡                                   | 文件工具仍限 workspace；shell 使用宿主权限 |
| Standard Access（标准访问） | workspace 读取和新建产物自动允许；覆盖、edit 和每次 bash 等待批准 | 不使用命令前缀白名单；批准仅用于本次操作   |
| Read-only                   | 只提供 read、grep、find、ls 和只读 Skill catalog 工具             | 不提供文件写入或 bash                      |

API 未指定权限时使用 Standard Access。已有桌面权限偏好不被自动改写。

## 审批卡

- 命令卡展示完整命令、工作目录和宿主访问范围；没有“总是允许此前缀”入口。
- 文件卡展示目标路径、编辑/替换模式和实际拟写入字节的 unified diff。edit 的替换结果由 pi
  计算，无法生成有效替换时直接报告工具错误，不展示可以批准的近似提案。
- Allow 只授权该提案；等待期间目标被替换或修改，写入会失败并保留新内容，Agent 必须重新读取并提出修改。
- Deny 可附带理由，不产生文件写入；中止或断连不会变成批准。审批和工具结果按 toolCallId 持久化，重开会话可查看。
- 提交决策期间控件锁定，请求失败后恢复。单次工具拒绝/冲突由 Agent 处理，不自动等同整轮失败。

## 复制、导出和保存

鼠标移到助手消息上可以使用消息操作：

- Copy：复制回答中的文本内容。
- Export：通过系统保存对话框导出 `.md`。
- Save to workspace：填写相对路径后写入当前 workspace；目标存在时会再次确认覆盖。

Save to workspace 是用户明确触发并确认的写入，不再额外显示 Agent 审批卡。它与 Agent 使用同一文件
操作边界；并发新建同一路径只有一个成功，另一请求返回冲突。文件通过临时写入和原子发布更新，写入
失败保留原文件。原生文件后端不可用时拒绝操作，不静默退回普通路径写入。

## 本地数据与网络边界

| Data             | Location                               | Current behavior                                        |
| ---------------- | -------------------------------------- | ------------------------------------------------------- |
| SQLite           | `~/.marginalia/db.sqlite`              | 保存 workspace、session、provider、run、approval 等记录 |
| Provider API key | SQLite `env_vars`                      | 明文保存，启动时注册到 pi 运行时                        |
| pi AuthStorage   | `~/.marginalia/auth.json`              | 与独立 pi CLI 目录分开                                  |
| UI preferences   | Electron localStorage `marginalia-app` | 保存语言、布局、权限、推理档位和模型选择                |

本机 pi-server 监听随机 loopback 端口。每个 Electron server 进程会生成独立 Loopback Access bearer；
除公开健康检查外，所有 workspace、Session、Provider、文件、Skills、审批和 Run 请求都必须同时通过
bearer 与 exact Origin 检查。renderer 只通过受限 preload transport 请求服务，不保存实际端口或 bearer。
缺失/错误 bearer 与缺失/恶意 Origin 分别返回稳定 401/403。该边界不会抵御已经能读取同用户进程内存的
本机恶意软件，Provider key 也仍为明文存储，因此 Alpha 仍不应用于高敏感资料。

## Skills 选择与管理

pi-server 已能刷新 Skills catalog、启停当前 snapshot 中的 candidate、读取 candidate 的截断预览，
并在受 Loopback Access 保护的 run API 中按 exact `{ name, canonical path }` 显式调用 Skill。每个 run 都会
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
非法 UTF-8 文件显示为 Invalid，不会被发送。隐式读取可使用最多 10 MiB 的有效 Skill 正文，不受显式 wrapper 门槛影响；超过读取上限则为 Invalid。Skill 正文中的 XML 1.0 非法 control character，以及
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

## 桌面面板

顶栏高 46px，保留原生窗口控件。左栏默认 275px，可拖动到 180–480px；Cmd+B（macOS）或 Ctrl+B 可开合侧栏。文档面板默认 388px，拖动下限 360px；显示宽度以窗口为上限；较宽的文档面板可覆盖背景区域，释放拖动后保持选定宽度。

文档面板顶部的全屏按钮将内容铺满应用窗口；也可以把外侧分隔线拖到窗口左缘。还原按钮或 Escape 恢复进入前宽度。此模式不切换系统桌面，背景暂不可操作，Tab 焦点留在面板内。关闭面板会返回顶部文件开关，重开保留当前文件、标签和预览状态。同一项目切换会话或设置保留面板；切换项目重置文件浏览，避免串用。

普通开合使用宽度与透明度过渡，拖动时直接跟手；系统减少动态效果设置取消非必要过渡。布局偏好保存在本机。文档编辑仍未启用，当前不承诺未保存 Markdown 编辑或跨重启恢复文件标签。

文件读取失败时保留当前标签和错误信息；点击文档工具栏“刷新”重新读取本地文件，成功后恢复预览。刷新会同时更新文件列表并加载磁盘上的最新已保存内容。没有打开文件时也可在筛选框旁刷新列表；列表失败会提示并允许重试。关闭再打开面板会重新读取列表，保留当前标签与预览。

Skill 中引用的资料可从该 Skill 目录内按需读取；仅限已启用的隐式 Skill 或本轮明确选择的 Skill。
引用资源不会自动获得写入、执行或访问其他目录的权限。Agent 文本改稿遇到非法 UTF-8 或含 NUL 的
目标文件时会明确失败，原文件保留，不展示有损文本审批预览。
