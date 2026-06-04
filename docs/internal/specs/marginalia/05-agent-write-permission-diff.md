# 05. Agent 写文件、权限与 Diff

## 目标

交付安全写文件闭环：agent 可以提议创建或修改 Markdown 文件，用户先看到 diff，再选择允许一次、总是允许或拒绝。只有用户允许后才落盘。

## 依赖

- 01. 本机桌面壳与 pi-server。
- 02. Workspace、Session 与 Quick Chat。
- 03. Provider 与流式 Chat。
- 04. 文档读取与上下文。

## 范围

包含：
- `edit_file`。
- `write_file`。
- 路径沙箱。
- 写入前 proposal。
- diff 生成和展示。
- 权限 modal。
- `agent_outputs` 元数据。

不包含：
- hunk 级 accept/reject。
- 富文本编辑器。
- Git 快照。
- docx 写入。

## 写入流程

1. agent 发起工具调用。
2. server 校验路径在 workspace 内。
3. server 读取当前文件内容和 hash。
4. server 计算 proposed content 和 unified diff。
5. UI 展示 diff 和权限选择。
6. 用户允许后，server 再次校验文件 hash。
7. hash 未变化才落盘；变化则提示冲突并取消写入。

## 工具

`edit_file`：
- `path`
- `oldString`
- `newString`
- `expectedReplacements`，默认 1

`write_file`：
- `path`
- `content`
- `asAgentOutput`，默认 true

## 权限

权限粒度：
- allow once。
- always allow for this workspace。
- deny。

MVP 只做整文件级别的 accept/reject，不做 hunk 级别操作。

## 数据

新增 `agent_outputs`：
- `id`
- `workspace_id`
- `session_id`
- `rel_path`
- `created_at`

只记录元数据，不存文件内容。

## 验收

- agent 能创建一份新的 Markdown 笔记。
- agent 能用精确替换修改已有 Markdown。
- 修改前 UI 显示 unified diff。
- 拒绝后文件不变。
- 允许后文件落盘，Reader 能看到新内容。
- agent 创建的新文件在文件树中有标记。
- workspace 外路径写入会被拒绝。
- 文件在确认前被外部改动时，写入会被取消并提示冲突。

