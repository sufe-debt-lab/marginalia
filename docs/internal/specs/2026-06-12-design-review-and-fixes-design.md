# 设计健康度审查与修复设计（2026-06-12）

> 状态：已与 shixy 逐节确认
> 作者：Claude（与 shixy 协作）
> 审查基准：`codex/ui-align-design` 工作区现状（含未提交改动）
> 去重基准：`2026-05-29-pi-cowork-ui-alignment-design.md`、`docs/developer/issues/2026-06-04-code-review-findings.md`（两者已覆盖的问题本文不重复）

## 背景与范围

对 desktop / pi-server / chat-core 三个包做了一次 UI 设计 + 代码架构双维度审查。
方法：Electron 截图（`pnpm verify:screenshots` 两个场景共 26 张）对照 `pi-cowork-design` JSX 原型 + 沿"渲染派生 → ChatEntry → SSE → pi-server → pi SDK"主链路静态读码。

交付物：本问题清单 + 下文按优先级分组的修复设计（6 个 PR）。

## 已确认决策

| 决策点                                       | 结论                                                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Slash 菜单（/clear /help /model）            | **移除**（YAGNI，等有真实命令再加；同步改 composer placeholder 文案）                                                     |
| 顶栏会话标题右侧 ⓘ 按钮                      | **暂时移除**（与设计稿差异回写 spec）                                                                                     |
| 默认语言                                     | **跟随系统**：首启探测 `navigator.language`，`zh*` → 中文，否则英文；用户切换后持久化（回写 05-29 spec 的"默认中文"决策） |
| 品牌名                                       | **显示层统一 Marginalia**（UI 文案改名，与 README/包名/`~/.marginalia` 一致）                                             |
| Providers 摘要条（默认模型/工作区/推理预算） | **回写 spec 砍掉**（诊断已由 Run diagnostics 覆盖，推理预算在 composer 模型菜单）                                         |
| RecentThreads 的 `N msgs` 元信息             | **回写 spec 砍掉**（需后端新增消息计数，收益小）                                                                          |

## 问题清单（18 项，均为新发现）

### A · "摆设"控件——UI 与实际行为不符（P0）

1. **"启动时打开上次会话"开关无效**：`GeneralPane` 渲染并持久化 `resumeLastSession`，但无任何消费方；`activeSessionId` 不在 `app-store.ts` persist 白名单，重启后无从恢复。
2. **Slash 命令是空壳**：`SlashMenu` 列出 `/clear` `/help` `/model`，`Composer.pickSlash` 丢弃选择（`void name`），唯一效果是删 token。
3. **顶栏 ⓘ 按钮无 onClick**：`Topbar.tsx` chat 视图的"会话信息"按钮纯装饰。
4. Export/Import 按钮 disabled + "未实现" tooltip（诚实占位，P2 观察项）。

### B · 后端数据设计缺陷（P0–P1）

5. **时间戳漂移**：`repositories.ts` 的 `let clock = Date.now(); const now = () => ++clock;` 是"进程启动时刻 + 调用次数"计数器。pi-server 长时间运行后，新纪录的 `created_at/updated_at` 滞后真实时间达整个 uptime，侧栏/RecentThreads 相对时间显示错误。
6. **quick-chat 死链**：`PATCH /workspaces/:id/open` 无前端调用方 → `lastOpenedAt` 恒 null → `getRecentWorkspace()` 恒 null → `POST /quick-chat` 恒 409。`ApiClient.createQuickChat`、`ApiClient.createMessage` 零调用。`ApiClient.getBranch` 请求的 `/workspaces/:id/branch` 路由服务端不存在，恒返回 null。
7. **类型断言当校验**：pi-server 全部路由 `c.req.json<T>()` 直接断言请求体，无 schema 校验；缺字段以晦涩 SQLite 错误冒出。
8. **Provider 名称无唯一性约束**：同名 provider 产生重复 `*_API_KEY` env 行；`piProviderId` 相同时运行时 key 互相覆盖（仅预设 UI 防重，手动添加不设防）。

### C · 前端架构问题（P0–P1）

9. **历史消息模型标签错误**：`ChatView` 把当前 composer 模型经 `MessageStream` 传给所有 assistant 气泡；`message.model` 本有每条消息真值，切换模型后历史被整体错标。
10. **重试残留脏数据**：`ChatView.retry()` 只移除最后一个 user 和最后一个 assistant 气泡；多 assistant 气泡（`message_start` 分裂）或 toolResult 的失败 run，重试后早期气泡与孤儿 toolResult 残留，重发后重复。
11. **Mention 搜索竞态**：`Composer.handleChange` 的 `searchFiles` 无序列号/取消，快速输入时旧响应可能覆盖新结果。
12. **chat-core 死 API**：`assistantText` / `isAssistantToolCall` / `findToolResult` / `collectToolResults` 零消费；`MessageStream` 又内联重写了 `collectToolResults` 逻辑。

### D · i18n / 文案 / 品牌（P1）

13. **硬编码英文 toast**：`NewThreadView.tsx`（`` `Failed: ...` ``）、`WorkspaceTree.tsx`（`` `Failed to delete: ...` ``）、`ProvidersPane.tsx`（`"OK"` fallback）——违反项目 i18n 强制规则。
14. **默认 locale 与锁定决策相反**：spec 决策"默认中文"，实现默认 `"en"` 且无系统语言探测。
15. **品牌名分裂**：UI 文案 "pi-cowork" vs README/包名/`~/.marginalia`/`window.marginalia` 的 "Marginalia"。
16. **"Applies after reload" 文案不实**：语言切换即时生效。

### E · spec 漂移与工程卫生（P2）

17. **05-29 spec 漂移**：仍标"草案"但 PR A–G 大多已落地；摘要条决策未实现也未回写；RecentThreads 缺 `N msgs`。
18. **工作树风险**：50+ 文件多关注点混合未提交；被 `SlashMenu`/`MentionMenu` 引用的 `useMenuNav.ts` 在审查快照时是未跟踪状态（漏提交会破坏构建；后续已 staged，提交时复核即可）。

## 修复设计（6 个 PR）

每个 PR 独立可合，遵守 commit gate（TDD → 包内 typecheck/test → repo lint/format → UI 改动走 Electron 截图）。

### PR-1 `fix(desktop)`: 让 UI 不再撒谎（P0）

- `activeSessionId` 加入 persist 白名单；`AppShell` 挂载时若 `resumeLastSession` 且 persisted session 经 `listSessions` 校验仍存在 → `setView("chat")`，否则落 New chat。
- 删除 `SlashMenu.tsx` 及 Composer 的 slash 分支、`composer.slash*` i18n key；placeholder 改为只提示 `@` 文件。
- 删除 Topbar ⓘ 按钮及 `common.sessionInfo` key。
- 测试：续传开/关/已删除 session 三态；composer 输入 `/` 不再弹菜单；Topbar 无 info 按钮。
- 截图：General 设置页 + 重启续传后的 chat 视图 + composer。

### PR-2 `fix(pi-server)`: 时间戳与数据卫生（P0）

- `now()` 改为 `clock = max(Date.now(), clock + 1)`；回归测试覆盖墙钟前进与同毫秒多次调用。
- Provider create/update 名称大小写不敏感唯一，冲突 409；desktop toast 透出该错误。
- 手写最小 body guard（不引入新依赖）：POST/PATCH 路由校验必填字段类型，缺失返回 400 + 字段名。

### PR-3 `fix(desktop)`: chat 渲染与交互正确性（P0）

- `MessageItem` 模型标签改读 `entry.message.model`，移除 `model` prop 透传链。
- `ChatView` 以 `runEntryIdsRef` 收集一次 run 的全部 entry id（user/assistant/toolResult），`retry()` 整组移除。
- `Composer.handleChange` 搜索加序列号，仅接受最新响应。
- 测试：历史多模型消息标签各自正确；多气泡 + 工具失败 run 重试无残留；乱序响应不覆盖。

### PR-4 `chore`: 死代码链清理（P1）

- 删 `ApiClient.createQuickChat` / `createMessage` / `getBranch`。
- 删 pi-server `/quick-chat`、`POST /sessions/:sessionId/messages`、`PATCH /workspaces/:id/open` 与 `markWorkspaceOpened` / `getRecentWorkspace`；**保留** legacy `messages` 表读路径（老会话兼容）。
- chat-core 删除 4 个零消费导出。
- 文档同步：`docs/developer/api.md` 移除对应端点。

### PR-5 `fix(desktop)`: i18n / 品牌 / 文案（P1）

- 三处硬编码文案改 `t()`，en/zh 双补。
- 首启语言探测：仅对全新安装生效（persist 存储不存在时按 `navigator.language` 取 zh/en）。已有持久化值（包括历史默认写入的 `"en"`）一律不动——无法区分"默认值"与"用户主动选择"，宁可保守。
- UI 品牌文案 pi-cowork → Marginalia（`firstRun.*`、`documents.openOutside` 等 6 处 key）。
- `settings.languageDesc` 改为"即时生效"。
- 截图：中英文 FirstRun + General。

### PR-6 `docs`: spec 回写与 findings 落档（P2）

- 05-29 spec：标注 PR A–G 状态；回写摘要条/`N msgs`/Info 按钮/默认语言四项决策变更。
- 本文档随 PR-6 进入仓库；问题清单同步摘要至 `docs/developer/issues/2026-06-12-design-review-findings.md`。
- 流程提醒（不属于 PR）：当前工作树按关注点拆分提交（审查时 `useMenuNav.ts` 一度未跟踪，确认提交时已带上）。

## 数据流与状态

- 续传只新增 persist 字段 `activeSessionId`；不引入新 store 字段。
- 时间戳修复纯服务端，不改 API 形状。
- 死代码清理只删无消费者路径，不动 `ChatEntry` / pi 事件转发约定。

## 失败 / 边缘场景

| 场景                          | 行为                                          |
| ----------------------------- | --------------------------------------------- |
| 续传开启但 session 已删除     | 落 New chat，清掉 persisted `activeSessionId` |
| 续传开启但 workspace 已删除   | 同上                                          |
| provider 名称冲突             | 409 + toast 明确报"名称已存在"                |
| 请求体缺字段                  | 400 + 缺失字段名，不再冒 SQLite 错误          |
| 系统语言非 zh/en              | 落 en                                         |
| 老会话仍走 legacy messages 表 | 读路径保留，渲染不变                          |

## 测试策略

- 每个 PR TDD 闭环：先写失败测试再实现。
- PR-2 用假时钟（`vi.useFakeTimers` 等价的注入式 clock）测单调性与墙钟跟随。
- UI PR（1/3/5）跑 `pnpm verify:screenshots`，必要时扩展 `verify-screenshots.mjs` 场景（如续传状态）。

## 非目标

- 不实现 slash 命令、会话信息面板、Providers 摘要条、消息计数（均已决策砍掉/回写）。
- 不实现 Export/Import（问题 4 维持诚实占位，待有真实需求再排期）。
- 不动 06-04 findings 已列的安全项（loopback 鉴权、明文密钥等）——另行排期。
- 不做包名/数据目录改名（品牌只统一显示层）。

## Open questions

- 无（6 项决策已全部确认，见"已确认决策"；其中 4 项由 shixy 拍板，2 项为回写建议已获认可）。
