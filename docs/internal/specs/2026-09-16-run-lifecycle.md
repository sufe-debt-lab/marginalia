---
type: spec
record_id: SPEC-RUN-LIFECYCLE-006
status: archived
archived_at: 2026-09-16
outcome: completed
implementation_refs:
  - same_change
same_change: true
created: 2026-09-16
updated: 2026-09-16
target_milestone: M0-trustworthy-local-alpha
owner: repository-maintainers
docs_impact:
  user:
    - docs/user/guide.md
    - docs/user/configuration.md
  developer:
    - docs/developer/api.md
    - docs/developer/architecture.md
    - docs/developer/development.md
    - docs/developer/build-and-release.md
  product_status: true
---

# App-managed Run 终态治理

本记录落实 [Issue #6](https://github.com/sufe-debt-lab/marginalia/issues/6)，以该票验收为准；父规格为 [Issue #2](https://github.com/sufe-debt-lab/marginalia/issues/2) 的运行与恢复合同。2026-09-16 核对：两票无评论，#6 原生 blocked-by 为空。集成基线为 `0105cbf`。主工作区未提交原型与文档不属于本变更。

- 遗留且无有效进程所有者的 running 记录归为 failed，诊断使用通用原因；正常终态不变，重复启动幂等。
- 保留 pi history、产品持久化记录与本地成果正文。不增加 Interrupted 类型，不自动恢复或重放工具；下一条消息进入同 Session 的新 Run，并重新执行现有权限与文件检查。
- stop、SSE disconnect、退出、强制终止和重启均有终态。Electron 退出后 server 不成为后台 daemon；ready 后 server 退出应可见并可重启。
- 不实现队列、跨视图运行、多会话并行、Evidence Store 或 #3–#5 的安全工作。

## Verification seams

沿用父规格和用户指定的 HTTP/SSE、SQLite 持久化、pi AgentClient、Electron/server 进程边界。使用可控 Agent、临时 workspace、隔离 HOME 和 SQLite；不调用外部模型或使用真实凭据。

## Deviations

Review 的真实 Bash 复现说明仅持久化终态不够；新增 pi BashOperations worker 承担活动 shell 的取消，复用原生工具语义，未新增聊天协议。

## Review follow-up: executing Bash lifetime

用户要求修复已证实的 P1：server SIGKILL 后真实 Bash 仍可写 workspace。此前只验证 fake pending approval 的强杀路径，不能证明工具进程结束。

- [x] 将复现提升到真实 HTTP Run、真实 pi Session/工具和可控模型流；临时 workspace/SQLite，先确认红灯。
- [x] 通过 pi BashOperations 接入独立工作进程，父 IPC 断开即 abort pi 的真实工具进程组；不增加聊天协议或通用调度层。
- [x] 覆盖正常 stdout/stderr/exit code、停止、超时、审批/只读，以及 server 强杀后重启不再覆盖文件。
- [x] focused tests、typecheck、完整 verify、相关正式文档与最终审查。

## Implementation Outcome

- **Outcome:** completed；实现与归档同属基于 `0105cbf` 的未提交变更，引用 `same_change`。未提交、推送、创建 PR 或关闭 Issue。
- **Run 治理：** 保存 PID 与 OS 启动时间，幂等归一失去所有者的 running，保持既有终态、pi history 与本地成果；pending approval 过期，下一消息沿用 Session 创建新 Run，不重放旧工具。
- **Electron：** 保留启动中 child 所有权、等待旧实例退出、忽略迟到回调；ready 后退出通过本地化说明和 Retry 恢复。停止、断连、正常退出与强杀场景均有终态测试。
- **Review 修复：** 原强杀测试未覆盖活动 shell。真实 HTTP/pi Bash 回归先确认旧实现延迟覆盖文件，再通过 pi 公共 BashOperations 接入单命令 worker；server IPC 断开时由仍存活的 worker abort 原生 shell 进程组。
- **保持契约：** 原始 pi 事件、ChatEntry、HTTP/SSE、审批扩展及 Read-only 不变；复用 pi 输出、超时、shellPath、commandPrefix 和环境。无新聊天协议、平行持久化状态或依赖包。
- **测试：** focused tests、相关包 typecheck 和 `pnpm verify` 通过：docs 30、chat-core 38、pi-server 309、desktop 449，1 个外部模型测试跳过。使用受控模型流、真实 pi 工具、临时 workspace/SQLite 和隔离 HOME；没有外部模型或真实凭据。补齐 capability 测试消费 SSE 后再关闭数据库的清理顺序。
- **视觉：** `pnpm verify:visual` 最新 41 张，38 unchanged、3 changed、0 new/orphan/errors；逐张对比 current/baseline/diff，Skills 的三张差异仅为 worktree 路径和悬停状态，接受且不更新既有基线。恢复界面两张为本次 Issue 原实现已检查的新基线，复跑均 0% 差异。
- **真实运行：** macOS Electron utilityProcess 使用编译后的 worker 正常返回输出；SIGKILL utilityProcess 后等待旧命令的延迟写入窗口，文件保持新版本。此前 Electron app.quit/主进程 SIGKILL 验证 server 退出、审批过期与重启终态不变。
- **审查：** Standards/Spec 独立复核本轮 Bash 修复，主审核实调用链与测试，未发现剩余实质问题。
- **正式文档：** 更新 `docs/user/guide.md`、`docs/user/configuration.md`、`docs/developer/api.md`、`docs/developer/architecture.md`、`docs/developer/development.md`、`docs/developer/build-and-release.md`、`docs/product/status.md` 和 `docs/developer/issues/2026-07-11-product-readiness-audit.md`。P0-RUN-001 的跨视图/全局占用仍待后续切片。
- **偏差与边界：** 基线无本票实施计划，故新建本切片记录。修复仅保证活动 Bash 的生命周期，不扩展为任意后台/脱离进程的沙箱；已经完成的文件写入不回滚。Evidence Store 尚未实现，未伪造其领域验收；#3–#5、队列和跨页面连续性不在本票范围。
- **未验证：** Windows/Linux、签名安装包及 packaged 安装路径未验证；macOS utilityProcess smoke 不等同于完整安装包 smoke。既有大 bundle 构建警告仍存在。
- **证据：** `output/issue-6-verification/bash-fix-verify.log`、`output/issue-6-verification/bash-fix-visual.log`、`output/issue-6-verification/bash-visual-decisions.md`、`output/issue-6-verification/bash-electron-smoke.txt`；可重复测试在 `apps/pi-server/test/run-process.test.ts`、`apps/pi-server/test/run-recovery.test.ts`、`apps/pi-server/test/supervised-bash.test.ts` 和 Electron 截图脚本。
