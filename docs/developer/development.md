# 本地开发指南

## 环境要求

| 工具     | 版本                                    | 说明                                                                                |
| -------- | --------------------------------------- | ----------------------------------------------------------------------------------- |
| Node.js  | ≥ 20.11（建议 22.x）                    | dev/test 下 pi-server 跑在系统 Node 上；建议用 22.x 贴近 Electron 39 内置 Node 22。 |
| pnpm     | 9.15.4                                  | 见根 `package.json` 的 `packageManager`。                                           |
| Electron | 39（已在 desktop devDependencies 锁定） | pi 生态 / undici 要求 ≥ 39（Node 22.19+）。                                         |

仓库是 pnpm workspace + ESM（`"type": "module"`）。

## 安装

```bash
pnpm install
```

## Node 与原生依赖 ABI

`better-sqlite3` 是原生模块，必须和加载它的运行时 ABI 一致：

- dev/test：pi-server 由系统 `node` 启动，加载系统 Node ABI 的 `better-sqlite3`。
- packaged：pi-server 由 Electron `utilityProcess.fork` 启动，加载 Electron ABI 的 `better-sqlite3`。

因此，“打包后统一使用 Electron bundled Node”并不意味着本地 dev/test 也使用 Electron ABI。避免在同一个 shell 里混用不同 Node 管理器；`node`、`pnpm exec node` 和 native rebuild 使用的 Node 应保持一致。

快速检查：

```bash
node -p "process.version + ' modules=' + process.versions.modules"
pnpm exec node -p "process.version + ' modules=' + process.versions.modules"
```

如果测试报 `NODE_MODULE_VERSION` mismatch，先恢复 pi-server 依赖到当前 Node ABI：

```bash
pnpm --filter @marginalia/desktop run rebuild:server-native
pnpm --filter @marginalia/pi-server test
```

## 启动开发环境

```bash
pnpm dev
```

它会先构建 pi-server，再用 `concurrently` 同时跑：

- pi-server 的 `build --watch`，
- desktop 的 `dev`——后者编译 Electron 侧 TS（`tsconfig.node.json`），起 Vite dev server，等其就绪后用 `VITE_DEV_SERVER_URL` 拉起 **Electron 应用**。

> `pnpm --filter @marginalia/desktop dev` 启动的是 **Electron 应用**（Vite + Electron 一起），不是浏览器页面。直接用浏览器打开 Vite 页面拿不到 `window.marginalia` 桥接，server 状态会显示不可用。

## 常用命令

全部包（根目录，`-r` 递归）：

```bash
pnpm build        # 构建所有包
pnpm test         # 测试所有包
pnpm typecheck    # 类型检查所有包
pnpm lint         # eslint apps packages
pnpm format       # prettier 写入
pnpm format:check # prettier 校验
```

单个包用 `--filter`：

```bash
pnpm --filter @marginalia/desktop test
pnpm --filter @marginalia/pi-server typecheck
pnpm --filter @marginalia/chat-core build
```

按名称/模式跑单个测试（Vitest run）：

```bash
pnpm --filter @marginalia/desktop test -- <pattern>
```

> desktop 的 `typecheck` 跑**两个** tsconfig——`tsconfig.json`（src）和 `tsconfig.node.json`（vite/electron 配置），两者都必须通过。

打包相关命令见[打包与发布](./build-and-release.md)。

## 相关环境变量

| 变量                   | 说明                                                   |
| ---------------------- | ------------------------------------------------------ |
| `MARGINALIA_NODE_PATH` | dev 下指定启动 pi-server 用的 `node` 二进制。          |
| `MARGINALIA_DB_PATH`   | 覆盖 SQLite 路径（默认 `~/.marginalia/db.sqlite`）。   |
| `VITE_DEV_SERVER_URL`  | Electron 从该 URL 加载 renderer；`pnpm dev` 自动设置。 |

完整清单见[配置 · 环境变量](../user/configuration.md#环境变量)。

## 代码约定

这些约定是硬性的（详见根 `CLAUDE.md`）：

- **ESM 导入扩展名**：TypeScript 源码导入即使是 `.ts`/`.tsx` 也写 `.js` 后缀，例如 `import { Foo } from "./Foo.js"`。漏写会导致构建失败。
- **`@/` 别名** → `apps/desktop/src/`（tsconfig + vite 都配了），跨目录导入优先用它。
- **i18n 强制**（`apps/desktop`）：每个面向用户的字符串（文本、`aria-label`、placeholder、toast）都要走 `t()`（`@/i18n/useTranslation.js`）。新增 key 要同时加到 `src/i18n/messages.ts` 的 `en` 和 `zh`——`zh` 用 `satisfies`，漏 key 会在 typecheck 报错。UI 里不允许硬编码英文。
- **设计 token**：视觉风格锁定在 mono + serif + emerald（见 `src/styles.css` + `tailwind.config.ts`）。用设计 token（`text-muted`、`border-soft`、`brand`、`.dot`、`.h-display` 等），不要写临时颜色。
- **聊天模型约定**：保持消息体为 pi 原生形状，不重新引入扁平化的 `UiMessage`/`UiToolCall`。详见[系统架构 · 单一事实源](./architecture.md#单一事实源single-source-of-truth)。
- **文档代码引用**：`docs/` 里指向源码时用 `path`（整文件）或 `path#符号`（文件内稳定的标识符 / 路由 / 字符串），**不要用 `path:line`**——行号会随上方代码变动而静默失真。引用写成 repo 根相对路径，守卫测试 `apps/desktop/scripts/docs-references.test.ts` 会校验文件存在、锚点命中，并在出现 `:line` 时报错。需要精确到某一行时，用提交 SHA 固定的 GitHub permalink。

## 提交前检查（commit gate）

每次提交前（根 `CLAUDE.md` 的标准规则）：

1. **TDD**：先写或调整测试，看它失败，再实现到通过。
2. 跑改动所在包的 `typecheck` + 相关 `test`，确认通过。
3. **UI 改动**：用 **Electron 截图**验证（`pnpm verify:screenshots`）——在浏览器打开 Vite 页面不算数。场景和输出见 `apps/desktop/scripts/README.md`。

## 测试

- `apps/desktop`：Vitest + jsdom + Testing Library。
- `apps/pi-server`、`packages/chat-core`：Vitest。

## 截图验证

默认 UI gate：

```bash
pnpm verify:screenshots
```

常用调试命令：

```bash
pnpm --filter @marginalia/desktop verify:screenshots -- --list
pnpm --filter @marginalia/desktop verify:screenshots -- --scenario core-ui
```

验证刚构建的新功能（打开真 Electron，手动导航到新界面后输入标签截图，空行或 `q` 结束）：

```bash
pnpm verify:screenshots:shot
```

输出写到 `output/desktop-screenshots/`。runner 会设置隔离的 `MARGINALIA_DB_PATH`、`HOME` 和 `MARGINALIA_USER_DATA_DIR`，避免使用真实 `~/.marginalia` 状态。真实 MiniMax 场景是 opt-in：

```bash
MINIMAX_CN_API_KEY=... pnpm verify:screenshots:live
```

## 相关文档

- 整体架构与进程模型：[系统架构](./architecture.md)
- 提交/分支/PR 规范：[贡献指南](./contributing.md)
