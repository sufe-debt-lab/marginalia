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

`defaultDbPath()` 通过 `os.homedir()` 解析用户目录。测试或临时运行可以用 `MARGINALIA_DB_PATH` 覆盖数据库路径。

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

## 环境变量

| Variable                       | Scope                  | Behavior                                                                |
| ------------------------------ | ---------------------- | ----------------------------------------------------------------------- |
| `MARGINALIA_DB_PATH`           | pi-server              | 覆盖 SQLite 文件路径                                                    |
| `MARGINALIA_NODE_PATH`         | desktop dev            | 指定开发模式启动 pi-server 的 Node binary                               |
| `MARGINALIA_CAPABILITY_TOKEN`  | Electron -> pi-server  | Electron 每次启动自动注入；父进程中的同名值会被移除并替换，不应手工设置 |
| `MARGINALIA_ALLOWED_ORIGIN`    | Electron -> pi-server  | 只注入已校验的 loopback Vite exact origin；缺失或无效配置不会继承旧值   |
| `VITE_DEV_SERVER_URL`          | desktop dev            | 让 Electron 加载指定的 loopback Vite URL；`pnpm dev` 自动设置           |
| `MARGINALIA_FAKE_AGENT`        | screenshot/local debug | 设为 `1` 时使用脚本化 fake agent，不连接真实模型；不要用于打包或生产    |
| `MARGINALIA_SCREENSHOT_VERIFY` | screenshot             | 启用隔离和确定性截图模式                                                |
| `MARGINALIA_USER_DATA_DIR`     | screenshot             | 覆盖 Electron `userData` 目录                                           |
| `MINIMAX_CN_API_KEY`           | live screenshot        | 真实 MiniMax opt-in 场景使用                                            |
| `MINIMAX_CN_BASE_URL`          | live screenshot        | 覆盖 live 场景 URL                                                      |
| `MINIMAX_CN_MODEL`             | live screenshot        | 覆盖 live 场景 model                                                    |
| `CSC_IDENTITY_AUTO_DISCOVERY`  | packaging/CI           | 设为 `false`，阻止当前未签名构建自动发现 macOS identity                 |

## 文档读取限制

`apps/pi-server/src/files/document-reader.ts` 的当前限制：

- 文本大小上限 10 MB，超出返回 `file_too_large`。
- Markdown、MDX、TXT 最多收集 50,000 行；LOG、CSV、TSV 为 10,000 行；其他文本默认为 1,000 行；绝对上限 100,000 行。
- 前 4 KB 用于二进制检测；不可作为文本预览的文件返回 `binary_not_previewable`。
- PDF、图片、音视频和 Office 扩展名标记为 `rawOnly`，不进入文本抽取。
- PDF 由 renderer 中的 pdf.js 视觉渲染；图片、音视频使用 raw URL；Office 当前显示不支持预览。

文本限制同时作用于文档面板和显式加入请求的上下文。Agent 默认 coding tools 走 pi 自己的文件实现，不受这组预览行数限制，也没有复用 HTTP 文件 sandbox。

## 本机 API

pi-server 监听 `127.0.0.1` 的随机端口。Electron 为每个 server 进程生成 capability token；run
请求要求 bearer，浏览器请求还要匹配 packaged `null`/缺省 Origin 或已校验的开发 origin。
CORS 不再反射任意来源，但 workspace、provider、文件、审批等既有 route 仍未认证，Origin
缺失的本地客户端也可以调用它们。Loopback 只限制网络接口，不负责完整授权。完整路由和已知
边界见[API 参考](../developer/api.md)。

## 相关文档

- [使用指南](./guide.md)
- [产品状态](../product/status.md)
- [系统架构](../developer/architecture.md)
- [打包与发布](../developer/build-and-release.md)
