---
type: spec
record_id: SPEC-WORKSPACE-ACCESS-005
status: active
created: 2026-09-16
updated: 2026-09-16
target_milestone: M0-trustworthy-local-alpha
owner: repository-maintainers
docs_impact:
  user:
    - docs/user/guide.md
    - docs/user/configuration.md
  developer:
    - docs/developer/architecture.md
    - docs/developer/api.md
  product_status: true
---

# Workspace Standard Access

本切片实施 [Issue #5](https://github.com/sufe-debt-lab/marginalia/issues/5)，承接
[父规格 #2](https://github.com/sufe-debt-lab/marginalia/issues/2) 的可信本地访问合同。
2026-09-16 已读取两票正文及评论（均无评论），原生 blocked-by 列表为空。
不实现相邻 #3、#4、#6 或 Capability 安装任务。原型不进入生产路径。

## 验收

- HTTP 与 Agent 文件操作共享 canonical workspace 边界，拒绝绝对路径、父路径逃逸、symlink parent 和替换路径。
- 使用 read/create/overwrite/delete/execute/export/send 结构化 effect；Standard Access 允许读取与新建，其余等待明确审批。
- 审批在执行前展示目标、模式和真实预览；拒绝无文件副作用，批准后重新核对基线。
- 保留 Electron、HTTP/SSE、raw pi events、toolCallId、ChatEntry 和本地文件正文所有权。
- 使用可控 Agent、临时文件和 SQLite 验证正常流程、竞态、失败恢复及持久化。
- 同步用户权限、架构、API、产品状态；focused tests、typecheck、verify 和涉及 UI 的 Electron 验证通过。

## Deviation

实现以固定版本原生文件后端承担操作边界。Node 字符串检查不再作为 race-free 依据。
本轮修复可控路径替换、并发写入、过期审批与失败原子性；不将 macOS/Windows 的原生 best-effort
containment 宣称为同权限恶意进程下的 OS 隔离，也不声称跨进程 expected-inode CAS。对应平台发布门禁保持未关闭。
