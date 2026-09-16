# Issue #21 验证与视觉裁决（2026-09-16）

验收来源：[Issue #21](https://github.com/sufe-debt-lab/marginalia/issues/21) 与父规格 #2。实现位于独立工作树 `codex/issue-21-desktop-panels`，基于 `0105cbf`。实现已完成本地复验，进入 PR 评审；Issue 保持开放。

## 初次实现的行为与验证证据

- 先确认预期失败，再实现：关闭重开丢失文件、缺少全屏入口、旧宽度 280px、窄窗口挤压聊天区、窄窗口按下拖动手柄跳宽、读取失败后刷新无效。
- focused tests：AppShell、Topbar、DocumentPanel、ResizeHandle、store、截图场景合同共 76 项；另有 useDocumentContent 3 项。
- `pnpm verify`：文档 30、chat-core 38、pi-server 295、desktop 449 通过；1 个真实 MiniMax 测试默认跳过。格式、lint、全部包 typecheck 和构建通过。
- `pnpm docs:check -- --base 0105cbf`：静态及 diff-impact 通过。
- `pnpm verify:visual`：42 张截图，更新前 38 changed、3 new、1 unchanged、0 orphan、0 errors。每张都已查看和裁决；此处没有将原始比较写成全部一致。更新预期基线后再次完整执行，最终 42 unchanged、0 changed、0 new、0 orphan、0 errors。
- Electron 复用既有隔离 profile、临时 workspace/SQLite、真实 pi-server HTTP/SSE 和可控 Agent；未读取真实凭据或调用外部模型。
- 鼠标拖动左栏 180/480px 边界，文档从 420 到 520px；按钮与拖动进入应用内全屏，Escape 恢复 520px；Tab 循环与背景 inert、文件关闭重开保留、503 读取失败后刷新恢复、重载布局偏好均通过。
- 正常开合采集到宽度及透明度中间帧；reduced-motion 对开合均取消过渡。原生窗口按钮位置 API 为 (14,16)，46px 顶栏中心为 23px；原生 AX 包含关闭/全屏/最小化，应用内全屏不改变系统全屏状态。

## 初次实现的逐张视觉裁决

Standards 评审实际查看 core-ui 全部 18 张，Spec 评审查看 seeded-workspace 10 张和 skills-flow 7 张；主执行检查 approval-flow 4 张及 desktop-panels 3 张，并复查修正后的 Provider/Skills 焦点与窄窗口截图。

| 场景 / 图片                                   | 原始结果  | 裁决与理由                                                                                                     |
| --------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------- |
| core-ui / first-run                           | changed   | 接受并更新基线：275px 左栏、46px 顶栏及统一图标动作；布局完整，无意外裁剪。                                    |
| core-ui / new-thread-empty                    | changed   | 接受并更新基线：275px 左栏、46px 顶栏及统一图标动作；布局完整，无意外裁剪。                                    |
| core-ui / model-menu                          | changed   | 接受并更新基线：275px 左栏、46px 顶栏及统一图标动作；布局完整，无意外裁剪。                                    |
| core-ui / new-thread-typed                    | changed   | 接受并更新基线：275px 左栏、46px 顶栏及统一图标动作；布局完整，无意外裁剪。                                    |
| core-ui / settings-general                    | changed   | 接受并更新基线：275px 左栏、46px 顶栏及统一图标动作；布局完整，无意外裁剪。                                    |
| core-ui / settings-providers                  | changed   | 接受并更新基线：275px 左栏、46px 顶栏及统一图标动作；布局完整，无意外裁剪。                                    |
| core-ui / provider-preset-picker              | changed   | 接受并更新基线：275px 左栏、46px 顶栏及统一图标动作；布局完整，无意外裁剪。                                    |
| core-ui / provider-add-form                   | changed   | 接受并更新基线：275px 左栏、46px 顶栏及统一图标动作；布局完整，无意外裁剪。                                    |
| core-ui / provider-toast                      | changed   | 接受并更新基线：275px 左栏、46px 顶栏及统一图标动作；布局完整，无意外裁剪。                                    |
| core-ui / settings-providers-connected        | changed   | 接受并更新基线：275px 左栏、46px 顶栏及统一图标动作；布局完整，无意外裁剪。                                    |
| core-ui / provider-edit-dialog                | changed   | 接受并更新基线：旧绿色焦点光晕已修复并重拍；输入框为中性细边框，弹框动作完整。                                 |
| core-ui / settings-providers-disabled         | changed   | 接受并更新基线：275px 左栏、46px 顶栏及统一图标动作；布局完整，无意外裁剪。                                    |
| core-ui / provider-delete-confirm             | changed   | 接受并更新基线：275px 左栏、46px 顶栏及统一图标动作；布局完整，无意外裁剪。                                    |
| core-ui / settings-general-zh                 | changed   | 接受并更新基线：275px 左栏、46px 顶栏及统一图标动作；布局完整，无意外裁剪。                                    |
| core-ui / home-connected                      | changed   | 接受并更新基线：275px 左栏、46px 顶栏及统一图标动作；布局完整，无意外裁剪。                                    |
| core-ui / model-dropdown                      | changed   | 接受并更新基线：275px 左栏、46px 顶栏及统一图标动作；布局完整，无意外裁剪。                                    |
| core-ui / permission-menu                     | changed   | 接受并更新基线：275px 左栏、46px 顶栏及统一图标动作；布局完整，无意外裁剪。                                    |
| core-ui / sidebar-collapsed                   | changed   | 接受并更新基线：275px 左栏、46px 顶栏及统一图标动作；布局完整，无意外裁剪。                                    |
| seeded-workspace / recent-threads             | changed   | 接受并更新基线：侧栏宽度与顶栏调整；文件/聊天/附件流程布局完整。                                               |
| seeded-workspace / sidebar-session-timestamps | changed   | 接受并更新基线：侧栏宽度与顶栏调整；文件/聊天/附件流程布局完整。                                               |
| seeded-workspace / sidebar-show-more-expanded | changed   | 接受并更新基线：侧栏宽度与顶栏调整；文件/聊天/附件流程布局完整。                                               |
| seeded-workspace / chat-seeded-session        | changed   | 接受并更新基线：侧栏宽度与顶栏调整；文件/聊天/附件流程布局完整。                                               |
| seeded-workspace / save-dialog-input          | changed   | 接受并更新基线：侧栏宽度与顶栏调整；文件/聊天/附件流程布局完整。                                               |
| seeded-workspace / save-dialog-overwrite      | unchanged | 保留基线：侧栏宽度与顶栏调整；文件/聊天/附件流程布局完整。                                                     |
| seeded-workspace / attach-picker              | changed   | 接受并更新基线：侧栏宽度与顶栏调整；文件/聊天/附件流程布局完整。                                               |
| seeded-workspace / attachment-card            | changed   | 接受并更新基线：侧栏宽度与顶栏调整；文件/聊天/附件流程布局完整。                                               |
| seeded-workspace / mention-menu               | changed   | 接受并更新基线：侧栏宽度与顶栏调整；文件/聊天/附件流程布局完整。                                               |
| seeded-workspace / mention-inline-token       | changed   | 接受并更新基线：侧栏宽度与顶栏调整；文件/聊天/附件流程布局完整。                                               |
| approval-flow / approval-command-pending      | changed   | 接受并更新基线：聊天随左栏增宽重新排版；文档顶部增加全屏/关闭；审批正文和动作完整。                            |
| approval-flow / approval-command-approved     | changed   | 接受并更新基线：聊天随左栏增宽重新排版；文档顶部增加全屏/关闭；审批正文和动作完整。                            |
| approval-flow / approval-edit-pending         | changed   | 接受并更新基线：聊天随左栏增宽重新排版；文档顶部增加全屏/关闭；审批正文和动作完整。                            |
| approval-flow / approval-denied               | changed   | 接受并更新基线：聊天随左栏增宽重新排版；文档顶部增加全屏/关闭；审批正文和动作完整。                            |
| skills-flow / skills-settings                 | changed   | 接受并更新基线：旧搜索焦点光晕已修复并重拍；列表及详情清晰，worktree 路径正常换行。                            |
| skills-flow / skills-global-only              | changed   | 接受并更新基线：侧栏及焦点样式调整；Skills 本机路径因 worktree 改变，按原布局正常换行。                        |
| skills-flow / skill-diagnostics               | changed   | 接受并更新基线：侧栏及焦点样式调整；Skills 本机路径因 worktree 改变，按原布局正常换行。                        |
| skills-flow / skill-picker-dollar             | changed   | 接受并更新基线：菜单末项处于滚动视口，与旧基线一致；无新增裁剪。                                               |
| skills-flow / slash-skills                    | changed   | 接受并更新基线：菜单末项处于滚动视口，与旧基线一致；无新增裁剪。                                               |
| skills-flow / skill-chips                     | changed   | 接受并更新基线：侧栏及焦点样式调整；Skills 本机路径因 worktree 改变，按原布局正常换行。                        |
| skills-flow / skill-precondition-blocked      | changed   | 接受并更新基线：侧栏及焦点样式调整；Skills 本机路径因 worktree 改变，按原布局正常换行。                        |
| desktop-panels / panels-file                  | new       | 接受并更新基线：真实 README 预览与文件树可见，底部动作换行保持可达。                                           |
| desktop-panels / panels-fullscreen            | new       | 接受并更新基线：覆盖应用窗口且保留原生控件位置；还原按钮中性键盘焦点清晰，文件内容完整。                       |
| desktop-panels / panels-narrow                | new       | 接受并更新基线：初次基线：960px 窗口中文档缩到 405px。后续 review 发现压缩与拖动不一致，已由下节修复记录取代。 |

## 边界与剩余验证

当前生产没有真实摘要面板或启用的 Markdown 编辑器。本票只保留既有文件组件生命周期，未迁入原型模拟数据；摘要 260px 下限和未保存编辑保留需在对应能力接入后验证。未验证 Windows/Linux 原生控件、安装包、签名公证或真实模型；没有改变原有 Alpha NO-GO。

宽度和开合保存在既有 Zustand persist。文件标签只承诺当前 renderer、同一 workspace 的布局/视图切换保留；不承诺跨重启标签恢复。文档正文仍来自本地文件。

最后一遍验证按顺序运行 `pnpm verify` 与 `pnpm verify:visual`，避免构建热更新干扰 Electron。原始日志保存于 `output/issue-21/verify.log` 和 `output/issue-21/visual.log`。

## Review 修复与复验

本轮先确认失败再修复五项问题：文件列表重开不更新、空标签全屏焦点绕过 Shadow DOM、900px 拖动释放回弹至 725px、960px/480px 左栏下文档被压至 200px、内部树实际 189px 却从 240px 开始拖动。

- 文件列表重新可见时从原 files API 读取，刷新同时更新列表和当前正文；无标签也有刷新入口，列表失败可重试，当前文件与标签保留。
- 焦点边界遍历 open Shadow Root，保留原生 Tab 导航；Electron 确认正向进入树、树末尾回到还原按钮、反向进入树。
- 拖动和显示共用窗口上限，900px 释放后保持 900px；960px 窗口配 480px 左栏时文档动作仍在窗口内。文件树从实际宽度拖动，189px 向左 20px 后为 169px。
- 窄窗回归额外发现模型选择按钮越界，增加 Electron 失败断言后限制按钮宽度与截断标签，发送及模型选择入口保持可达。
- 7 个 focused 文件共 66 项通过；`pnpm verify` 全部通过（文档 30、chat-core 38、pi-server 295、desktop 452；真实 MiniMax 1 项跳过），所有包 typecheck、lint、格式和构建通过。测试使用临时 workspace/SQLite、既有 HTTP/SSE 与可控 Agent，未调用真实模型或凭据。

本轮 `pnpm verify:visual` 实际结果为 5 changed、37 unchanged、0 new/orphan/errors。主审逐张查看当前图片及 diff 后更新下面 5 张基线；随后用同批截图执行 `compare-screenshots --fail-on-diff`，42 unchanged。此为更新后重比，不冒充又一次重新采集。

| 图片                                     | 裁决                                                                                      |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| core-ui / model-menu                     | 接受：模型标签现在可截断，按钮和弹层锚点轻微移动；选项完整。                              |
| core-ui / model-dropdown                 | 接受：同上，模型和推理选项均可见。                                                        |
| skills-flow / skill-precondition-blocked | 接受：筛选旁增加刷新入口；重新进入后列表反映已禁用 Skill 的实际本地路径和文件数量。       |
| desktop-panels / panels-fullscreen       | 接受：场景实际拖动树后保留 189px 显示宽度，正文位置相应改变；还原、关闭和文档动作完整。   |
| desktop-panels / panels-narrow           | 接受：保持用户选择的 520px 文档宽度，聊天控制换行、模型标签截断；发送和文档动作在窗口内。 |

红绿日志、完整 gate 日志、更新前视觉报告与 Electron 行为结果保存在 `output/issue-21/review-fixes/`。正式文档同步用户指南、架构和产品状态；计划同步修复结果。只读复查没有发现本轮新增实质问题。上节未验证平台、未实现摘要与 Markdown 编辑的边界保持不变。

## PR 前最终复查

再次读取 GitHub Issue #21 全文、评论（无）和父规格 #2，原生 blocked_by 仍为空。规范与需求两路独立审查均未发现阻止 PR 的实质问题，主审核对结论与代码后再次运行完整门禁。PR 只包含该独立工作树的 Issue #21 改动，未纳入原目录的无关原型改动。

实现提交：`927b9da`。PR 前最终完整 `pnpm verify` 通过，测试计数仍为 desktop 452、pi-server 295（1 skipped）、chat-core 38、文档 30。相对 `origin/main` 的静态与 diff-impact 文档检查通过。
