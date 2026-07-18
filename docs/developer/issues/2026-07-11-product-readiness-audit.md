---
record_id: AUDIT-PRODUCT-READINESS-2026-07-11
status: open
created: 2026-07-11
updated: 2026-07-11
verified_commit: 1199645
owner: repository-maintainers
---

# Product Readiness Audit - 2026-07-11

本次审计覆盖 Electron runtime、renderer、pi-server、SQLite、agent tools、打包流程和正式文档。P0/P1 表示全产品范围的处理优先级，不等同于 CVSS 或公开漏洞评级；每项的 `Target` 单独决定是否属于 M0。

## 审计基线

- Commit：`1199645`
- 自动检查：`pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm build` 通过。
- 测试：423 个测试，1 个真实 MiniMax live test 默认跳过。
- 视觉：32 张截图中 24 unchanged、8 changed、0 errors。命令默认返回 0，8 张 changed 尚未裁决。
- 未覆盖：签名安装包、客户机启动、自动更新和真实 provider 全链路。

## Issue inventory

<!-- readiness-issue-inventory:start -->

| ID                | Priority | Status      | Last verified | Target                     | Evidence                                                                                                                              |
| ----------------- | -------- | ----------- | ------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| P0-SEC-001        | P0       | open        | 2026-07-18    | M0-trustworthy-local-alpha | `apps/pi-server/src/security/capability.ts`、`apps/pi-server/src/app.ts`、`apps/desktop/electron/pi-server-spawner.ts`                |
| P0-SEC-002        | P0       | open        | 2026-07-11    | M0-trustworthy-local-alpha | `apps/pi-server/src/agent/pi-coding-agent-client.ts`、`apps/pi-server/src/agent/approval-gateway.ts`                                  |
| P0-SEC-003        | P0       | open        | 2026-07-11    | M0-trustworthy-local-alpha | `apps/pi-server/src/agent/approval-policy.ts`                                                                                         |
| P0-SEC-004        | P0       | open        | 2026-07-18    | M0-trustworthy-local-alpha | `apps/pi-server/src/agent/agent-session-registry.ts`                                                                                  |
| P0-SEC-005        | P0       | open        | 2026-07-11    | M0-trustworthy-local-alpha | `apps/pi-server/src/files/path-sandbox.ts`、`apps/pi-server/src/app.ts`                                                               |
| P0-SEC-006        | P0       | open        | 2026-07-11    | M0-trustworthy-local-alpha | `apps/pi-server/src/db/repositories.ts`、`apps/desktop/electron/main.ts`                                                              |
| P0-RUN-001        | P0       | open        | 2026-07-11    | M0-trustworthy-local-alpha | `apps/pi-server/src/app.ts`、`apps/pi-server/src/agent/agent-session-registry.ts`、`apps/desktop/src/hooks/useStreamingChat.ts`       |
| P1-PROVIDER-001   | P1       | open        | 2026-07-11    | M0-trustworthy-local-alpha | `apps/pi-server/src/agent/provider-id.ts`、`apps/pi-server/src/providers/provider-availability.ts`                                    |
| P1-DOCUMENT-001   | P1       | open        | 2026-07-11    | post-M0                    | `apps/pi-server/src/files/document-reader.ts`、`apps/desktop/src/documents/DocumentViewer.tsx`                                        |
| P1-RECOVERY-001   | P1       | open        | 2026-07-11    | M0-trustworthy-local-alpha | `apps/desktop/electron/pi-server-spawner.ts`、`apps/desktop/electron/main.ts`                                                         |
| P1-DATA-001       | P1       | open        | 2026-07-11    | M0-trustworthy-local-alpha | `apps/pi-server/src/db/repositories.ts`                                                                                               |
| P1-UX-001         | P1       | open        | 2026-07-11    | M0-trustworthy-local-alpha | `apps/desktop/src/chat/MessageStream.tsx`、`apps/desktop/src/chat/Composer/Composer.tsx`、`apps/desktop/src/settings/GeneralPane.tsx` |
| P1-MESSAGE-001    | P1       | open        | 2026-07-11    | post-M0                    | `docs/internal/plans/2026-07-10-message-stream.md`                                                                                    |
| P1-QUALITY-001    | P1       | open        | 2026-07-13    | M0-trustworthy-local-alpha | `apps/desktop/scripts/compare-screenshots.mjs`、2026-07-11 视觉审计                                                                   |
| P1-RELEASE-001    | P1       | open        | 2026-07-11    | public-release             | `apps/desktop/electron-builder.yml`、`.github/workflows/build-desktop.yml`                                                            |
| P1-EXTENSIONS-001 | P1       | open        | 2026-07-18    | post-M0                    | `apps/pi-server/src/agent/pi-coding-agent-client.ts`、`apps/desktop/src/settings/SettingsView.tsx`                                    |
| P1-A11Y-001       | P1       | open        | 2026-07-11    | M0-trustworthy-local-alpha | `apps/desktop/src`                                                                                                                    |
| P1-DOCS-001       | P1       | in-progress | 2026-07-12    | M0-trustworthy-local-alpha | `scripts/docs-check.mjs`、`.github/workflows/ci.yml`、`.github/workflows/docs-gate.yml`                                               |

<!-- readiness-issue-inventory:end -->

## P0-SEC-001: Loopback API 只有局部认证

Task 1 已加入局部缓解：Electron 为每个 pi-server 进程生成高熵 token，所有 run 在读取业务数据
前验证 bearer 和 Origin；CORS 只返回 packaged `null`/缺省 Origin 或已校验的开发 exact origin，
不再反射任意网页来源。启动器在继承父进程环境前移除 capability token 和 allowed-origin，再注入
本次启动生成/校验的值，缺失或无效 Vite 配置不会沿用旧 origin。

P0 继续 open：workspace、provider、文件、审批等既有 route 仍不验证 bearer，raw 文件 URL 也
没有凭据边界；缺少 Origin 的本地进程不受浏览器 CORS 限制。随机 loopback 端口和仅保护 run 的
capability 都不是整套 API 的授权机制。

修复目标：Electron 启动时生成进程级 secret，经 preload 提供给 renderer；除健康检查外的路由验证凭据；CORS 只允许明确的 renderer/dev origin；raw 文件不再依赖无认证 URL。

验收：未认证请求稳定返回 401；任意网页 origin 无法读取或修改数据；renderer、重启和 packaged smoke test 通过。

## P0-SEC-002: Workspace 不是 agent 沙箱

`POST /workspaces` 接受调用者提供的任意 `rootDir`。Full 和 Ask 使用 pi 默认 coding tools，当前只把 workspace 作为 cwd 传入；读取、写入和编辑工具接受绝对路径，bash 直接在宿主机执行。HTTP 文件接口的路径检查不能约束这些 agent tools。

修复目标：定义并实现统一的文件、命令和子进程边界，绝对路径、符号链接和工作目录切换都经过同一策略；不能隔离的能力在 UI 中明确标记并默认关闭。

验收：覆盖 workspace 外绝对路径、`..`、symlink、shell cwd 和子进程访问的负向测试；用户文档与实际边界一致。

## P0-SEC-003: Ask 审批可被 shell 语义绕过

审批策略按命令分隔符和首 token 判断。`echo`、`cat` 等在 allowlist 中，但命令替换、变量展开和其他 shell 语义没有解析，比如只读前缀内仍可执行嵌套副作用。`write` 目标不存在时也会直接放行，包含 workspace 外的新绝对路径。

修复目标：不要用字符串前缀充当 shell 安全模型。M0 可选择所有 bash 必审，或换成不经 shell 的结构化只读操作；新文件写入也必须先验证边界并让产品文案准确说明是否审批。

验收：命令替换、重定向、管道、分号、换行、绝对路径和新文件用例均不能绕过预期策略。

## P0-SEC-004: 缓存 session 保留旧配置

`AgentSessionRegistry.acquire()` 已把 Skill `effectiveRevision` 纳入 resource cache identity；revision 变化
会淘汰旧 handle，并以持久化 session path 重建，因此 Skill runtime 不再保留旧 loader。后续传入的
model 和 tools 仍不会重新应用。Reasoning 有动态 setter，工具集没有同类更新路径，因此 full 切到
readonly 后仍可能保留旧 session 的工具能力。

修复目标：把影响能力边界的配置纳入缓存 key，或在不兼容变化时显式淘汰并重建 AgentSession。

验收：同一 session 在 provider、model、permission 和资源配置切换后使用新配置；full 到 readonly 的回归测试确认写入和 bash 不可用。

## P0-SEC-005: Symlink parent 允许新文件逃逸

`resolveWorkspacePath()` 会检查已存在目标的 realpath；目标不存在时遇到 `ENOENT` 直接返回 lexical candidate，没有检查最近存在父目录。`PUT /workspaces/:id/files/content` 随后创建父目录并写文件。审计用 `workspace/linked -> outside` 复现，写入 `linked/new.md` 后文件出现在 workspace 外。

修复目标：创建文件前解析最近存在父目录的 realpath，并在打开文件时防止检查到使用之间被替换；agent 写工具复用同一边界。

验收：现有文件、新文件、嵌套 symlink、断链 symlink 和竞态测试均不能写出 workspace。

## P0-SEC-006: Secret 与 renderer 缺少发布级保护

Provider API key 直接写入 SQLite `env_vars.value`。数据库副本、备份、崩溃采集或其他本地进程可读取 key。Electron 同时配置 `sandbox: false`，扩大了 renderer 被利用后的能力面。

修复目标：secret 移到 OS keychain 或等价加密存储，SQLite 只保存引用和非敏感元数据；启用 renderer sandbox，保持 context isolation 和窄 preload API。

验收：SQLite 不含明文 key；迁移和删除流程可恢复；sandbox 下开发与 packaged 流程通过。

## P0-RUN-001: 同一 session 可以并发执行多个 run

服务端每次 `POST /sessions/:sessionId/runs` 都创建 run，没有 active-run coordinator。Registry 会把并发请求交给同一个 AgentSession。renderer 的 `sendingRef` 只保护当前 hook 实例，切换视图或重新挂载后没有 cleanup 自动 abort 旧请求。

修复目标：服务端成为 run 所有权的唯一事实源，按 session 实施 single-flight；定义 start、stop、disconnect、replace、crash 和 restart 的状态转换。

验收：并发请求得到确定的 409 或替换语义；切换 session、卸载 ChatView、断连和 server 重启后没有孤儿 run 或交错事件。

## P1-PROVIDER-001: Provider 配置语义不完整

`baseUrl` 会存入数据库并显示在 UI，但 run 只按规范化 provider ID 和 model ID 调用 `getModel()`，没有把该 URL 传给模型。GLM 被规范化为 registry 中不存在的 `glm`，小米被规范化为不存在的 `xiaomi-mimo`；当前 pi 使用 `zai` 和 `xiaomi`/`xiaomi-token-plan-cn` 等 ID，GLM 预设的 `glm-4.6` 也不在模型清单。Test 按钮调用 `ModelRegistry.getAvailable()`，只检查本地 provider/model 注册和是否配置凭据，不会联网验证 key。

修复目标：要么接通自定义 endpoint 和真实连通性测试，要么从产品路径移除对应承诺并给出准确提示。

验收：配置值影响实际请求，并有隔离测试；Test 的名称、请求行为和失败信息一致。

## P1-DOCUMENT-001: 非文本资料没有正文抽取

PDF、图片、音视频和 Office 文件被标记为 `rawOnly`。PDF 可在 renderer 中逐页渲染，Office 显示不支持；加入对话时只生成附件占位提示，不抽取正文。

修复目标：按文本工作优先级实现 PDF 和常见 Office 文档抽取，并清楚区分视觉预览、文本抽取和模型附件能力。

验收：多页、扫描版、损坏文件、超限文件和中文文档有明确结果与降级提示。

## P1-RECOVERY-001: Server 和 run 恢复不完整

`startPiServer()` 的 exit listener 只负责启动 promise。进程已经 ready 后再退出，main 里的 `serverStatus` 仍可能保持 ready。UI 因此在普通 API 调用处才看到失败。Run 也没有可查询的活动状态或重连协议。

修复目标：ready 后持续监听进程退出，保存最近日志并暴露受控重启；定义 run 查询和恢复边界。

验收：进程退出后 UI 及时进入 failed，重启不会复用旧进程引用，活动 run 获得确定终态。

## P1-DATA-001: 删除 provider 会清除 run 历史

`deleteProvider()` 先删除关联 runs，再删除 provider 和 key，避免外键失败。历史对话因此失去 provider、model、状态和错误审计记录。

修复目标：采用 disable/soft delete，或让历史 run 保存不可变 provider/model 快照并允许 provider 引用为空。

验收：删除或停用 provider 后，已有会话和 run 历史仍可查看。

## P1-UX-001: 多个 UI 控件没有完整行为

MessageStream 在尾部内容变化时始终调用 `scrollIntoView()`，用户向上阅读时会被拉回底部。Slash menu 选择命令后只删除 token；resume last session toggle 没有接到启动流程；数据 import/export 和 MCP/Skills 控件处于禁用状态。没有 provider 时 New chat 仍可创建 session 并保存 pending prompt，缺少明确引导。

修复目标：完成已暴露控件的行为，或在实现前移除入口；滚动改成跟随、暂停和回到底部三态。

验收：每个可点击控件都有用户可见结果；长回答中向上滚动不会被打断；无 provider 流程不会生成悬空对话。

## P1-QUALITY-001: 视觉门禁仍是软报告

截图 capture 有确定性隔离和基线，但比较脚本只有显式传入 `--fail-on-diff` 或阈值时才因 changed 失败。2026-07-11 报告包含 8 张 changed，命令仍返回 0。

修复目标：保持视觉裁决独立于通用 CI，但要求 UI 改动逐张记录裁决；未经裁决的 changed 不能作为完成证据。

验收：当前 8 张差异完成 bless 或修复；PR 描述保存裁决结果。

2026-07-13 进展：capture 判稳从字节相等改为像素容差（`assessFramePair`，消除合成器亚可见光栅噪声导致的 approval-denied 采集失败）；provider 与 seed workspace fixture 改为 create-or-reuse，seeded-workspace 与 approval-flow 在单场景和默认分组两种模式下渲染一致（旧基线嵌入的重复 workspace 伪影与 core-ui provider 泄漏随之消除）；全部 changed 完成逐张裁决并重采基线，默认分组与两种单场景运行均为 32/32、10/10、4/4 unchanged。剩余范围：`--fail-on-diff` 尚非默认，视觉裁决仍依赖人工流程。

## P1-MESSAGE-001: 消息流计划仍有四组未完成能力

已归档的 message-stream plan 只完成 Task 1–11。Task 12–15 中的用户上滚后暂停跟随与回到底部胶囊、`file_changed` envelope、自动变更持久化、TurnSummary、重开还原和 message-stream 专项截图场景均未实现。

修复目标：为剩余能力创建新的 active plan，先确定文件变更事件和持久化边界，再实现滚动三态、逐回合摘要及 live/reopen 一致性；专项视觉场景必须覆盖长回答、实时输出、thinking、摘要和滚动胶囊。

验收：原计划 Task 12–15 的行为和自动测试有新的稳定记录；七个目标视觉状态完成逐张裁决；用户文档和 API 文档与最终事件模型一致。

## P1-RELEASE-001: 发布链路尚未完成

macOS 配置 `identity: null`，Windows 也未签名；没有 macOS notarization、自动更新和 LICENSE。现有 workflow 只在 tag 或手动触发时打 macOS/Windows 包，Linux target 不在 CI，安装包 smoke test 仍靠人工。

修复目标：公开发布前补签名、公证、更新、许可证、跨平台安装测试和回滚说明。

验收：干净机器安装与启动通过；签名可验证；更新失败可回退；发布 checklist 有真实证据。

## P1-EXTENSIONS-001: Skills 与 MCP 不可用

Settings 中 Skills/MCP 两个入口仍被禁用，Composer 也没有 Skill picker。Skills 已有 Catalog、受保护
管理 API、显式 run preflight 和 revision-pinned runtime；loader 的 `noSkills: true` 只关闭 Pi 自身磁盘
discovery，再由 snapshot override 注入 effective Skills。仓库仍没有 MCP server 配置、连接、发现或
工具注入链路。

修复目标：完成 Skills 桌面管理与 Composer 选择流程；在安全边界稳定后设计 MCP 的来源、权限、诊断
和管理流程。正式文档保持区分已实现的 Skills 后端与尚未接入的正常产品路径。

验收：能力状态变更前有独立 spec、威胁模型、故障诊断和端到端测试。

## P1-A11Y-001: 缺少系统性可访问性验证

项目已有部分 aria label 和键盘菜单测试，但没有覆盖完整焦点顺序、dialog focus trap、状态播报、审批等待、长回答操作和缩放布局。

修复目标：建立键盘和 screen reader 核心流程清单，把发现的问题拆成可验证任务。

验收：首启、建会话、发送、停止、审批、错误恢复、导出和设置流程均可只用键盘完成，关键异步状态可被辅助技术感知。

## P1-DOCS-001: 开发完成和文档完成没有同一门禁

审计时只有局部源码引用测试。API 文档漏记已实现的文件写入路由，Superpowers 计划没有 closeout，正式 user/developer 文档也混有过期声明。仓库没有通用 PR CI。

治理候选树已经实施[文档生命周期](../documentation-lifecycle.md)，增加 API inventory、docs impact、统一验证命令、PR CI、可信文档 gate 和归档规则，并通过本地 `pnpm verify`。2026-07-12 的 staged 深审修复了会锁死后续检查的 `same_change` 归档问题，同时确认仍有四类合并阻断：注释中的伪路由可绕过 inventory、公共 API/打包契约映射不完整、旧 approval run 可覆盖当前 PR body 的失败状态，以及 trusted status 未绑定最新 base policy。本地 index/worktree 的生命周期快照差异也是待收口问题。

该变更尚未合入目标分支，GitHub 的 required check、CODEOWNERS 审批和 branch protection 也尚未配置，因此状态保持 `in-progress`。

修复目标：先关闭 staged 深审阻断，再提交并评审治理变更；随后在 GitHub 把可信文档 gate 配为 required check，并启用 Code Owner 审批保护门禁脚本、策略和 workflow。

验收：新增或删除 HTTP 路由而不更新 API inventory 时失败；高信号代码变化缺少对应正式文档时失败；完成的 spec/plan 不留在活跃目录。
