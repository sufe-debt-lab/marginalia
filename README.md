# Marginalia

> 本地优先的桌面端 AI 文档协作器。

![version](https://img.shields.io/badge/version-0.1.0-emerald) ![local-first](https://img.shields.io/badge/本地优先-✓-blue) ![status](https://img.shields.io/badge/状态-MVP-orange)

Marginalia 把一个本机 AI agent 装进桌面应用，帮你**精读和写作文档**。资料、数据库、对话历史默认保存在本机；当你把文件作为对话上下文时，相关内容会随请求发送给你配置的模型服务商。

## 核心特性

- 📂 **文档面板**：文件树 + Reader，支持 Markdown、纯文本、代码高亮、PDF 与图片预览。
- 💬 **流式对话**：SSE 实时流式，渲染文本增量、思考过程和工具调用。
- 🔗 **`@文件` 上下文**：把 workspace 里的文件作为上下文附给 agent。
- 🔌 **多 provider**：内置 OpenAI、智谱 GLM、MiniMax、小米 MiMo 预设，也支持自定义。
- 💾 **本地持久化**：workspace / session / 消息存于本机 SQLite（`~/.marginalia/`）。
- 🛡️ **副作用审批**：ask 档下命令与文件变更逐条批准，diff 预览后落盘。
- 📦 **可打包**：当前 CI 覆盖 macOS / Windows；Linux AppImage target 已配置但尚未纳入 CI。

**非目标**：不做 IDE / 终端 / 专业 Git UI / 浏览器自动化。完整边界见[核心术语](./docs/user/concepts.md)。

## 架构速览

```
Electron renderer (React)  ──HTTP/SSE──►  本机 pi-server (Hono)  ──►  pi-coding-agent + LLM
        UI 派生自原始 pi 事件                127.0.0.1:<随机端口>          @earendil-works/pi-*
                                            SQLite ~/.marginalia/
```

三个 pnpm workspace 包：

- `apps/desktop`（`@marginalia/desktop`）— Electron + React 桌面壳与 UI。
- `apps/pi-server`（`@marginalia/pi-server`）— 封装 `@earendil-works/pi-coding-agent` 的本机 HTTP 服务。
- `packages/chat-core`（`@marginalia/chat-core`）— pi 消息/工具类型的共享薄封装。

详见[系统架构](./docs/developer/architecture.md)。

## 快速开始

前置：Node.js ≥ 20.11（建议 22.x）、pnpm 9.15.4。开发机上 `node` 与 `pnpm exec node` 应指向同一 Node 版本；否则 `better-sqlite3` 这类原生依赖可能出现 ABI 不匹配。

```bash
pnpm install
pnpm dev      # 同时启动 pi-server 与 Electron 应用
```

`pnpm dev` 启动的是 **Electron 应用**（不是浏览器页面）。其他命令：

```bash
pnpm build        # 构建所有包
pnpm test         # 测试所有包
pnpm typecheck    # 类型检查所有包
pnpm lint         # eslint
pnpm format       # prettier 写入
```

详见[本地开发指南](./docs/developer/development.md)。

## 打包桌面应用

```bash
pnpm --filter @marginalia/desktop dist    # 在当前 OS 出安装包到 apps/desktop/release/
```

打包涉及 better-sqlite3 原生模块的 ABI 重建，且不能与 dev/test 并行——详见[打包与发布](./docs/developer/build-and-release.md)。

## 使用应用

第一次使用时，先选择 workspace 目录，再添加一个 provider，然后就可以发起对话并用 `@文件` 引入上下文。详见[使用指南](./docs/user/guide.md)。

## 配置 provider

设置页选择预设（OpenAI / 智谱 GLM / MiniMax / 小米 MiMo）填入 API key 即可。自定义 provider 需要被 pi 运行时支持。详见[配置](./docs/user/configuration.md)。

## 文档导航

- [系统架构](./docs/developer/architecture.md)
- [使用指南](./docs/user/guide.md)
- [本地开发指南](./docs/developer/development.md)
- [API 参考](./docs/developer/api.md)
- [打包与发布](./docs/developer/build-and-release.md)
- [配置](./docs/user/configuration.md)
- [核心术语](./docs/user/concepts.md)
- [贡献指南](./docs/developer/contributing.md)

完整索引见 [`docs/`](./docs/README.md)。

## 贡献

从 `main` 切分支，遵循 Conventional Commits（带包 scope），提交前过 commit gate（TDD + typecheck/test + UI 截图）。详见[贡献指南](./docs/developer/contributing.md)。

修改用户可见功能、API、配置、打包/runtime 行为或验证流程时，需要在同一改动里同步相关文档。

## 许可证

当前仓库尚未提供 LICENSE 文件。
