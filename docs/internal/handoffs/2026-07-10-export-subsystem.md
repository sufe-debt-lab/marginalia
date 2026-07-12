# Handoff：产物导出子系统（已实现，保留在分支，独立跟进）

日期：2026-07-11 · 状态：**已实现并提交**（不剥离，按用户决定保留在 `feat/message-stream` 历史中）· 后续作为独立功能域跟进

## 这是什么、为什么单独交接

P1-B 计划的 Task 9–11 实现了"助手产物拿得走"：复制全文、导出 .md（系统保存框）、存入 workspace（带覆盖确认）。复盘时确认：这是一套跨 **desktop renderer / Electron main / pi-server** 三层的独立子系统（新增了一个 IPC channel 和一个 HTTP 写端点），不属于"消息流渲染"的核心范围。用户决定：**代码保留，不动 commit**，但功能域独立出来，由本文档交接。

## 目标（来源：spec 第 2 节第 4 条）

每条助手消息悬浮操作——复制全文（Markdown）、导出为 .md 文件、存入 workspace（弹文件名；用户主动写入**不走 agent 审批流**，仅当目标已存在时弹覆盖确认）；代码块单独复制另由 CodeBlock 负责（核心范围内，不在本子系统）。

## 已做什么（全部已提交，均经测试）

| 提交      | 内容                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `de018bc` | `MessageActions` 组件（复制/导出/存入三按钮，hover 显示）、`src/lib/save-file.ts` renderer 封装（无 bridge 时返回 `{saved:false}`）、Electron `ipcMain.handle("marginalia:save-text-file")`（`main.ts:131`，复用模块级 `windowRef` + `dialog.showSaveDialog` + `writeFile`）、`preload.cts` 桥接、i18n `message.*` 三键、`save-file-ipc.test.ts` 源码断言、`docs/developer/architecture.md` IPC 表更新 |
| `adacac2` | pi-server `PUT /workspaces/:id/files/content`（`app.ts:179`：404 未知 workspace / 403 路径越界 / 409 已存在且未 overwrite / 200 覆盖 / 201 新建，`mkdir -p` 父目录）、`ApiClient.writeWorkspaceFile`（`client.ts:170`，409 以 `Error("file exists")` 抛出）、两侧测试                                                                                                                                  |
| `1199645` | `SaveToWorkspaceDialog`（状态机 input → confirm-overwrite → saving；**`pendingName` 冻结触发 409 的文件名**，覆盖确认只对冻结名执行，不重读输入框，含专门测试）、ChatView 接线、i18n `saveDialog.*`                                                                                                                                                                                                    |

测试覆盖：`MessageActions.test.tsx`(3)、`save-file.test.ts`(2)、`save-file-ipc.test.ts`(2)、`files-write.test.ts`(3, pi-server)、`client.files-write.test.ts`(3)、`SaveToWorkspaceDialog.test.tsx`(3, 含冻结名用例)。

## 与核心的耦合点（保留状态下的边界地图）

导出代码"伸进"三个核心文件的确切位置（行号以 `1199645` 为准）——将来无论是继续演进还是拆 PR，都以这份地图为界：

- `MessageItem.tsx`：`import MessageActions`（:9）；标题 slug 辅助（:14 附近，供默认文件名）；`onSaveMessage` prop（:35/:44）；`markdown` 聚合 memo（:70–72）；`hasMarkdown` 守卫（:92）；`<MessageActions …>` 挂载（:102–106）。
- `MessageStream.tsx`：`onSaveMessage` prop 声明与透传（:20/:32/:99）——纯管道，无逻辑。
- `ChatView.tsx`：`import SaveToWorkspaceDialog`（:13）；`saveTarget` state（:47）；`handleSaveMessage`（:149）；`handleSave`（:161–171，含 `activeWorkspaceId` 守卫、`writeWorkspaceFile` 调用、`"file exists"`→`"exists"` 映射）；`onSaveMessage={activeWorkspaceId ? … : undefined}`（:229，无 workspace 时按钮自然不渲染）；`<SaveToWorkspaceDialog …>`（:255–257）。

核心（消息渲染）对本子系统**无反向依赖**：删掉以上各点后核心可独立编译运行。

## 已知缺陷 / 待跟进

1. **失败静默**：`MessageActions.tsx:32` 复制（`clipboard.writeText`）与 `:42` 导出（`saveTextFile`）都是 `void` 调用、无 catch、无结果反馈——失败或取消时用户无感知。建议：接 toast（仓库已有 sonner），成功/失败均提示。
2. **对话框焦点**：Radix 打开时自动聚焦 Cancel 按钮，压过了文件名输入框的 `autoFocus`（cosmetic，Task 11 实现者已披露）。
3. **真机验证不完整**：`SaveToWorkspaceDialog` 的 409→覆盖链路在 Task 11 实现时跑过一次真实 Electron + 真 pi-server 验证；但**复制、导出 .md（系统保存框）两条路径没有任何真机验证**（jsdom 里 clipboard/dialog 全是 mock）。建议：并入下一轮 ask-flow 式驱动脚本验证。
4. **截图基线**：本子系统的 UI 状态（hover 操作条、保存对话框、覆盖确认态）尚无 screenshot fixture；另有 5 张 pre-existing 截图 diff（约 0.26% 字体渲染噪声）在 Task 11 验证时被发现、按政策未 bless——都留给统一的视觉门收口（原 Task 15，需按范围收敛调整）。
5. `PUT files/content` 端点无体积上限、无并发写保护（本机单用户场景风险低，记录备查）。

## 后续怎么做

- 短期（收口即可发布自用）：修缺陷 1（toast）+ 缺陷 2（focus）；补三条路径的真机驱动验证；补截图 fixture 并 bless。
- 若将来拆 PR：按"耦合点地图"从三个核心文件摘出接线行，其余文件整体移动即可；`PUT files/content` 端点同时是「变更摘要」功能潜在消费者之外唯一的写路径，拆分时归导出侧。
- 文档：`docs/user/guide.md` 尚未写"消息操作"小节（原计划归 Task 15）——收口时补。
