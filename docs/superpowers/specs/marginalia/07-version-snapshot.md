# 07. 版本快照

## 目标

交付普通用户可理解的版本能力：保存快照、查看历史、查看 diff、把单个文件回到旧版本。底层可以用 Git，但 UI 不暴露专业 Git 概念。

## 依赖

- 01. 本机桌面壳与 pi-server。
- 02. Workspace、Session 与 Quick Chat。
- 05. Agent 写文件、权限与 Diff。

## 范围

包含：
- `git_init`。
- `git_status`。
- `git_snapshot`。
- `git_history`。
- `git_diff`。
- `git_revert_file`。
- 右侧文档面板的版本历史 tab。

不包含：
- branch、merge、rebase、stash。
- remote、push、pull。
- 冲突解决 UI。
- 自动 snapshot 默认开启。

## 策略

- 用户视角叫“版本”或“快照”，不叫 commit。
- 如果 workspace 没有 `.git`，用户确认后初始化。
- `git_snapshot` 默认只保存 agent 本轮 touched files。
- 如果用户手动选择“保存全部改动”，UI 必须先展示文件列表。
- commit message 使用 `[marginalia] <msg>` 前缀。

## 工具权限

- `git_status`、`git_history`、`git_diff` 只读，自动允许。
- `git_init`、`git_snapshot`、`git_revert_file` 需要用户确认。

## UI

版本历史 tab 显示：
- 快照列表。
- 每个快照的时间、标题、文件数。
- 点击快照查看 diff。
- 单文件“回到此版本”按钮。

## 验收

- 没有 `.git` 的 workspace 能初始化版本能力。
- agent 修改文件后，用户能保存一次快照。
- 历史列表能看到刚保存的快照。
- 能查看工作区和某个快照的 diff。
- 能把单个文件回到旧版本。
- `git_snapshot` 不会默认提交 workspace 中所有未跟踪文件。

