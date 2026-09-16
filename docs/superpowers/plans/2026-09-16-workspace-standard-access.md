---
type: plan
record_id: PLAN-WORKSPACE-ACCESS-005
status: active
created: 2026-09-16
updated: 2026-09-16
target_milestone: M0-trustworthy-local-alpha
owner: repository-maintainers
source_spec_id: SPEC-WORKSPACE-ACCESS-005
docs_impact:
  user:
    - docs/user/guide.md
    - docs/user/configuration.md
  developer:
    - docs/developer/architecture.md
    - docs/developer/api.md
  product_status: true
---

# Issue #5 实施计划

## 基线与边界

从当前 main 创建 codex/issue-5-standard-access worktree；原工作区的未提交原型和规格保留。
复用现有文件接口、审批 gateway、SQLite 记录及 pi 工具合同。已有 Skills 计划不重跑。
用户已确认测试 seam：Electron 完整交互、HTTP/SSE、临时 workspace 与 SQLite，组件测试补充交互细节。

## 进度

- [x] 核对 Issue、父规格、原生阻塞和现有实现；基线 0105cbf。
- [x] RED/GREEN：HTTP 绝对路径/内部 symlink、Windows 分隔符与大小写回归、同名并发新建。
- [x] 生产 pi customTools 接入 WorkspaceFiles；结构化 effect 替代 shell-string 判定。
- [x] pi edit 计算真实拟写入内容，预览与提交共用 snapshot，拒绝/中止/过期保留原文件。
- [x] 原生 staging、no-replace/replace；I/O 部分失败与 parent swap 测试。
- [x] 可控 Agent 通过 HTTP/SSE 执行生产工具，SQLite/pi history 重开与真实字节验证。
- [x] Electron workspace-access 场景：新建、拒绝、旧审批、重试、重开会话与实际预览。
- [x] 用户/配置/概念、API/架构/开发/发布、产品状态与旧计划承接同步。
- [x] 完整 pnpm verify、全部视觉差异逐张裁决。
- [x] code-review 与本轮六项修复收口。
- [ ] Windows/Linux 实机和打包 gate；跨进程恶意移动与原子条件替换的剩余边界确认。

## 实施取舍

- 使用固定 @openclaw/fs-safe 0.12.0 的 native require；Node 缺少描述符相对发布，不能靠重复 realpath
  宣称修复。无原生后端时 fail closed，无 JavaScript 写入 fallback。
- 不承诺 OS sandbox 或跨进程 expected-inode CAS。macOS/Windows 同权限恶意目录移动与跨平台实机
  gate 保持明确限制，P0-SEC-002/005 不关闭；本轮不扩张为操作系统隔离项目。
- HTTP 用户明确 overwrite 与 Agent 审批共享写入边界，不新增聊天协议/正文存储。
- 为保留外部 Skills，read_skill 只查询同一冻结 Catalog，普通文件 read 仍拒绝绝对路径。
- 旧审批 extension、近似 diff 和其浅层测试由真实工具/HTTP 测试替换。

## 验证证据

- 原 HTTP 并发创建测试 RED：201/201；修复后 201/409。
- Windows 分隔符及大小写别名测试 RED：403；修复后 201/200。
- 原 destructive find policy RED：allow；共享 effect 矩阵和真实 bash 拒绝测试通过。
- workspace-tools 覆盖 read/write/edit/bash、目录替换、旧审批、拒绝/中止、只读、catalog 与搜索。
- workspace-access-flow 的 approve/deny/stale 三种 HTTP/SSE + SQLite 重开场景通过。
- Electron workspace-access 真实点击与落盘检查通过；不是仅截图或模拟文件。
- 收尾 RED/GREEN：新文件 umask 077 下原来为 0644，现为 0600；HTTP create 冲突恢复既有
  `file exists` 合同；Agent find/grep 排除 `.gitignore` 忽略的大文件并遵循嵌套否定规则。
- 2026-09-16 最终 `pnpm verify` 通过：docs、format、lint、全部包 typecheck、测试及 build。
  pi-server 302 passed / 1 skipped，desktop 444 passed，chat-core 38 passed，docs 30 passed。
- `pnpm verify:visual` 通过全部五个非 live 场景，41 张截图；首次比较 34 unchanged / 5 changed /
  2 new / 0 errors / 0 orphan。逐张裁决见下表。未使用真实凭据或外部模型。
- Spec/安全与 Standards/可靠性双轴复审完成；新增 `.gitignore` finding 修复后再次复核通过。
  没有未处理的已证实代码 finding；平台限制仍保留。未提交、推送或操作远端 Issue。

## 视觉裁决

| 截图                                   | 裁决与基线处理                                                     |
| -------------------------------------- | ------------------------------------------------------------------ |
| approval-flow/approval-command-pending | 移除永久前缀授权，增加单次宿主命令范围说明；布局正常，更新基线。   |
| approval-flow/approval-edit-pending    | 增加文件操作模式，diff 和按钮完整可见；更新基线。                  |
| workspace-access/overwrite-pending     | 新增真实生产工具的覆盖预览，长路径正常换行；建立基线。             |
| workspace-access/stale-approval        | 新增拒绝与过期失败结果，文件保留及重试通过实际交互验证；建立基线。 |
| skills-flow/skills-settings            | worktree 绝对路径及悬停背景不同；内容、布局无回归，不更新。        |
| skills-flow/skills-global-only         | worktree 绝对路径及悬停背景不同；内容、布局无回归，不更新。        |
| skills-flow/skill-diagnostics          | worktree 绝对路径及悬停背景不同；诊断未改变，不更新。              |
| core-ui/permission-menu                | 差异低于自动阈值，仍人工检查 Standard Access 文案并更新基线。      |

截图、比较报告和实际 Electron 执行摘要分别位于 `output/desktop-screenshots`、
`output/visual-diff/report.md`、`output/desktop-screenshots/summary.md`。

## Implementation Outcome

本轮六项 review 修复完成：生产 Agent 共享文件边界、删除 shell 前缀放行、原子新建与失败恢复、
过期审批保护、Windows 分隔符规范化、大小写不敏感文件系统别名兼容。保留原始 pi 协议与文件正文所有权。
正式文档已同步，新增依赖均固定版本。原工作区的无关修改保留。

这不是跨平台安全验收全部结束：当前实机证据仅来自 macOS；Windows/Linux、打包原生 binding 与同权限
恶意跨进程操作尚未完成验证。P0-SEC-002/005 和本规格/计划保持 active，不能据本轮结果宣称 OS sandbox
或跨进程 expected-inode CAS，也不关闭 GitHub Issue #5。

## Rebase 与 PR 交付（2026-09-16）

按用户要求将分支 rebase 到远端 main `950f732`，保留 #21 面板功能、两个默认验证场景及双方正式文档。
rebase 后 `pnpm verify` 再次通过：docs 30、chat-core 38、pi-server 302 passed / 1 skipped、desktop 452 passed；
`pnpm docs:check -- --base origin/main` 通过。

`pnpm verify:visual` 六个非 live 场景通过，共 44 张：36 unchanged、8 changed、0 new/orphan/error。
逐张重新检查 permission-menu、两张 pending approval、两张 workspace-access，确认是 Standard Access
与 #21 新布局的预期组合并更新这五张基线；三个 Skills 截图仅 worktree 路径不同，保留 main 基线。
新建、拒绝、过期审批、重试、重开历史及桌面面板实际交互均通过。

本次用户已授权提交、推送及创建 PR；前文未提交说明仅记录前一轮交付状态。PR 关联 #5 而不自动关闭，
跨平台实机、打包和跨进程安全限制保持不变。

## PR #38 冲突解决（2026-09-16）

再次 rebase 到 main `a63fd1f`，保留 #3 的统一 Loopback Access、renderer sandbox 和 main-owned
transport；#5 的生产工具及文件边界不变。合并启动入口，文件写入与 HTTP/SSE 测试沿用 main 的
认证测试入口；状态表保留 #3 已解决项及 #5 的剩余平台限制。

真实 Electron 回归先复现 workspace-access 场景仍直接 fetch 旧地址而失败；将其 provider 准备、
session 查询与文件预览改用既有 ctx.apiJson，随后实际新建、拒绝、过期审批、重试及重开历史通过。
没有增加认证旁路或改变生产权限。完整 `pnpm verify` 再次通过：docs 30、chat-core 38、
pi-server 341 passed / 1 skipped、desktop 478 passed；格式、lint、typecheck、build 通过。

`pnpm verify:visual` 六个场景、44 张截图通过：39 unchanged、5 changed、0 new/orphan/errors。
逐张裁决：workspace-access/overwrite-pending 的悬停状态与 diff 字形渲染不同；
workspace-access/stale-approval 的聊天滚动位置不同，拒绝及过期错误均可见；三张 Skills 为
worktree 路径换行与悬停背景差异。实际交互及文件字节断言均通过，无布局或内容回归，保留现有基线。
