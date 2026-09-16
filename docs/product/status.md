# 产品状态

```text
Stage: Alpha
Release decision: NO-GO
Snapshot date: 2026-08-13
Verified commit: 71fa529
Next milestone: M0 - Trustworthy Local Alpha
```

这是一份经过验证的快照，不是逐提交更新的开发日志。commit 字段记录本轮已验证的修复提交；
下方验证基线明确记录该提交的验证结果。源码和测试提供行为证据；问题的复现、
影响和验收条件见[产品就绪审计](../developer/issues/2026-07-11-product-readiness-audit.md)。

## 能力快照

状态只使用 `implemented`、`partial`、`disabled` 和 `planned`。`implemented` 表示主路径已有验证，不表示已经满足发布条件。

<!-- capability-inventory:start -->

| ID                | Capability                    | Status      | Verified result                                                                                                                                              | Current boundary                                                                             | Release gate                            | Evidence                                                                                                                                | Target                     |
| ----------------- | ----------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| CAP-DESKTOP-001   | Electron shell 与本地 server  | implemented | Electron 启动后拉起随机端口 pi-server，为每个进程注入独立 run/Skills capability，renderer 完成健康检查后进入应用                                             | capability 只保护 run 与 Skills API；ready 后退出可见并可重启；renderer sandbox 未开启       | P0-SEC-001、P0-SEC-006、P1-RECOVERY-001 | `apps/desktop/electron/main.ts`、`apps/desktop/electron/pi-server-spawner.ts`                                                           | M0-trustworthy-local-alpha |
| CAP-WORKSPACE-001 | Workspace、session 与文件浏览 | partial     | 可创建和删除 workspace，管理 session，浏览、搜索、预览和写入文件；HTTP 新文件拒绝 workspace 外 symlink ancestor                                              | workspace 不是 agent 沙箱；HTTP 写入仍非 race-free，Agent tools 不复用该边界                 | P0-SEC-002、P0-SEC-005                  | `apps/pi-server/src/app.ts`、`apps/pi-server/src/files/path-sandbox.ts`                                                                 | M0-trustworthy-local-alpha |
| CAP-PROVIDER-001  | Provider 与 model             | partial     | Provider CRUD、启停、默认模型和运行时 key 注册已接通                                                                                                         | GLM/小米预设映射当前不可用；`baseUrl` 没有进入模型请求；Test 不联网验证 key；key 明文保存    | P0-SEC-006、P1-PROVIDER-001             | `apps/pi-server/src/app.ts`、`apps/pi-server/src/agent/provider-id.ts`、`apps/pi-server/src/providers/provider-availability.ts`         | M0-trustworthy-local-alpha |
| CAP-CHAT-001      | Streaming chat 与长文渲染     | partial     | SSE 流、原始 pi 事件渲染、scoped turn draft、`run_started` 接受边界、thinking、工具卡、代码块、长文目录已实现                                                | 草稿只在 renderer 内存；滚动始终跟到底部；文件变更摘要和当前消息流计划的收口任务未完成       | P1-UX-001、P1-QUALITY-001               | `apps/pi-server/src/app.ts`、`apps/desktop/src/hooks/useStreamingChat.ts`、`apps/desktop/src/chat/MessageStream.tsx`                    | M0-trustworthy-local-alpha |
| CAP-TOOLS-001     | Agent tools 与审批            | partial     | Full、Ask、Read-only 三档入口，审批卡、决策 API、审批记录及 model/tool-profile cache invalidation 已接通                                                     | Ask 基于字符串启发式，新文件默认直通                                                         | P0-SEC-003                              | `apps/pi-server/src/agent/approval-policy.ts`、`apps/pi-server/src/agent/agent-session-registry.ts`                                     | M0-trustworthy-local-alpha |
| CAP-DOCUMENT-001  | 文档浏览与资料上下文          | partial     | 文本文件可预览、搜索并通过 `@文件` 或附件加入请求；PDF 和图片可在文档面板预览                                                                                | PDF、Office、音视频不抽取正文；Office 没有内置预览                                           | P1-DOCUMENT-001                         | `apps/pi-server/src/files/document-reader.ts`、`apps/desktop/src/documents/DocumentViewer.tsx`                                          | post-M0                    |
| CAP-EXPORT-001    | 复制、导出与保存到 workspace  | implemented | 助手回答可复制、导出 `.md`，或经覆盖确认写入当前 workspace；预先存在的越界 symlink ancestor 会被拒绝                                                         | 写入检查与最终 open 之间仍非 race-free                                                       | P0-SEC-005                              | `apps/desktop/src/chat/MessageActions.tsx`、`apps/desktop/src/chat/SaveToWorkspaceDialog.tsx`                                           | M0-trustworthy-local-alpha |
| CAP-RUN-001       | Run 生命周期与恢复            | partial     | Run 要求每进程 bearer 与 Origin 检查；状态写入 SQLite；同 Session single-flight、启动归一、退出/断连终态与审批过期已实现                                     | 其他 loopback route 未认证；进程实例所有权和启动归一已实现；跨视图运行与全局占用仍待后续切片 | P0-SEC-001、P0-RUN-001、P1-RECOVERY-001 | `apps/pi-server/src/security/capability.ts`、`apps/pi-server/src/app.ts`、`apps/desktop/src/hooks/useStreamingChat.ts`                  | M0-trustworthy-local-alpha |
| CAP-SKILLS-001    | Skills                        | partial     | 六级 discovery、byte-pinned immutable Catalog、受保护管理 API、revision/root-pinned runtime、可访问键盘 picker、blocked-turn 修复及 Settings 启停/预览已实现 | Skills v1 不创建、导入、安装、编辑、卸载或删除 Skill；MCP 仍不可用                           | P1-EXTENSIONS-001                       | `apps/pi-server/src/skills/catalog.ts`、`apps/desktop/src/chat/SkillPreconditionBanner.tsx`、`apps/desktop/src/settings/SkillsPane.tsx` | post-M0                    |
| CAP-MCP-001       | MCP                           | disabled    | 设置页保留不可用入口                                                                                                                                         | 没有 server 配置、连接、工具发现或运行时注入                                                 | P1-EXTENSIONS-001                       | `apps/desktop/src/settings/SettingsView.tsx`                                                                                            | post-M0                    |
| CAP-RELEASE-001   | 打包与发布                    | partial     | electron-builder 已配置 macOS、Windows、Linux target；tag/manual workflow 配置为构建 macOS 和 Windows 产物                                                   | 安装包未签名，macOS 未公证，无自动更新；Linux 不在 CI                                        | P1-RELEASE-001                          | `apps/desktop/electron-builder.yml`、`.github/workflows/build-desktop.yml`                                                              | public-release             |
| CAP-DOCS-001      | 文档与质量门禁                | partial     | 治理候选树已实现统一 `docs:check`、API inventory、Superpowers closeout、PR CI 和可信文档 gate                                                                | staged 深审仍有路由提取、影响映射和可信状态时效问题；GitHub 强制配置也尚未完成               | P1-DOCS-001                             | `scripts/docs-check.test.mjs`、`.github/workflows/ci.yml`、`.github/workflows/docs-gate.yml`                                            | M0-trustworthy-local-alpha |

<!-- capability-inventory:end -->

## 发布阻断摘要

问题状态只使用 `open`、`in-progress`、`blocked` 和 `resolved`。本表只保留 P0/P1 摘要，详细证据写在 readiness issue 中。

<!-- issue-inventory:start -->

| ID                | Priority | Status      | Summary                                                                                               | Last verified | Target                     | Evidence                                                                                                               |
| ----------------- | -------- | ----------- | ----------------------------------------------------------------------------------------------------- | ------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| P0-SEC-001        | P0       | open        | Run 与 Skills 已有局部 capability/CORS 防护，其他 loopback route 仍未认证                             | 2026-07-18    | M0-trustworthy-local-alpha | `apps/pi-server/src/security/capability.ts`、`apps/pi-server/src/app.ts`、`apps/desktop/electron/pi-server-spawner.ts` |
| P0-SEC-002        | P0       | open        | Workspace 不是 agent 文件和命令执行的隔离边界                                                         | 2026-07-11    | M0-trustworthy-local-alpha | `apps/pi-server/src/agent/pi-coding-agent-client.ts`                                                                   |
| P0-SEC-003        | P0       | open        | Ask 审批的 shell 前缀判断可绕过，新文件默认直通                                                       | 2026-07-11    | M0-trustworthy-local-alpha | `apps/pi-server/src/agent/approval-policy.ts`                                                                          |
| P0-SEC-004        | P0       | resolved    | 缓存 AgentSession 按完整 runtime identity 重建，并以 reservation 防止 active handle 被 LRU 淘汰       | 2026-07-19    | M0-trustworthy-local-alpha | `apps/pi-server/src/agent/agent-session-registry.ts`、`apps/pi-server/src/agent/pi-coding-agent-client.ts`             |
| P0-SEC-005        | P0       | open        | HTTP 已阻止预先存在的越界 symlink ancestor；仍缺 race-free open 与 Agent tools 统一边界               | 2026-08-13    | M0-trustworthy-local-alpha | `apps/pi-server/src/files/path-sandbox.ts`、`apps/pi-server/test/files-write.test.ts`                                  |
| P0-SEC-006        | P0       | open        | Provider key 明文存储，Electron renderer sandbox 未开启                                               | 2026-07-11    | M0-trustworthy-local-alpha | `apps/pi-server/src/db/repositories.ts`、`apps/desktop/electron/main.ts`                                               |
| P0-RUN-001        | P0       | in-progress | 进程内同 session single-flight 已实现；已实现 进程实例归一；跨页面连续性与全局 single-flight 尚待完成 | 2026-09-16    | M0-trustworthy-local-alpha | `apps/pi-server/src/app.ts`、`apps/desktop/src/hooks/useStreamingChat.ts`                                              |
| P1-PROVIDER-001   | P1       | open        | GLM/小米预设映射不可用，自定义 base URL 和 Test 语义也未接通                                          | 2026-07-11    | M0-trustworthy-local-alpha | `apps/pi-server/src/agent/provider-id.ts`、`apps/pi-server/src/providers/provider-availability.ts`                     |
| P1-DOCUMENT-001   | P1       | open        | PDF、Office 等资料缺少可供 agent 使用的正文抽取                                                       | 2026-07-11    | post-M0                    | `apps/pi-server/src/files/document-reader.ts`                                                                          |
| P1-RECOVERY-001   | P1       | resolved    | ready 后退出反馈、受控重启、旧 Run 归一已实现                                                         | 2026-09-16    | M0-trustworthy-local-alpha | `apps/desktop/electron/pi-server-spawner.ts`                                                                           |
| P1-DATA-001       | P1       | open        | 删除 provider 会删除关联 run 历史                                                                     | 2026-07-11    | M0-trustworthy-local-alpha | `apps/pi-server/src/db/repositories.ts`                                                                                |
| P1-UX-001         | P1       | open        | 强制滚动、无动作 slash command、resume toggle 和禁用 MCP 入口仍暴露在 UI                              | 2026-07-11    | M0-trustworthy-local-alpha | `apps/desktop/src/chat/MessageStream.tsx`、`apps/desktop/src/chat/Composer/Composer.tsx`                               |
| P1-MESSAGE-001    | P1       | open        | 消息流计划的滚动暂停、文件变更事件、回合摘要和专项视觉场景未完成                                      | 2026-07-11    | post-M0                    | `docs/internal/plans/2026-07-10-message-stream.md`                                                                     |
| P1-QUALITY-001    | P1       | open        | 视觉比较默认软报告；捕获判稳、场景封闭性与全部 changed 裁决已于 2026-07-13 完成                       | 2026-07-13    | M0-trustworthy-local-alpha | `apps/desktop/scripts/compare-screenshots.mjs`、2026-07-11 视觉审计                                                    |
| P1-RELEASE-001    | P1       | open        | 签名、公证、自动更新、LICENSE 和发布 smoke test 尚未完成                                              | 2026-07-11    | public-release             | `apps/desktop/electron-builder.yml`、`.github/workflows/build-desktop.yml`                                             |
| P1-EXTENSIONS-001 | P1       | open        | Skills v1 产品路径已接通；MCP 与 Skill 安装/编辑生态仍未实现                                          | 2026-07-18    | post-M0                    | `apps/desktop/src/chat/SkillPreconditionBanner.tsx`、`apps/desktop/src/settings/SkillsPane.tsx`                        |
| P1-A11Y-001       | P1       | open        | 键盘、焦点、状态播报和长内容操作尚未完成系统审计                                                      | 2026-07-11    | M0-trustworthy-local-alpha | `apps/desktop/src`                                                                                                     |
| P1-DOCS-001       | P1       | in-progress | 门禁已实现，staged 深审阻断和 GitHub 强制配置仍待完成                                                 | 2026-07-12    | M0-trustworthy-local-alpha | `scripts/docs-check.mjs`、`.github/workflows/docs-gate.yml`                                                            |

<!-- issue-inventory:end -->

## 验证基线

在 `71fa529` 上完成的当前根级验证：

| Check                | Result                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `pnpm verify`        | 通过；docs 30、chat-core 38、pi-server 295、desktop 444，1 个真实 MiniMax live test 默认跳过                        |
| `pnpm verify:visual` | 通过；36 张 unchanged，3 张 Skills 截图仅因隔离 worktree 绝对路径变化而 changed；无新增、孤儿或错误，差异已逐张检查 |

本次快照没有验证签名安装包、客户机启动、自动更新或真实 provider 的完整对话链路。

### 历史 Task 9 candidate tree 验证

以下表格只记录 Task 9 candidate tree 当时的验证结果，不代表当前测试数量或视觉基线：

| Check                | Result                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------- |
| `pnpm test`          | 通过；docs 28、chat-core 14、pi-server 268、desktop 330，1 个真实 MiniMax live test 默认跳过 |
| `pnpm typecheck`     | 通过                                                                                         |
| `pnpm lint`          | 通过                                                                                         |
| `pnpm format:check`  | 通过                                                                                         |
| `pnpm build`         | 通过；renderer 和 PDF worker 仍有大 bundle 警告                                              |
| `pnpm verify:visual` | Task 9 未运行；只增加 backend/runtime/API 和正式文档，没有 UI-visible change                 |

### 早期治理变更的候选树验证

早期治理 closeout 以 `1199645` 为产品行为基线，并对当时的治理候选树运行过 `pnpm verify`：文档检查、格式、lint、类型检查、449 项测试和构建通过，1 项真实 MiniMax 测试跳过。该历史证据不代表 GitHub required check 已配置或已经过真实 PR 验证。

## M0 退出条件

- 本机 API 有进程级认证，CORS 只允许明确来源。
- Agent 文件和命令能力有可验证的 workspace 边界；symlink、绝对路径和 shell 语义均有回归测试。
- 权限切换不会复用不兼容的 AgentSession；Ask 和 Read-only 的产品文案与实际约束一致。
- 同一 session 只有一个受控 run，切换视图、停止、断连和 server 崩溃都有确定终态。
- Provider secret 不再以明文放在 SQLite，Electron renderer 启用 sandbox 并通过 packaged smoke test。
- 正式文档、API inventory、Superpowers closeout 和 PR 文档影响检查成为必过门禁。
- UI 变更的视觉差异已逐张裁决，并保留可复查的 Electron baseline 与报告。

公开发布还需要签名、公证、自动更新、LICENSE、跨平台安装测试和发布回滚方案；这些条件不并入 M0 的本地 Alpha 定义。

## Issue #6 候选工作树验证

2026-09-16，基于 `0105cbf` 的未提交工作树实现 App-managed Run 终态治理。页首历史快照不代表本次新验证。provider-free 测试覆盖正常/失败记录不变、幂等归一、活跃所有者保护与 PID 复用、退出/强杀/断连、pi history 与本地文件保留，以及下一输入使用原 Session 创建新 Run。真实 Electron 覆盖停止、服务强杀、键盘 Retry 与同 Session 新 Run。

不扩大到 #3–#5、跨页面运行或队列。Evidence Store 当前尚未实现，本切片没有新增或删除 Evidence Records；其领域持久化验证等待对应能力落地。无外部模型/真实凭据测试，无签名安装包或 Windows packaged smoke 结果。

`pnpm verify` 已在隔离 HOME/SQLite 下通过：docs 30、chat-core 38、pi-server 309、desktop 449，1 个真实模型测试默认跳过。`pnpm verify:visual` 捕获 41 张：初始 36 unchanged、3 changed（Skills 路径/少量悬停差异已逐张裁决）、2 new（恢复界面已检查并加入基线）、0 orphan、0 errors。真实 Electron 正常退出和主进程强杀均确认审批过期、server 退出及重启后终态不变。

本切片的历史执行结果见 [Issue #6 Implementation Outcome](../internal/plans/2026-09-16-run-lifecycle.md#implementation-outcome)。

### Issue #6 review 修复

复核发现旧强杀测试只停在审批阶段，未覆盖正在运行的 Bash；已添加真实 pi/HTTP 强杀复现并接入随父 IPC 断开而 abort 的 Bash 工作进程。修复先确认红灯后通过真实 Bash 强杀/重启、输出、停止、超时、Ask 和 Read-only 测试。macOS Electron utilityProcess 的编译 worker 正常输出及 SIGKILL 后文件保护均实测通过；这不等同于 Windows/Linux 或完整安装包验证。最终 `pnpm verify` 通过；视觉复跑 38 unchanged、3 changed、0 new/orphan/errors，逐张对比确认仅 Skills 路径及悬停差异，保留原基线。活动 Bash 治理不承诺任意已脱离的后台进程沙箱。
