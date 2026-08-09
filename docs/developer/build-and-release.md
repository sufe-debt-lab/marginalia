# 打包与发布

本文说明如何把 Marginalia 打包成桌面安装包，以及打包流水线中最棘手的一环——原生模块 `better-sqlite3` 的 ABI 处理。面向需要出包或维护发布流程的贡献者。

项目当前是 Alpha / NO-GO。下面的命令能生成安装包，不表示产物已满足正式发布要求；当前阻断见[产品状态](../product/status.md)。

## 一句话上手

```bash
pnpm --filter @marginalia/desktop dist      # 在当前 OS 上出对应安装包
pnpm --filter @marginalia/desktop package    # 只产出未打包目录（electron-builder --dir，调试用）
```

产物落在 `apps/desktop/release/`。

> ⚠️ 打包期间**不要并行跑 `pnpm dev` 或 `pnpm test`**。原因见下文「ABI 处理」——打包过程会临时把共享 pnpm store 里的 better-sqlite3 切成 Electron ABI，并行的 dev/test 会撞上这个瞬时状态而崩溃。

## 打包流水线

desktop 的打包 scripts（`apps/desktop/package.json`）：

| script                  | 内容                                                                |
| ----------------------- | ------------------------------------------------------------------- |
| `build:server`          | `node scripts/build-pi-server.mjs`——产出自包含的 pi-server bundle。 |
| `rebuild:server-native` | 只把 workspace store 里的 `better-sqlite3` 恢复到当前 Node ABI。    |
| `prepack:app`           | `pnpm -r build` + `pnpm run build:server`——打包前的全部构建。       |
| `package`               | `prepack:app` + `electron-builder --dir`。                          |
| `dist`                  | `prepack:app` + `electron-builder`（出安装包）。                    |

root/pi-server 的 ABI 恢复 scripts：

| script          | 内容                                                                              |
| --------------- | --------------------------------------------------------------------------------- |
| `ensure:native` | 验证 pi-server 实际加载路径，只有 ABI mismatch 时才调用 `rebuild:server-native`。 |
| `check:native`  | 只验证 pi-server 实际加载路径；与 `pi-server start` 的 check-only 模式一致。      |

流程：**构建所有包 → 构建并部署 pi-server bundle → electron-builder 组装安装包**。

Packaged main process 始终加载应用内 `dist/index.html`，不接受 `VITE_DEV_SERVER_URL` 覆盖。只有未打包开发
进程会接受 `http:`/`https:` 的 `127.0.0.1`、`localhost` 或 bracketed IPv6 loopback `[::1]`；其他 host、
协议、带 userinfo/credentials 或无效 URL 均回退到 packaged renderer entry。这条 renderer entry trust
contract 由 Electron main 单元测试覆盖。

## pi-server bundle 与 better-sqlite3 ABI

脚本：`apps/desktop/scripts/build-pi-server.mjs`。这是整个打包里最绕的部分，原因是 better-sqlite3 是原生模块，而 **Electron 用的 `NODE_MODULE_VERSION`（ABI）与系统 Node 不同**。

- 系统 Node 装出来的 better-sqlite3 预编译包**无法**在 Electron 里加载；
- 但开发和测试又跑在系统 Node 上，需要系统 Node ABI 的版本。

脚本的做法：

1. `pnpm --filter @marginalia/pi-server build`，再 `pnpm deploy --prod --config.node-linker=hoisted` 把 pi-server 连同依赖部署成一个**无符号链接、自包含**的目录 `apps/pi-server/.deploy/pi-server/`。
   - 用 `node-linker=hoisted` 是因为 pnpm 默认的隔离布局是指向 `.pnpm` 的符号链接农场，electron-builder 不会复制；hoisted 给出真实的顶层包目录。之后删掉 `.bin` 和 `.pnpm` 残留。
   - bundle 刻意嵌套在 `.deploy/pi-server/` 下：electron-builder 的 `extraResources` 复制器会硬排除 `from` 根目录下的 `node_modules`，但允许嵌套的——从 `.deploy` 复制就能得到 `pi-server/node_modules`。
2. 用 `electron-rebuild` 把 **workspace store 里**的 better-sqlite3 按 Electron ABI 从源码编译，再把编译出的 `better_sqlite3.node` 拷进 deploy 目录。
   - 之所以编译 store 副本而非 deploy 副本：`@electron/rebuild` 只能可靠地从源码编译 store 副本；指向新部署的副本时它会回退到 prebuild-install 并塞回系统 Node 的预编译包。
3. 用 `node-gyp` 和当前脚本的 `process.execPath` / `process.versions.node` 把 store 还原成当前 Node ABI，并立即用同一个 Node 打开 `better-sqlite3` 的 `:memory:` 数据库做自检。
4. 最后用 `process.dlopen` 校验 deploy 里的二进制**确实是 Electron ABI**（在系统 Node 下加载它必须抛 `NODE_MODULE_VERSION` 不匹配错误）——否则说明拷贝没生效，打出来的包会在启动时崩溃。

> 已知问题：步骤 2、3 之间共享 store 的 better-sqlite3 短暂处于 Electron ABI。这就是「打包不可与 dev/test 并行」的根因。彻底隔离的重建（在 workspace store 之外编译）能消除它，目前尚未做。

如果本地测试已经遇到 `NODE_MODULE_VERSION` mismatch，先运行：

```bash
pnpm --filter @marginalia/pi-server run ensure:native
```

`ensure:native` 是常规入口：它只检查 pi-server 自己会加载的 `apps/pi-server/node_modules/better-sqlite3` 路径，并且只在 ABI mismatch 时调用 `rebuild:server-native`。如果 `ensure:native` 本身无法恢复，再手动运行 `pnpm --filter @marginalia/desktop run rebuild:server-native` 作为 fallback。

这个问题在“打包后统一 Electron Node”之后仍可能出现，是因为 dev/test 仍运行在系统 Node 上，而打包流程会临时改写共享 pnpm store 里的 native 二进制。Electron ABI 只属于 packaged pi-server bundle，不应该泄漏回 dev/test store。`pi-server start` 直接用 `node` 做 check-only load 检查，避免生产式启动依赖 workspace、pnpm 和本地 native build tooling。

## electron-builder 配置

`apps/desktop/electron-builder.yml` 关键项：

- `appId: works.marginalia.desktop`，`productName: Marginalia`，产物目录 `release/`。
- **asar**：开启；`asarUnpack: "**/*.node"` 让原生 `.node` 解包到 asar 外才能被 `dlopen`。
- **files**：只把 `dist/`、`dist-electron/`、`package.json` 装进 asar——renderer 由 Vite 打进 `dist/`，main 进程无第三方运行时依赖，所以**不打包 pnpm 的 `node_modules`**。
- **extraResources**：把 `../pi-server/.deploy`（即上一步产出的 bundle）复制到 `resources/`，于是运行时得到 `resources/pi-server/`（含 dist + 含 Electron-ABI better-sqlite3 的 node_modules）。
- `npmRebuild: false` / `nodeGypRebuild: false`：原生模块已由 `build:server` 自己重建，禁止 electron-builder 再插手。
- **图标**：单个 `apps/desktop/build/icon.png`（1024×1024，当前为占位图），electron-builder 在打包时派生 macOS `.icns` 和 Windows `.ico`。

## 平台与产物

| 平台    | 目标         | 备注                                               |
| ------- | ------------ | -------------------------------------------------- |
| macOS   | `dmg`、`zip` | 当前 `identity: null`，**未签名/未公证**。         |
| Windows | `nsis`       | 未签名。                                           |
| Linux   | `AppImage`   | electron-builder 配置了 target；当前 CI 尚未覆盖。 |

**每个平台的安装包必须在对应 OS 上构建**：better-sqlite3 由 `build-pi-server.mjs` 在宿主机上按该平台重建，无法从 macOS 交叉构建 Windows/Linux 包。

## CI 分成质量检查和打包

`.github/workflows/ci.yml` 对 push 和 pull request 运行通用质量检查：

- Node 22、pnpm 9.15.4、frozen lockfile；
- `pnpm verify`；
- Pull request 额外运行 docs impact，作为快速反馈；该 job 会执行 PR checkout 中的代码，不单独承担门禁完整性。

`.github/workflows/docs-gate.yml` 使用 `pull_request_target`，从目标分支提取受信任 checker 和 docs-impact policy，检查事件中精确的 PR head。它不安装依赖，也不执行 PR 提供的脚本；仓库内容权限只读，`statuses: write` 只用于把 `trusted-docs` 结果发布到精确 head SHA。有豁免时，有 write 权限的维护者必须为当前 head 重新添加 `docs-impact-approved` label。`.github/CODEOWNERS` 为 checker、contracts、workflow 和 agent 规则指定维护者评审。

通用 CI 和可信文档 gate 都不执行视觉裁决，也不生成安装包。UI 改动仍需在 PR 中记录 Electron 截图和每张 changed diff 的裁决。合并前要在 branch protection 中把 `verify` 和 PR head 上的 `trusted-docs` commit status 配成 required checks，并要求 Code Owner review；仅添加 workflow 和 CODEOWNERS 文件不会自动阻止合并。

### Desktop 打包 workflow

`.github/workflows/build-desktop.yml`：

- **触发**：推送 `v*` tag，或手动 `workflow_dispatch`。
- **矩阵**：`macos-latest`（→ dmg + zip）、`windows-latest`（→ nsis exe）。`fail-fast: false`。
- **环境**：Node 22、pnpm 9.15.4，`pnpm install --frozen-lockfile`。
- **打包**：`pnpm --filter @marginalia/desktop run dist -- --publish never`，并设 `CSC_IDENTITY_AUTO_DISCOVERY=false` 阻止 macOS 自动签名（当前是未签名 spike 构建）。
- **产物**：上传 `release/` 下的 `*.dmg` / `*.zip` / `*.exe`，保留 14 天。

打包 workflow 当前不产 Linux AppImage，也不等同于 PR 质量门禁。

## 打包后 smoke test

打包命令通过不等于应用能在客户机器上启动。发布前至少做一次非破坏性 smoke test：

1. 运行 `pnpm --filter @marginalia/desktop package`。
2. 启动 `apps/desktop/release/` 下的 packaged 应用。
3. 确认窗口不白屏，pi-server 状态变为 ready。
4. 确认存在 Electron `utilityProcess.fork` 启动的 Node utility process。
5. 找到本机监听端口并访问 `/health`，确认返回 `status: "ok"`。
6. 打开 Settings → Skills，确认受 capability 保护的列表能加载；未带 bearer 直接请求同一路由应返回
   `401`。

真实 provider 对话会写入用户数据库并可能消耗外部模型额度，不属于默认 smoke test。

### Packaged capability 启动契约

Electron main 为每次 packaged pi-server utility process 生成 token，并通过 child environment 传入。
pi-server 入口必须在 fake/real agent、Pi loader 或工具初始化前读取
`MARGINALIA_CAPABILITY_TOKEN`/`MARGINALIA_ALLOWED_ORIGIN`，把值保留在 capability policy 后立即从
`process.env` 删除。这样后续 Pi Bash 工具启动的真实子进程不会继承 token 或 Origin，同时 bearer
授权仍使用已捕获的 policy 正常工作。token 不得写入 ready stdout、日志、manifest、SQLite 或截图；
Electron 当前会在 main 状态中持有 token，并通过 preload status bridge 交给 renderer 发起受保护请求。

环境删除不是 secret 擦除保证：Linux `/proc/<pid>/environ` 可能仍保留 exec 时的原始环境字节，Node
进程内也仍有用于授权的 policy 值。该措施只收紧后续子进程继承边界；发布威胁模型仍把本机同用户进程
读取和整体 loopback 未认证路由记为 open risk。

## 已知限制与待办

- **macOS 未签名/未公证**：面向用户的正式版需要 Developer ID 签名 + 公证（并为未签名的 better-sqlite3 `.node` 配 `hardenedRuntime` + `disable-library-validation` 权限）。配置里以 `identity: null` 标记为 spike。
- **Windows 未签名**：NSIS 可以生成，但客户机没有可验证的发布者身份。
- **没有自动更新与回滚**：当前安装包需要手工分发和升级。
- **没有 LICENSE**：公开发布前需要明确代码许可证。
- **Smoke test 未自动化**：构建成功不能替代干净客户机上的安装、启动、健康检查和卸载验证。
- **打包不可与 dev/test 并行**：见上文 ABI 处理。

## 相关文档

- 进程模型与 dev/packaged 启动差异：[系统架构](./architecture.md)
- 存储位置与环境变量：[配置](../user/configuration.md)
- 发布阻断与验证基线：[产品状态](../product/status.md)
- PR 验证和文档影响：[贡献指南](./contributing.md)
