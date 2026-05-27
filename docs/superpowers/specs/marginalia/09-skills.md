# 09. Skills

## 目标

交付最小 Skills 闭环：应用能发现本地 skills，用户能启停，Composer 能用 `/` 选择一个 skill，并让它影响下一轮 agent 行为。

## 依赖

- 01. 本机桌面壳与 pi-server。
- 02. Workspace、Session 与 Quick Chat。
- 03. Provider 与流式 Chat。

## 范围

包含：
- 扫描 `~/.pi/agent/skills/`。
- 扫描 `<workspace_root>/.skills/`。
- 解析 `SKILL.md` 基础元数据。
- Settings 中列出 skills。
- 启停切换。
- Composer `/` 触发选择。

不包含：
- Skills 市场。
- skill 安装器。
- skill 编辑器。
- bundles 打包发布。

## 加载规则

- global skills 来自 `~/.pi/agent/skills/`。
- workspace skills 来自 `<workspace_root>/.skills/`。
- workspace skill 与 global skill 同名时，workspace 优先。
- disabled skill 不进入 Composer 候选，也不注入 agent 上下文。

## 数据

可用 `settings` 或独立表记录启停状态：
- `skill_id`
- `scope`
- `enabled`
- `updated_at`

## UI

Settings / Skills：
- name。
- scope。
- path。
- enabled。
- 查看 `SKILL.md`。

Composer：
- 输入 `/` 弹出可用 skill。
- 选择后在本轮消息中附带 skill 指令。

## 验收

- 启动后能发现 global skills。
- workspace 下新增 `.skills/foo/SKILL.md` 后能被发现。
- 禁用 skill 后 Composer 不再显示。
- 选择一个 skill 后，下一轮 agent 输入包含该 skill 的指令内容。
- skill 解析失败时不会影响 app 启动，Debug 中能看到错误。

