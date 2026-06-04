# 配置

本文覆盖 LLM provider 配置、存储位置、环境变量和文档读取限制。面向使用流程的说明见[使用指南](./guide.md)。

## Provider 配置

Marginalia 自带一套 provider 快捷预设（`apps/desktop/src/settings/provider-catalog.ts`）。在设置页选择预设后填入 API key 即可；预设决定了 `baseUrl`、可选模型和默认模型。

### Provider 预设

| 预设               | provider.name | Base URL                                         | 默认模型        | 计费       |
| ------------------ | ------------- | ------------------------------------------------ | --------------- | ---------- |
| OpenAI             | `OpenAI`      | `https://api.openai.com/v1`                      | `gpt-5.1`       | 按量       |
| 智谱 GLM（中国区） | `GLM`         | `https://open.bigmodel.cn/api/anthropic`         | `glm-4.6`       | 编程套餐   |
| MiniMax（中国区）  | `MiniMax`     | `https://api.minimaxi.com/anthropic`             | `MiniMax-M2.7`  | Token 套餐 |
| 小米 MiMo          | `Xiaomi MiMo` | `https://token-plan-cn.xiaomimimo.com/anthropic` | `mimo-v2.5-pro` | Token 套餐 |

申请 API key 的链接随预设附带（见 `provider-catalog.ts` 的 `apiKeyUrl`）。

### name → pi provider id 映射

创建 provider 时填的 `name` 会经 `piProviderId()`（`apps/pi-server/src/agent/provider-id.ts`）规范化，映射到 pi 运行时的 provider id：

- 大小写无关、空格/下划线转连字符；
- `OpenAI` / `openai` / `open-ai` → `openai`；
- `MiniMax` / `minimax-cn` → `minimax-cn`，`minimax-global` → `minimax`；
- 其余按规范化结果原样使用（如 `GLM` → `glm`）。

选预设时 `name` 已选成能正确映射的值，因此通常无需关心。

### 自定义 provider

也可以不走预设，创建自定义 provider。自定义项必须能被 `piProviderId()` 映射到 pi 支持的 provider，且默认模型必须被 pi 运行时识别；否则发起对话时会失败。HTTP API 细节见 [API 参考 · Providers](../developer/api.md#providers)。

## 存储位置

| 内容 | 路径 | 说明 |
| --- | --- | --- |
| SQLite 数据库 | `~/.marginalia/db.sqlite` | workspace/session/message/provider/run 等（`apps/pi-server/src/db/connection.ts`）。 |
| Provider API key | SQLite `env_vars` 表 | 创建 provider 时写入本地数据库，并在 pi-server 启动时注册到 pi 运行时。 |
| AuthStorage | `~/.marginalia/auth.json` | pi 的 auth storage 路径（`apps/pi-server/src/app.ts:63`），与独立 pi CLI 默认目录隔离。 |
| UI 偏好 | Electron localStorage `marginalia-app` | 语言、侧栏状态、权限、推理档位、上次模型等（`apps/desktop/src/store/app-store.ts`）。 |

`defaultDbPath()` 使用 `os.homedir()` 解析用户目录，避免在 Windows 上因 `HOME` 缺失而回退到 cwd。需要隔离测试或临时数据时，用 `MARGINALIA_DB_PATH` 覆盖。

## 环境变量

| 变量                          | 作用域        | 说明                                                                                                                                          |
| ----------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `MARGINALIA_DB_PATH`          | pi-server     | 覆盖 SQLite 文件路径（`db/connection.ts:13`）。                                                                                               |
| `MARGINALIA_NODE_PATH`        | 桌面壳（dev） | 开发模式下指定用哪个 `node` 二进制启动 pi-server（`electron/pi-server-spawner.ts:84`）。                                                      |
| `VITE_DEV_SERVER_URL`         | 桌面壳（dev） | 设置后 Electron 从该 URL 加载 renderer（Vite dev server），否则加载打包的 `dist/index.html`（`electron/main.ts` 的 `devServerUrl()`）。`pnpm dev` 会自动设置。 |
| `MARGINALIA_SCREENSHOT_VERIFY` | 截图验证 | `verify:screenshots` 内部使用，显式启用截图验证隔离模式。 |
| `MARGINALIA_USER_DATA_DIR` | 截图验证 | `verify:screenshots` 内部使用，覆盖 Electron `userData` 目录。 |
| `MINIMAX_CN_API_KEY` / `MINIMAX_CN_BASE_URL` / `MINIMAX_CN_MODEL` | 截图验证（live） | `verify:screenshots:live` 的真实 MiniMax 场景使用；默认 gate 不需要。 |
| `CSC_IDENTITY_AUTO_DISCOVERY` | 打包/CI       | 设为 `false` 阻止 macOS 自动签名（当前未签名 spike 构建用）。                                                                                 |

## 文档读取限制

文档预览由 `apps/pi-server/src/files/document-reader.ts` 处理，限制如下：

- **大小上限**：10 MB（超出返回 `file_too_large`）。
- **行数 cap**（按扩展名）：`md`/`mdx`/`txt` 50,000 行，`log`/`csv`/`tsv` 10,000 行，其余默认 1,000 行；绝对上限 100,000 行。超出会 `truncated: true`。
- **二进制检测**：前 4KB 采样判定；不可预览的二进制返回 `binary_not_previewable`。
- **PDF / 图片**：通过 `/files/raw` 走原始字节流预览，文本预览接口对其标记 `rawOnly`。支持的 MIME 见 `document-reader.ts` 的 `mimeTypes`（pdf、png/jpg/jpeg/gif/webp/avif/svg/ico 等）。

这些限制适用于桌面端文档面板预览，以及用户把文件作为 `@文件` 上下文加入对话时的读取过程。`apps/pi-server/src/agent/document-tools.ts` 中也有同一读取器的工具合约，但当前生产 run 尚未把这些工具直接注入 agent。

## 相关文档

- 这些值在请求/响应中的呈现：[API 参考](../developer/api.md)
- 存储路径在打包后的差异：[打包与发布](../developer/build-and-release.md)
