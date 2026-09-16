# 产品状态

```text
Stage: Alpha
Release decision: NO-GO
Snapshot date: 2026-09-16
Verified commit: 0105cbf
Next milestone: M0 - Trustworthy Local Alpha
```

这是一份经过验证的快照，不是逐提交更新的开发日志。commit 字段为本轮 Issue #3 未提交工作树的基点；
以下结果针对该基点加本次改动，不宣称这些改动已经提交或合并。源码和测试提供行为证据；问题的复现、
影响和验收条件见[产品就绪审计](../developer/issues/2026-07-11-product-readiness-audit.md)。

## 能力快照

状态只使用 `implemented`、`partial`、`disabled` 和 `planned`。`implemented` 表示主路径已有验证，不表示已经满足发布条件。

<!-- capability-inventory:start -->

| ID                | Capability                    | Status      | Verified result                                                                                                                                              | Current boundary                                                                          | Release gate                | Evidence                                                                                                                                | Target                     |
| ----------------- | ----------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| CAP-DESKTOP-001   | Electron shell 与本地 server  | implemented | Electron 启动随机端口 pi-server，main-owned transport 为全部敏感 route 注入 bearer/Origin，renderer sandbox 已开启                                           | ready 后 server 退出仍不自动反映到 UI                                                     | P1-RECOVERY-001             | `apps/desktop/electron/main.ts`、`apps/desktop/electron/loopback-proxy.ts`、`apps/desktop/electron/pi-server-spawner.ts`                | M0-trustworthy-local-alpha |
| CAP-WORKSPACE-001 | Workspace、session 与文件浏览 | partial     | HTTP、附件与 pi 文件工具共享 WorkspaceFiles；原生 no-replace/replace、版本冲突和跨平台路径规范化已接通                                                       | 非 OS 沙箱；macOS/Windows 同权限目录移动仍有平台限制                                      | P0-SEC-002、P0-SEC-005      | `apps/pi-server/src/files/workspace-files.ts`、`apps/pi-server/test/workspace-access-flow.test.ts`                                      | M0-trustworthy-local-alpha |
| CAP-PROVIDER-001  | Provider 与 model             | partial     | Provider CRUD、启停、默认模型和运行时 key 注册已接通                                                                                                         | GLM/小米预设映射当前不可用；`baseUrl` 没有进入模型请求；Test 不联网验证 key；key 明文保存 | P0-SEC-006、P1-PROVIDER-001 | `apps/pi-server/src/app.ts`、`apps/pi-server/src/agent/provider-id.ts`、`apps/pi-server/src/providers/provider-availability.ts`         | M0-trustworthy-local-alpha |
| CAP-CHAT-001      | Streaming chat 与长文渲染     | partial     | SSE 流、原始 pi 事件渲染、scoped turn draft、`run_started` 接受边界、thinking、工具卡、代码块、长文目录已实现                                                | 草稿只在 renderer 内存；滚动始终跟到底部；文件变更摘要和当前消息流计划的收口任务未完成    | P1-UX-001、P1-QUALITY-001   | `apps/pi-server/src/app.ts`、`apps/desktop/src/hooks/useStreamingChat.ts`、`apps/desktop/src/chat/MessageStream.tsx`                    | M0-trustworthy-local-alpha |
| CAP-TOOLS-001     | Agent tools 与审批            | partial     | Standard Access 的 read/create 自动允许，其余 effect 审批；pi 精确 edit 预览、版本核对、拒绝/中止及审批持久化                                                | Full 和已批准的 bash 使用宿主权限；没有独立 send/export/delete 工具                       | P0-SEC-003                  | `apps/pi-server/src/agent/approval-policy.ts`、`apps/pi-server/src/agent/agent-session-registry.ts`                                     | M0-trustworthy-local-alpha |
| CAP-DOCUMENT-001  | 文档浏览与资料上下文          | partial     | 文本文件可预览、搜索并通过 `@文件` 或附件加入请求；PDF 和图片可在文档面板预览                                                                                | PDF、Office、音视频不抽取正文；Office 没有内置预览                                        | P1-DOCUMENT-001             | `apps/pi-server/src/files/document-reader.ts`、`apps/desktop/src/documents/DocumentViewer.tsx`                                          | post-M0                    |
| CAP-EXPORT-001    | 复制、导出与保存到 workspace  | implemented | 用户确认后经统一文件边界保存；并发新建冲突，临时写入失败不截断原文件                                                                                         | 用户发起的外部导出仍经系统对话框；不是 Agent export 工具                                  | P0-SEC-005                  | `apps/desktop/src/chat/MessageActions.tsx`、`apps/desktop/src/chat/SaveToWorkspaceDialog.tsx`                                           | M0-trustworthy-local-alpha |
| CAP-RUN-001       | Run 生命周期与恢复            | partial     | Run 经统一 Loopback Access 边界；状态写入 SQLite；同进程同 session single-flight 已实现，断连时挂起审批会过期                                                | 跨进程所有权、崩溃恢复和视图卸载后的主动终止仍未实现                                      | P0-RUN-001、P1-RECOVERY-001 | `apps/pi-server/src/security/loopback-access.ts`、`apps/pi-server/src/app.ts`、`apps/desktop/src/hooks/useStreamingChat.ts`             | M0-trustworthy-local-alpha |
| CAP-SKILLS-001    | Skills                        | partial     | 六级 discovery、byte-pinned immutable Catalog、受保护管理 API、revision/root-pinned runtime、可访问键盘 picker、blocked-turn 修复及 Settings 启停/预览已实现 | Skills v1 不创建、导入、安装、编辑、卸载或删除 Skill；MCP 仍不可用                        | P1-EXTENSIONS-001           | `apps/pi-server/src/skills/catalog.ts`、`apps/desktop/src/chat/SkillPreconditionBanner.tsx`、`apps/desktop/src/settings/SkillsPane.tsx` | post-M0                    |
| CAP-MCP-001       | MCP                           | disabled    | 设置页保留不可用入口                                                                                                                                         | 没有 server 配置、连接、工具发现或运行时注入                                              | P1-EXTENSIONS-001           | `apps/desktop/src/settings/SettingsView.tsx`                                                                                            | post-M0                    |
| CAP-RELEASE-001   | 打包与发布                    | partial     | electron-builder 已配置 macOS、Windows、Linux target；tag/manual workflow 配置为构建 macOS 和 Windows 产物                                                   | 安装包未签名，macOS 未公证，无自动更新；Linux 不在 CI                                     | P1-RELEASE-001              | `apps/desktop/electron-builder.yml`、`.github/workflows/build-desktop.yml`                                                              | public-release             |
| CAP-DOCS-001      | 文档与质量门禁                | partial     | 治理候选树已实现统一 `docs:check`、API inventory、Superpowers closeout、PR CI 和可信文档 gate                                                                | staged 深审仍有路由提取、影响映射和可信状态时效问题；GitHub 强制配置也尚未完成            | P1-DOCS-001                 | `scripts/docs-check.test.mjs`、`.github/workflows/ci.yml`、`.github/workflows/docs-gate.yml`                                            | M0-trustworthy-local-alpha |

<!-- capability-inventory:end -->

## 发布阻断摘要

问题状态只使用 `open`、`in-progress`、`blocked` 和 `resolved`。本表只保留 P0/P1 摘要，详细证据写在 readiness issue 中。

<!-- issue-inventory:start -->

| ID                | Priority | Status      | Summary                                                                                         | Last verified | Target                     | Evidence                                                                                                                 |
| ----------------- | -------- | ----------- | ----------------------------------------------------------------------------------------------- | ------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| P0-SEC-001        | P0       | resolved    | 除 health 外全部 route 统一要求 bearer/exact Origin，renderer 经 main-owned transport 访问      | 2026-09-16    | M0-trustworthy-local-alpha | `apps/pi-server/src/security/loopback-access.ts`、`apps/pi-server/src/app.ts`、`apps/desktop/electron/loopback-proxy.ts` |
| P0-SEC-002        | P0       | in-progress | 已统一文件工具/HTTP 原生操作边界；OS 隔离与跨平台实机保证未关闭                                 | 2026-09-16    | M0-trustworthy-local-alpha | `apps/pi-server/src/agent/pi-coding-agent-client.ts`                                                                     |
| P0-SEC-003        | P0       | resolved    | 已替换 shell 前缀推断；标准访问按结构化 effect 逐次审批                                         | 2026-09-16    | M0-trustworthy-local-alpha | `apps/pi-server/src/agent/approval-policy.ts`                                                                            |
| P0-SEC-004        | P0       | resolved    | 缓存 AgentSession 按完整 runtime identity 重建，并以 reservation 防止 active handle 被 LRU 淘汰 | 2026-07-19    | M0-trustworthy-local-alpha | `apps/pi-server/src/agent/agent-session-registry.ts`、`apps/pi-server/src/agent/pi-coding-agent-client.ts`               |
| P0-SEC-005        | P0       | in-progress | 已统一文件工具/HTTP 原生操作边界；OS 隔离与跨平台实机保证未关闭                                 | 2026-09-16    | M0-trustworthy-local-alpha | `apps/pi-server/src/files/path-sandbox.ts`、`apps/pi-server/test/files-write.test.ts`                                    |
| P0-SEC-006        | P0       | open        | Electron renderer sandbox 已开启；Provider key 仍明文存储                                       | 2026-09-16    | M0-trustworthy-local-alpha | `apps/pi-server/src/db/repositories.ts`、`apps/desktop/electron/main.ts`                                                 |
| P0-RUN-001        | P0       | open        | 进程内同 session single-flight 已实现；仍缺跨进程稳定所有权、崩溃与恢复语义                     | 2026-07-18    | M0-trustworthy-local-alpha | `apps/pi-server/src/app.ts`、`apps/desktop/src/hooks/useStreamingChat.ts`                                                |
| P1-PROVIDER-001   | P1       | open        | GLM/小米预设映射不可用，自定义 base URL 和 Test 语义也未接通                                    | 2026-07-11    | M0-trustworthy-local-alpha | `apps/pi-server/src/agent/provider-id.ts`、`apps/pi-server/src/providers/provider-availability.ts`                       |
| P1-DOCUMENT-001   | P1       | open        | PDF、Office 等资料缺少可供 agent 使用的正文抽取                                                 | 2026-07-11    | post-M0                    | `apps/pi-server/src/files/document-reader.ts`                                                                            |
| P1-RECOVERY-001   | P1       | open        | pi-server ready 后崩溃和旧 run 没有完整恢复流程                                                 | 2026-07-11    | M0-trustworthy-local-alpha | `apps/desktop/electron/pi-server-spawner.ts`                                                                             |
| P1-DATA-001       | P1       | open        | 删除 provider 会删除关联 run 历史                                                               | 2026-07-11    | M0-trustworthy-local-alpha | `apps/pi-server/src/db/repositories.ts`                                                                                  |
| P1-UX-001         | P1       | open        | 强制滚动、无动作 slash command、resume toggle 和禁用 MCP 入口仍暴露在 UI                        | 2026-07-11    | M0-trustworthy-local-alpha | `apps/desktop/src/chat/MessageStream.tsx`、`apps/desktop/src/chat/Composer/Composer.tsx`                                 |
| P1-MESSAGE-001    | P1       | open        | 消息流计划的滚动暂停、文件变更事件、回合摘要和专项视觉场景未完成                                | 2026-07-11    | post-M0                    | `docs/internal/plans/2026-07-10-message-stream.md`                                                                       |
| P1-QUALITY-001    | P1       | open        | 视觉比较默认软报告；捕获判稳、场景封闭性与全部 changed 裁决已于 2026-07-13 完成                 | 2026-07-13    | M0-trustworthy-local-alpha | `apps/desktop/scripts/compare-screenshots.mjs`、2026-07-11 视觉审计                                                      |
| P1-RELEASE-001    | P1       | open        | packaged smoke 已覆盖启动/健康/本机访问边界；签名、公证、自动更新、LICENSE 和安装/卸载仍未完成  | 2026-09-16    | public-release             | `apps/desktop/electron-builder.yml`、`apps/desktop/scripts/smoke-packaged.mjs`、`.github/workflows/build-desktop.yml`    |
| P1-EXTENSIONS-001 | P1       | open        | Skills v1 产品路径已接通；MCP 与 Skill 安装/编辑生态仍未实现                                    | 2026-07-18    | post-M0                    | `apps/desktop/src/chat/SkillPreconditionBanner.tsx`、`apps/desktop/src/settings/SkillsPane.tsx`                          |
| P1-A11Y-001       | P1       | open        | 键盘、焦点、状态播报和长内容操作尚未完成系统审计                                                | 2026-07-11    | M0-trustworthy-local-alpha | `apps/desktop/src`                                                                                                       |
| P1-DOCS-001       | P1       | in-progress | 门禁已实现，staged 深审阻断和 GitHub 强制配置仍待完成                                           | 2026-07-12    | M0-trustworthy-local-alpha | `scripts/docs-check.mjs`、`.github/workflows/docs-gate.yml`                                                              |

<!-- issue-inventory:end -->

## 验证基线

在 `0105cbf` 加 Issue #3 未提交改动的工作树上完成的当前根级验证：

| Check                | Result                                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `pnpm verify`        | 通过；docs 30、chat-core 38、pi-server 334、desktop 470，1 个真实 MiniMax live test 默认跳过                            |
| `pnpm verify:visual` | 通过；35 张 unchanged，4 张 changed 已逐张裁决（3 张路径/悬停；1 张隐藏端口及字体差异）；无新增、孤儿或错误，未更新基线 |

macOS arm64 packaged smoke 通过：公开 health 200、认证访问 200、无 bearer 401、sandbox、文本流/图片、跨窗口拒绝和重启持久化。
本次没有验证 Windows/Linux 打包、签名安装、干净客户机、自动更新或真实 provider 的完整对话链路。

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

## Issue #21 面板切片（2026-09-16，候选工作树已验证）

候选工作树已实现 46px 顶栏、默认 275px 左栏、文档面板拖动和应用内全屏/还原、同项目布局切换保留文件标签及预览、键盘焦点与既有布局偏好持久化。focused tests 76 项及 useDocumentContent 3 项、全部包 typecheck、`pnpm verify` 和真实 Electron 面板交互通过。完整视觉比较为 38 changed、3 new、1 unchanged，全部逐张裁决并按预期变更更新基线，最终完整复验 42 unchanged、0 changed/new/error；详见[验证与视觉裁决](../developer/issues/2026-09-16-desktop-panels-verification.md)。

此切片不改变上方历史验证快照或 Alpha NO-GO；未实现真实右侧摘要、Markdown 手工编辑或跨重启标签恢复，不以原型模拟能力作为已交付证据。

后续 review 的五项问题已修复：列表重开刷新与失败重试、Shadow DOM 焦点、释放宽度一致、窄窗文档动作和内部树拖动。复验 66 项 focused、desktop 全量 452 项及完整 `pnpm verify` 通过；本轮视觉 5 changed、37 unchanged 经逐张裁决更新基线，同批截图重比 42 unchanged。详细红绿与 Electron 证据见上方验证记录。

## Issue #5 当前候选树

本节对应最初基于 `0105cbf`、已 rebase 到 `950f732` 的 Issue #5 分支，不覆盖上面的历史验证 commit。
六项 review 问题已实现修复：统一工具边界、结构化 effect、并发 no-clobber/原子发布、过期审批保护、
Windows 路径分隔符及大小写别名。HTTP/SSE 使用可控 Agent 执行生产 tools，真实临时文件与 SQLite
重开验证批准/拒绝/冲突后的 toolCallId 和历史；Electron workspace-access 场景核对实际文件字节。

完整 gate 与视觉裁决结果在本次实施计划中记录；真实模型、Windows/Linux 实机、签名打包及任意恶意
同权限进程隔离不因 macOS 的本地验证被视为通过。P0-SEC-002/005 保持 in-progress，发布 NO-GO 不变。
