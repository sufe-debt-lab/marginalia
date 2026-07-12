# Marginalia

> 本地优先的桌面端 AI 文档协作器。

![version](https://img.shields.io/badge/version-0.1.0-emerald) ![local-first](https://img.shields.io/badge/本地优先-✓-blue) ![status](https://img.shields.io/badge/状态-Alpha-red)

Marginalia 把一个本机 AI agent 装进桌面应用，主要处理文章解读和基于资料的写作。资料、数据库和对话历史默认保存在本机；提示、附件内容和 agent 工具读取结果会发送给你选择的模型服务商。

项目当前处于 **Alpha / NO-GO**，适合开发和评估，不适合作为正式发布产品。安全边界、运行恢复和发布链路的现状见[产品状态](./docs/product/status.md)。

## 核心特性

- **文档面板**：文件树、搜索和 Reader，支持 Markdown、纯文本、代码高亮、PDF 与图片预览。Office 文件当前不支持内置预览。
- **流式对话**：SSE 实时返回文本、thinking 和工具调用，长回答支持代码块、标题目录和消息操作。
- **文件上下文**：用 `@文件` 或附件把 workspace 中的文本加入请求。PDF、Office 等 raw 文件当前不抽取正文。
- **Provider 配置**：界面提供 OpenAI、智谱 GLM、MiniMax、小米 MiMo 四个预设。当前只有 OpenAI 和 MiniMax 的映射能被 pi registry 识别；GLM 与小米预设仍有已知映射错误。自定义 Base URL 尚未接入模型请求。
- **本地持久化**：workspace、session、消息和 run 存于 `~/.marginalia/`。Provider API key 当前以明文保存在 SQLite 中。
- **工具与审批**：提供 Full、Ask、Read-only 三档和审批卡。当前实现不是安全沙箱，Ask 也不会拦截每一个副作用。
- **导出**：助手回答可以复制、导出 `.md` 或经覆盖确认写回 workspace。
- **桌面打包**：macOS、Windows 打包链路已配置，Linux AppImage target 只存在于配置中；现有安装包未签名。

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

前置：Node.js ≥ 22.19、pnpm 9.15.4。开发机上 `node` 与 `pnpm exec node` 应指向同一 Node 版本；否则 `better-sqlite3` 这类原生依赖可能出现 ABI 不匹配。

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
pnpm docs:check   # 文档、API inventory 和生命周期检查
pnpm verify       # 文档、格式、lint、类型、测试和构建
```

详见[本地开发指南](./docs/developer/development.md)。

## 打包桌面应用

```bash
pnpm --filter @marginalia/desktop dist    # 在当前 OS 出安装包到 apps/desktop/release/
```

打包涉及 better-sqlite3 原生模块的 ABI 重建，且不能与 dev/test 并行——详见[打包与发布](./docs/developer/build-and-release.md)。

## 使用应用

第一次使用时，先选择 workspace 目录，再添加并启用一个 provider，然后发起对话并用 `@文件` 引入上下文。当前工具权限和数据外发边界仍有 Alpha 限制，使用前请读[使用指南](./docs/user/guide.md)。

## 配置 provider

设置页可以选择四个预设并填入 API key。Test 按钮只检查本地 provider/model 注册和是否配置凭据，不会发出真实模型请求，也不验证 key 是否有效。详见[配置](./docs/user/configuration.md)。

## 文档导航

- [系统架构](./docs/developer/architecture.md)
- [产品状态](./docs/product/status.md)
- [使用指南](./docs/user/guide.md)
- [本地开发指南](./docs/developer/development.md)
- [API 参考](./docs/developer/api.md)
- [打包与发布](./docs/developer/build-and-release.md)
- [配置](./docs/user/configuration.md)
- [核心术语](./docs/user/concepts.md)
- [贡献指南](./docs/developer/contributing.md)
- [文档生命周期](./docs/developer/documentation-lifecycle.md)
- [活跃 Superpowers 文档](./docs/superpowers/README.md)

完整索引见 [`docs/`](./docs/README.md)。

## 贡献

从维护者指定的 PR base 切分支，遵循 Conventional Commits，提交前完成 TDD、正式文档同步和验证。当前远端没有 `main` ref，不要在文档或脚本中虚构固定主分支。详见[贡献指南](./docs/developer/contributing.md)。

修改用户可见功能、API、配置、打包/runtime 行为或验证流程时，需要在同一改动里同步相关文档。

## 许可证

当前仓库尚未提供 LICENSE 文件。
