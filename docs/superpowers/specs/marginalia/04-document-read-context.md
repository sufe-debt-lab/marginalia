# 04. 文档读取与上下文

## 目标

交付文档精读的最小闭环：用户能浏览 workspace 文件，打开文档预览，用 `@文件` 把文档加入对话上下文，agent 能基于文档内容回答。

## 依赖

- 01. 本机桌面壳与 pi-server。
- 02. Workspace、Session 与 Quick Chat。
- 03. Provider 与流式 Chat。

## 范围

包含：
- 文件树读取。
- 路径沙箱，只允许访问 `workspace.root_dir` 内文件。
- Markdown、txt、PDF Reader。
- `list_files`、`read_document`、`search_files` 内置工具。
- Composer `@文件` 触发。

不包含：
- docx。
- 编辑文件。
- diff。
- MCP 文件工具。

## 文件读取规则

- 所有路径先转为 workspace 相对路径。
- server 使用 `path.resolve` 和 `path.relative` 校验不能跳出 workspace。
- 默认忽略 `.git`、`node_modules`、大于阈值的二进制文件。
- PDF 先抽取文本和页码，渲染预览可以后置优化。

## API

- `GET /workspaces/:id/files`
- `GET /workspaces/:id/files/content?path=...`
- `GET /workspaces/:id/files/search?q=...`

## Agent 工具

- `list_files`
- `read_document`
- `search_files`

工具返回结构化结果，至少包含：
- `path`
- `mime`
- `text`
- `pages`，PDF 可用
- `truncated`

## UI

右侧文档面板包含：
- 默认文件树。
- 点击文件后显示 Reader。
- Chat 中可点击文档引用打开 Reader。
- Composer 输入 `@` 时显示 workspace 文件候选。

## 验收

- 能在右栏看到当前 workspace 文件树。
- 能打开 Markdown、txt、PDF。
- `@文件` 后发送问题，agent 能读取文件内容并回答。
- 试图读取 workspace 外路径会被拒绝。
- 搜索能找到文件名或文本内容。

