# 配置

本文记录当前 Provider、存储、环境变量和文档读取限制。Alpha 阶段的安全与发布阻断见[产品状态](../product/status.md)。

## Provider 配置

Settings -> Providers 可以创建、编辑、启停、测试和删除 provider。编辑时 API key 留空只会保留旧值，当前 UI 没有单独清除 key 的操作；删除 provider 会同时清除 key 和关联 run 历史。直接调用 PATCH API 时，`apiKey: ""` 才表示清除数据库值和运行时 override。

### 内置预设

预设来自 `apps/desktop/src/settings/provider-catalog.ts`：

| Preset             | `provider.name` | Saved Base URL                                   | Default model   | Current registry result          |
| ------------------ | --------------- | ------------------------------------------------ | --------------- | -------------------------------- |
| OpenAI             | `OpenAI`        | `https://api.openai.com/v1`                      | `gpt-5.1`       | 映射为 `openai`                  |
| 智谱 GLM（中国区） | `GLM`           | `https://open.bigmodel.cn/api/anthropic`         | `glm-4.6`       | 错误映射为不存在的 `glm`         |
| MiniMax（中国区）  | `MiniMax`       | `https://api.minimaxi.com/anthropic`             | `MiniMax-M2.7`  | 映射为 `minimax-cn`              |
| 小米 MiMo          | `Xiaomi MiMo`   | `https://token-plan-cn.xiaomimimo.com/anthropic` | `mimo-v2.5-pro` | 错误映射为不存在的 `xiaomi-mimo` |

这些 URL 当前会保存和显示，但 pi-server 发起 run 时只把规范化 provider ID 和 model ID 传给 `getModel()`，没有把数据库中的 `baseUrl` 注入请求。当前 pi registry 使用 `zai` 和 `xiaomi`/`xiaomi-token-plan-cn` 等 ID，现有 GLM 与小米 name 映射没有对齐；GLM 默认的 `glm-4.6` 也不在当前 registry。不能把表中的 URL 或预设存在本身当作已验证可用。

### Name 到 pi provider ID

`piProviderId()` 会把 name 规范化：

- 大小写无关，空格和下划线转成连字符；
- `OpenAI`、`openai`、`open-ai` 映射到 `openai`；
- `MiniMax`、`minimax-cn` 映射到 `minimax-cn`，`minimax-global` 映射到 `minimax`；
- 其他名称按规范化结果使用，比如 `GLM` 变成 `glm`。

自定义 name 和 model 必须已经被 pi 模型注册表识别。自定义 Base URL 尚未接通，因此当前 UI 不能创建任意 OpenAI-compatible endpoint。

### Test 按钮

Provider Test 调用本地 `ModelRegistry.getAvailable()`，检查 provider/model 是否在 registry 中，并过滤没有配置凭据的项目。它不会发送网络请求，也不能验证 key 是否有效、DNS、TLS、余额、限流、Base URL 或真实推理响应。真实对话可能产生服务商费用。

## Secret 与存储

| Data             | Path or table                          | Notes                                                       |
| ---------------- | -------------------------------------- | ----------------------------------------------------------- |
| SQLite           | `~/.marginalia/db.sqlite`              | workspace、session、message、provider、run、approval 等     |
| Provider API key | SQLite `env_vars.value`                | 当前为明文，没有使用 OS keychain 或应用层加密               |
| pi AuthStorage   | `~/.marginalia/auth.json`              | pi 运行时独立目录；不要与 SQLite 中的 provider key 混为一处 |
| UI preferences   | Electron localStorage `marginalia-app` | 语言、布局、权限、推理档位、上次模型和 resume toggle        |
| Turn drafts      | renderer memory                        | 按 New chat workspace/session 隔离；不写入 localStorage     |

`defaultDbPath()` 通过 `os.homedir()` 解析用户目录。测试或临时运行可以用 `MARGINALIA_DB_PATH` 覆盖数据库路径。

正文、附件路径、Skills selection 和 New chat 的一次性 handoff 只保存在当前 renderer 进程内。切换视图或
workspace/session 时仍可恢复对应 owner 的草稿，但应用退出、renderer reload 或崩溃会丢失这些未接受内容。
只有明确的 `run_completed` 才结束已接受 run；pre-start 401/409/413/EOF 保留草稿且不显示 Retry，避免
复用更早一轮的 retry snapshot。started 后的失败保留该轮完整 snapshot，并在 terminal 后 drain 到 EOF、
服务端完成 run 清理后允许显式 Retry。Retry 使用 immutable snapshot，并只在替代请求收到 `run_started`
后删除旧 accepted attempt 的全部本地 entries；pre-start retry failure 保留旧 attempt。

数据库、备份和崩溃采集都可能包含明文 key。应用只有 run 和后续 Skills 敏感接口使用进程级
capability；其他既有本机 API 仍未认证，因此不适合保存高价值凭据。

## Skills 磁盘发现

Skills catalog 的磁盘发现层按固定的 first-wins 优先级枚举候选文件：

| Priority | Directory                        | Scope     | Mode        |
| -------- | -------------------------------- | --------- | ----------- |
| 1        | `<workspace>/.marginalia/skills` | workspace | Pi mode     |
| 2        | `<workspace>/.pi/skills`         | workspace | Pi mode     |
| 3        | ancestor `.agents/skills`        | workspace | Agents mode |
| 4        | `~/.marginalia/skills`           | user      | Pi mode     |
| 5        | `~/.pi/agent/skills`             | user      | Pi mode     |
| 6        | `~/.agents/skills`               | user      | Agents mode |

Pi mode 兼容 Pi 的目录语义：发现 root 下的 Markdown 文件，也递归发现目录中的 `SKILL.md`。Agents
mode 只保留 `SKILL.md`，不会把 `.agents/skills` root 下的其他 Markdown 文件当作 Skill。各 source
内部按 POSIX relative path 的 Unicode code-point 顺序稳定排列，文件系统返回目录项的顺序不会改变
结果。

Workspace 的 ancestor `.agents/skills` 从 workspace root 向上按由近到远枚举；发现 `.git` 目录或
worktree `.git` 文件时包含该 Git root 后停止，没有 Git marker 时继续到 filesystem root。
`.marginalia` 与 `.pi` 不向 workspace 祖先查找。若某个 ancestor root 经 realpath 解析后等于
`~/.agents/skills`，它会从 workspace 来源排除，只在 priority 6 出现一次。缺失的目录会被安静忽略。

### Skills catalog 状态与刷新

发现后的每个文件先通过 realpath 得到 canonical path；同一文件经多个 symlink 或 source alias 被发现
时只保留发现顺序中的第一个。启停 preference 以这个 exact canonical path 为 key，不跟随 symlink
路径保存，也不会在文件消失后自动删除。Symlink 改指向新文件后，旧 canonical path 不再是当前
catalog member，旧 preference 只作为 tombstone 保留。

Catalog 按 discovery 顺序处理 candidate。Invalid candidate 优先标为 `invalid`，有效但停用的 candidate
标为 `disabled`；两者都不占用 Skill name。第一个 enabled valid 同名 candidate 成为 `effective`，
后续同名 candidate 标为 `shadowed` 并记录 winner 的 canonical path。因此停用或删除 winner 后，下一个
enabled valid candidate 会在刷新时接替，不会把旧选择自动改绑到新 path。
Run preflight 遇到 shadowed selection 时，会把该 canonical path 作为 typed 409 的 `winnerPath` 返回；
其他 invalid reason 省略该字段。

Catalog 只在调用方显式请求 refresh 或修改 preference 时重新发现和解析；当前没有 filesystem watcher。
Composer 会在挂载、workspace 切换，以及每次新打开 `$` 或 `/` 菜单时请求刷新；run preflight 仍会在
每轮执行前刷新。磁盘编辑、创建、删除和 symlink retarget 会在下一次显式 refresh 时体现。重复刷新同一
磁盘与 preference 状态不会改变 revision：管理可见 candidate、diagnostic、preview 或 enabled/status
变化会更新 `catalogRevision`；只有 effective Skill 的 metadata、canonical path、顺序或正文 hash 变化
才更新 `effectiveRevision`。如果响应中的 workspace identity 与当前请求不一致，Composer 把本次刷新视为
失败并提供重试，不会重新开放最后成功 snapshot 中的旧候选行。

Run request body 最多 4 MiB；最多提交 16 个 raw Skill selections，且每个 name/path 分别最多 16 KiB
UTF-8。这些限制在 JSON decode/selection 去重的相应边界前执行。显式调用要求原始 `SKILL.md` 文件最多
512 KiB（边界包含）；XML wrapper 不计入这个单项门槛。全部 blocks 按实际 prompt prefix 序列化计量
（包含 block 间空行），合计最多 2 MiB。Catalog 保存和内容接口返回的 preview 最多 256 KiB；非法
UTF-8 文件标为 invalid，不会把 replacement characters 截断后的内容静默发送给 agent。正文含 XML 1.0
非法 control character，或 name/canonical path/base directory 含这类字符或 CR/LF 时，文件仍可在管理页
显示诊断和 preview，但不能显式选择；普通正文换行不受影响。

### Skills 管理 API 与当前可用性

pi-server 已提供三个管理接口：刷新并列出公开 snapshot、按 exact canonical path 更新启停 preference、
以及读取当前 snapshot member 的 preview。省略 `workspaceId` 时只扫描 priority 4–6 的三个 user/global
roots；提供 workspace 时，服务端通过自己的 workspace 记录取得 root，再按 priority 1–6 扫描。客户端
不能提交任意 root。

每个 GET 都强制 refresh。启停操作执行 refresh、current membership、preference upsert、再次 refresh，
返回 preference 更新后的 revision。内容接口只从刷新结果中精确匹配 canonical path，并返回 snapshot
保存的 preview、截断标记和总字节数；它不会把请求 path 交给文件读取。Unknown、cross-workspace 和
snapshot 外 path 都返回 not found。

三个接口都要求 Electron 每进程 capability bearer；浏览器 Origin 还必须是 packaged 的缺省/`null`，
或本次开发启动明确允许的 exact loopback origin。公开 snapshot 不包含完整 body、content hash、Pi
Skill object 或 runtime effective collection。Catalog/internal failure 只返回通用错误，不返回内部 path
或 bytes。

这套后端不创建、导入、安装、编辑或删除 Skill 文件。Run API 会在每个 session lease 内刷新 Catalog，
把 effective Skills 和 diagnostics 以 `effectiveRevision` 固定到 agent loader，并允许按 exact
`{ name, canonical path }` 显式选择。通过 raw request/field limits 后，显式列表按 path 保留第一次出现，
旧 path 或 name mismatch 不会自动改绑。Loader 使用 `noSkills: true` 关闭自身磁盘 discovery，
再通过 pinned override 注入 snapshot，并非禁用 runtime Skills。Composer 已通过 `listSkills()` 接入
eligible candidate，并在 `$` 与 `/` 两个入口写入同一 ordered turn selection；canonical path 去重由 draft
store 负责。Settings -> Skills 也使用同一 snapshot API：进入或重新进入页面、切换 workspace、手动刷新时
重新列出全部 candidate；内容按选中 canonical path 延迟读取，启停只接受服务端返回的新 snapshot，不做
乐观更新。新 refresh/toggle 会清除 retained error；任一 catalog 请求或 toggle 尚未完成时，旧错误的 Retry
保持禁用且不会发起额外 GET。无法从已加载 workspace 列表解析的 active ID 按 global-only 请求处理。
从 blocked-turn 入口打开 Settings → Skills 时，Skills tab 会获得焦点；Settings 导航向辅助技术暴露当前
选中 tab。Settings 的 vertical tabs 支持 Arrow Up/Down/Left/Right、Home 和 End，并跳过禁用的 MCP。
Composer 的 `$`/`/` 列表会让键盘高亮项保持可见，option 不进入 Tab 顺序；Retry 在 listbox 外并在刷新后
把焦点还给输入框。Loading/empty/error 在 listbox 外播报，IME composition 不触发选项；慢文件搜索只在
原 workspace 与 textarea 仍拥有焦点时发布。Cmd/Ctrl+Enter 在菜单打开时只选择当前项，不会同时提交消息。

Agent session cache 会在 effective Skills、canonical workspace root、provider、model 或 readonly/default
工具 profile 改变时淘汰并重建；Ask/Full policy 与 reasoning 按轮动态应用。因此同一 session 从 Full 切到
Read-only 不会继续复用可写工具集，重开持久化 session 时也以当前 canonical workspace root 覆盖旧 cwd。
Cache 的 20 项 LRU 只淘汰 idle session；prepared/active run 以 reservation 固定，全部繁忙时允许暂时超过
soft cap，settled 或未启动 preparation 释放后再收敛。

`409 skill_precondition_failed` 在 Composer 内保留 owner-scoped `{ text, contextFiles, skills }`，并按响应的
exact canonical paths 标记 invalid chips。修复 Refresh 只用于这类 Skill precondition failure，调用当前
owner workspace 的同一个 catalog controller；成功后仅在最新 candidate 仍为同 name/path 且 effective、
enabled、explicit-eligible 时清除红色状态，不替换或删除 selection。Remove 只删除指定 path，打开 Settings
再返回仍读取同一内存草稿。Refresh 绑定发起时的 owner、workspace 和 blocked version；新 send/error、
Remove、owner/workspace 切换或 unmount 后，旧响应只更新 catalog controller，不修改当前 blocked UI。
当前草稿已没有某个 invalid path 时，成功刷新会清除对应 stale entry。`session_busy`、401、413 和普通
pre-start EOF 不会错误触发 catalog refresh。

Discovery 保留 Pi 的 symlink 语义，不强制 canonical target 留在 source root 内。如果 Skills root 中
预先存在指向外部文件、且能被 Pi 识别为 Skill candidate 的 symlink，其 canonical target 和稳定读取的
preview 会成为 snapshot 数据。读取仍要求 capability 和 snapshot membership，单独提交任意 path 不会
读盘；但应把 Skills roots 视为可信配置目录，不要放置指向敏感文件的 symlink。

## 环境变量

| Variable                       | Scope                  | Behavior                                                                 |
| ------------------------------ | ---------------------- | ------------------------------------------------------------------------ |
| `MARGINALIA_DB_PATH`           | pi-server              | 覆盖 SQLite 文件路径                                                     |
| `MARGINALIA_NODE_PATH`         | desktop dev            | 指定开发模式启动 pi-server 的 Node binary                                |
| `MARGINALIA_CAPABILITY_TOKEN`  | Electron -> pi-server  | Electron 每次启动自动注入；server 读取后即从自己的环境删除，不应手工设置 |
| `MARGINALIA_ALLOWED_ORIGIN`    | Electron -> pi-server  | 只注入已校验的 loopback Vite exact origin；server 读取后即从环境删除     |
| `VITE_DEV_SERVER_URL`          | desktop dev            | 让 Electron 加载指定的 loopback Vite URL；`pnpm dev` 自动设置            |
| `MARGINALIA_FAKE_AGENT`        | screenshot/local debug | 设为 `1` 时使用脚本化 fake agent，不连接真实模型；不要用于打包或生产     |
| `MARGINALIA_SCREENSHOT_VERIFY` | screenshot             | 启用隔离和确定性截图模式                                                 |
| `MARGINALIA_USER_DATA_DIR`     | screenshot             | 覆盖 Electron `userData` 目录                                            |
| `MINIMAX_CN_API_KEY`           | live screenshot        | 真实 MiniMax opt-in 场景使用                                             |
| `MINIMAX_CN_BASE_URL`          | live screenshot        | 覆盖 live 场景 URL                                                       |
| `MINIMAX_CN_MODEL`             | live screenshot        | 覆盖 live 场景 model                                                     |
| `CSC_IDENTITY_AUTO_DISCOVERY`  | packaging/CI           | 设为 `false`，阻止当前未签名构建自动发现 macOS identity                  |

## 文档读取限制

`apps/pi-server/src/files/document-reader.ts` 的当前限制：

- 文本大小上限 10 MB，超出返回 `file_too_large`。
- Markdown、MDX、TXT 最多收集 50,000 行；LOG、CSV、TSV 为 10,000 行；其他文本默认为 1,000 行；绝对上限 100,000 行。
- 前 4 KB 用于二进制检测；不可作为文本预览的文件返回 `binary_not_previewable`。
- PDF、图片、音视频和 Office 扩展名标记为 `rawOnly`，不进入文本抽取。
- PDF 由 renderer 中的 pdf.js 视觉渲染；图片、音视频使用 raw URL；Office 当前显示不支持预览。

文本限制同时作用于文档面板和显式加入请求的上下文。Agent 默认 coding tools 走 pi 自己的文件实现，不受这组预览行数限制，也没有复用 HTTP 文件 sandbox。

## 本机 API

pi-server 监听 `127.0.0.1` 的随机端口。Electron 为每个 server 进程生成 capability token；run 和
Skills 管理请求要求 bearer，浏览器请求还要匹配 packaged `null`/缺省 Origin 或已校验的开发 origin。
pi-server 在初始化 agent 与工具前读取 token/origin，并从自己的 `process.env` 删除，避免后续 Bash
工具子进程继承；这不代表对进程启动环境或内存中的 secret 做了安全擦除。
CORS 不再反射任意来源，但 workspace、provider、文件、审批等既有 route 仍未认证，Origin
缺失的本地客户端也可以调用它们。Loopback 只限制网络接口，不负责完整授权。完整路由和已知
边界见[API 参考](../developer/api.md)。

## 相关文档

- [使用指南](./guide.md)
- [产品状态](../product/status.md)
- [系统架构](../developer/architecture.md)
- [打包与发布](../developer/build-and-release.md)

## 面板布局偏好

既有本地 UI 存储保存左右栏宽度和开合状态。新安装左栏默认 275px，文档面板默认 388px；升级保留已有偏好。应用内全屏是临时状态，还原不会将全屏宽度保存成偏好。窗口变窄只限制显示宽度，不覆盖已保存的宽度。文件标签与预览保留在当前 renderer 生命周期中，不保存另一份文档正文。
