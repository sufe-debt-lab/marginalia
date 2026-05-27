# Marginalia 桌面端应用 — 需求与设计文档

- **作者**：shixy
- **日期**：2026-05-24
- **状态**：历史总览 / vision backlog
- **执行方式**：本文件不再作为直接实现 spec。渐进式开发以 `docs/superpowers/specs/marginalia/` 下的闭环 spec 为准，每个 spec 独立设计、实现和验收。
- **参考实现**：
  - `agent-harness/CodePilot`（Electron + Next.js + Claude Agent SDK）
  - `agent-harness/open-cowork`（Electron + Vite + React + pi-coding-agent）
  - `agent-harness/openwork`（Tauri + React + OpenCode，different-ai 出品）
  - `agent-harness/pi-mono`（pi 多模型 Agent SDK）

---

## 1. 产品定位

**一句话**：本地优先的桌面端 AI 文档协作器。通过 MCP 接入用户自有数据库与资料源，由 Agent 协助完成**文档精读**与**文档写作**两类工作。

**目标用户**：先以个人重度文档工作者自用为目标；保留通过手机、Web 或 IM **远程控制本机 agent** 的接口。**不是面向开发者**——不内置编程/沙箱/GUI 自动化等能力。

**与三个参考实现的关系**：
- 借鉴 openwork 的 **"server-consumption first"** 架构哲学（桌面端只是客户端，agent 跑在独立 server 进程里）
- 借鉴 openwork 的 **Workspace / Artifacts / Extensions** 三大产品概念
- 借鉴 open-cowork 的 **pi 内核嵌入方式**
- 借鉴 CodePilot 的 **多模型 / MCP 管理 / Bridge 适配器** 工程经验
- **不复用任一项目的代码**，但参考其分层与模块划分

---

## 2. 总体架构

```
┌────────────────────────────────────┐
│  Electron Renderer (Vite + React)  │  纯客户端，无业务逻辑
│  - Workspace 切换器                  │
│  - Chat 主视图 + 文档面板按需浮现       │
│  - Settings / 首启空状态              │
└──────────────┬─────────────────────┘
               │ HTTP + SSE/WS
               │ 本机 127.0.0.1；远程入口只转发控制请求
               ↓
┌────────────────────────────────────┐
│  pi-server  (Node 子进程)            │  Agent runtime
│  - REST + SSE 路由层                 │
│  - pi-coding-agent 嵌入              │
│  - MCP 客户端管理                    │
│  - Skills 加载器                     │
│  - Session 持久化 + agent_outputs 标记│
│  - 多 provider 路由                  │
└──┬───────────┬────────────┬─────────┘
   │           │            │
   ↓           ↓            ↓
pi 内核     外部 MCP     LLM Providers
(多模型)    servers      (18+, 配置而来)
            (pg/qdrant
             /fs/web 等)
```

**核心架构原则**：

1. **进程分离**：Electron 主进程 fork 一个 Node 子进程跑 pi-server，绑定到 `127.0.0.1:<随机端口>`。渲染进程只通过 HTTP/SSE 跟 pi-server 通信，不直接 require 业务代码。
2. **本机 agent 主导**：MVP 只有本机 pi-server 读写本机 workspace。P1 的远程能力不是把 pi-server 部署到云上，而是让手机、Web 或 IM 入口把消息安全转发到本机 agent，由本机 agent 继续访问本地文件、MCP 和模型配置。
3. **pi 库式集成**：直接调用 `createAgentSession()`，不走 pi 的 RPC 模式（RPC 是 pi 给非 Node 应用准备的，我们是 Node，没必要多套一层）。
4. **MCP via 自建 adapter**：pi 不原生支持 MCP，需要在 pi-server 中用 `@modelcontextprotocol/sdk` 写一个 pi-extension，把 MCP 工具转换为 pi 的 ToolDefinition。这是工程难点（见第 11 节）。

---

## 3. 模块划分

```
marginalia/
├── apps/
│   └── desktop/                   # Electron 应用
│       ├── electron/
│       │   ├── main.ts            # 主进程入口
│       │   ├── pi-server-spawner.ts  # fork/管理 pi-server 子进程
│       │   ├── preload.ts         # 仅暴露 server URL/状态
│       │   └── window.ts
│       └── src/                   # 渲染进程（Vite + React）
│           ├── api/               # 调 pi-server 的 fetch 封装
│           ├── store/             # Zustand stores
│           ├── domains/           # 业务域（仿 openwork 分层）
│           │   ├── workspace/
│           │   ├── session/
│           │   │   ├── chat/         # 主视图：消息流 + tool 卡片
│           │   │   ├── document/     # 右侧浮现：reader + edit + diff
│           │   │   ├── composer/     # 输入框（@/触发）
│           │   │   └── file-tree/    # 侧栏文件树
│           │   ├── connections/   # MCP / Providers
│           │   ├── skills/
│           │   ├── settings/
│           │   ├── first-run/
│           │   └── debug/
│           ├── components/        # 通用组件 + shadcn/ui
│           ├── layout/            # 三栏布局
│           └── i18n/              # 中英
├── apps/
│   └── pi-server/                 # 独立可运行的 Node 应用
│       ├── index.ts               # express/hono 入口
│       ├── routes/
│       │   ├── sessions.ts
│       │   ├── messages.ts        # SSE 流式
│       │   ├── workspaces.ts
│       │   ├── files.ts           # 文件 CRUD + agent_outputs 元数据
│       │   ├── mcp.ts
│       │   ├── providers.ts
│       │   ├── skills.ts
│       │   ├── git.ts             # snapshot/history/diff/revert
│       │   ├── env.ts             # 环境变量管理
│       │   └── health.ts
│       ├── pi/
│       │   ├── session.ts         # createAgentSession 封装
│       │   ├── mcp-adapter.ts     # MCP → pi-extension
│       │   ├── tools/             # 内置工具
│       │   │   ├── read-doc.ts    # PDF/docx/md 读取
│       │   │   ├── list-files.ts  # 文件树
│       │   │   ├── search-files.ts # ripgrep 检索
│       │   │   ├── edit-file.ts   # oldString → newString 替换
│       │   │   ├── write-file.ts  # 全文覆盖 + agent_outputs 元数据
│       │   │   ├── git.ts         # snapshot/history/diff/revert（isomorphic-git）
│       │   │   ├── web-fetch.ts   # web 读取（可开关）
│       │   │   └── ask-user.ts
│       │   ├── path-sandbox.ts    # workspace.root_dir 路径检查
│       │   └── skills-loader.ts
│       ├── db/
│       │   ├── schema.ts          # SQLite schema
│       │   └── migrations/
│       └── lib/
│           ├── auth.ts            # Bearer token（MVP 不强制，代码就位）
│           └── logger.ts
└── packages/
    └── shared-types/              # 客户端/server 共享类型
```

**为什么 pi-server 是 apps/ 而不是 packages/**：明确"pi-server 是一个可独立运行的应用"。P1 阶段不改它一行代码就能搬到云端跑。

---

## 4. 数据模型（SQLite）

存储位置：`~/.marginalia/db.sqlite`

```sql
-- 工作区
CREATE TABLE workspaces (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  root_dir     TEXT,                -- 资料根目录
  default_model TEXT,
  default_provider TEXT,
  created_at   INTEGER,
  updated_at   INTEGER
);

-- 会话（按 workspace 隔离）
CREATE TABLE sessions (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  title        TEXT,
  pi_session_id TEXT,               -- pi-coding-agent 的 session ref
  parent_id    TEXT,                -- 支持会话分叉
  origin       TEXT DEFAULT 'desktop', -- desktop/quick_chat/feishu/qq/web 等入口
  created_at   INTEGER,
  updated_at   INTEGER,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

-- 消息（属于 session）
CREATE TABLE messages (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL,
  role         TEXT,                -- user/assistant/system/tool
  content      TEXT,                -- JSON
  tokens_in    INTEGER,
  tokens_out   INTEGER,
  created_at   INTEGER,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- Agent 产出元数据（不存内容，内容落盘到 workspace.root_dir）
-- 仅用于标记"哪些文件是 agent 创建的、归属哪个 session"
CREATE TABLE agent_outputs (
  id            TEXT PRIMARY KEY,
  workspace_id  TEXT NOT NULL,
  session_id    TEXT,
  rel_path      TEXT NOT NULL,      -- 相对 workspace.root_dir 的路径
  created_at    INTEGER,
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id)
);

-- MCP server 配置（per workspace 或 global）
CREATE TABLE mcp_servers (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT,                -- NULL 表示全局
  name         TEXT,
  transport    TEXT,                -- stdio/sse/http
  config       TEXT,                -- JSON（command/args/env/url 等）
  enabled      INTEGER DEFAULT 1,
  created_at   INTEGER
);

-- Provider 配置
CREATE TABLE providers (
  id           TEXT PRIMARY KEY,
  name         TEXT,                -- openai/anthropic/google/...
  api_key_ref  TEXT,                -- 引用 env_vars.id
  base_url     TEXT,
  enabled      INTEGER DEFAULT 1,
  config       TEXT                 -- JSON（自定义参数）
);

-- 环境变量集中管理（替代散落在各处的 API key）
CREATE TABLE env_vars (
  id           TEXT PRIMARY KEY,
  key          TEXT,
  value        TEXT,                -- 简单加密：MVP 用 electron safeStorage
  scope        TEXT,                -- global/workspace
  workspace_id TEXT,
  created_at   INTEGER
);

-- 设置
CREATE TABLE settings (
  key          TEXT PRIMARY KEY,
  value        TEXT
);
```

**关键设计**：
- `origin` 字段标记会话来源。P1 的远程控制入口仍然创建本机会话，不引入远程 worker
- **不存独立的 artifact 表**——agent 产出的文档就是 `workspace.root_dir` 下的普通文件。`agent_outputs` 仅做轻量元数据标记（"这是 agent 创建的、来自某 session"），UI 上可以加个小图标区分，但用户视角不需要"工件"这个独立概念。版本历史走 `git_snapshot`，不维护单独的版本表
- `env_vars` 与 `providers` 解耦——同一个 OpenAI key 可以被多个 provider 配置（如 OpenAI 原版 / Azure proxy）引用

---

## 5. UI 设计

### 5.1 主窗口布局：Codex 风格三栏（左导航 / 中 Chat / 右文档面板）

```
┌──────────┬──────────────────────────┬────────────────────────┐
│ 左栏：纯导航│ Chat（中央主视图）        │ 右栏：文档面板（按需浮现）│
│          │                          │                        │
│ Quick    │ 标题  ⓘ                 │ ┌──── 默认：文件树 ────┐│
│  chat ★  │ ──────                   │ │ apps/              ││
│ Search ★ │ user: ...                │ │ docs/              ││
│ MCP ★    │ assistant: ...           │ │ src/               ││
│ Skills ★ │  tool_use(edit) + diff   │ │ ...                ││
│ ─────    │  tool_use(read) 卡片     │ └────────────────────┘│
│Workspaces│                          │                        │
│ · ws-A   │ ──────                   │ ┌── 选中文件后：分屏 ──┐│
│   会话1 3h│ ┌────────────────────┐ │ │┌─文件树─┬─Reader/─┐ ││
│   会话2 2d│ │ Ask follow-up...   │ │ ││ apps/ │ Edit    │ ││
│ · ws-B   │ ├────────────────────┤ │ ││ docs/ │CodeMirror││
│   ...    │ │ + 🛡Ask writes▼   │ │ ││ src/  │+ 预览    │ ││
│          │ │   Claude 4.6·High▼ │ │ ││ ...   │         │ ││
│          │ │   🎤  ⬆️           │ │ │└────────┴─────────┘││
│          │ └────────────────────┘ │ │ Tabs: [文件树][版本] │
│          │                          │ └────────────────────┘│
├──────────┴──────────────────────────┴────────────────────────┤
│ Status: token / 连接 / 未保存 N 个改动 / Worker               │
└──────────────────────────────────────────────────────────────┘
```

**核心定位**：参考 Codex 桌面端三栏布局——**左栏纯导航**、**中央 Chat 主舞台**、**右栏文档面板按需浮现**。

### 5.1.1 左栏：纯导航

只放两类东西，不塞功能面板：

**顶部 4 个固定入口**：

| 入口 | 用途 |
|---|---|
| **Quick chat** | 临时对话，自动归属到最近使用的 workspace/project。适合"我有个问题快问一下"的场景。超过 N 天可设置自动归档 |
| **Search** | 跨 workspace 的全局搜索：找会话、找文件、找内容 |
| **MCP** | 全局 MCP 管理面板入口（点击展开浮窗） |
| **Skills** | 全局 Skills 管理面板入口（点击展开浮窗） |

**下方：Workspaces 列表 + 会话历史平铺**：

- 每个 workspace 节点可展开
- 展开后平铺其会话，每条会话带 **relative timestamp**（`3h / 2d / 4w / 1mo`）
- 默认每个 workspace 展开最近 5 个会话，"展开全部"链接看更多
- 不在左栏放文件树 / 版本历史 / MCP 状态 —— 这些都挪到右栏

### 5.1.2 中央 Chat 主视图

- 顶部：会话标题 + ⓘ 信息按钮
- 消息流：assistant 文本 / 思考块 / tool_use 卡片（含 diff、文件卡片）/ tool_result / AskUserQuestion modal
- 底部：Composer（详见 5.2）

### 5.1.3 右栏：文档面板（按需浮现，分屏式）

**触发显示**（多种方式）：
- agent 调 `edit_file` / `write_file` / `read_document` 时自动浮现
- 用户点 chat 消息中"在编辑器打开"按钮
- 用户主动按快捷键 / 顶部"📂"按钮

**显示分两阶段**：

1. **默认（未选文件）**：右栏整宽显示**文件树**
2. **选中文件后（分屏式）**：
   - 文件树**自动收窄**为左侧 200px 窄列（保留文件名 + 文件夹，可继续点击切换）
   - 右侧主区显示 **Reader 或 Edit**
   - 继续点其他文件，右侧主区切换内容，零摩擦
   - 用户可拖拽分隔线调整宽度

**右栏内部 Tab**：[文件树] [版本历史] 两个 tab 平级
- **文件树 tab**：上述 workspace.root_dir 浏览
- **版本历史 tab**：最近 N 个 git snapshot，点击展开看 diff，"回到此版本"按钮
- agent 创建的文件在文件树中有小图标区分（`agent_outputs` 元数据）

**右栏顶部按钮**：📂 折叠 / ⤢ 全屏化（覆盖 chat）/ ↻ 刷新

**Reader / Edit 模式**：
- **Reader**：只读预览；PDF（pdf.js）、Markdown（react-markdown）、docx（mammoth）、纯文本
- **Edit**：用 **CodeMirror 6 + `@codemirror/lang-markdown`** 渲染源码 + 实时预览
- 同一份文件可从 Reader 一键切到 Edit
- **不引入** TipTap/Lexical——CodeMirror + 预览对文档场景足够且实现轻量

### 5.2 Chat 主视图

- 消息流：assistant 文本输出、思考块（可折叠）、tool_use 卡片、tool_result 卡片、AskUserQuestion modal
- **tool_use 卡片增强**：
  - `edit_file` / `write_file` / `git_revert_file`：卡片内嵌 **unified diff 视图**（`react-diff-view`），并提供"在编辑器打开"按钮 → 触发右侧 Edit 浮现
  - `read_document`：卡片显示文件路径 + 摘要，按钮"在 Reader 打开" → 触发右侧 Reader 浮现
  - `git_snapshot`：展示快照对应的文件列表
  - `git_history` / `git_diff`：展示对应的版本卡片
- **Composer 富文本输入**：
  - `@` 触发：workspace 内文件（文件树）、最近读取的文档、当前 Reader/Edit 面板内容
  - `/` 触发：available skills 列表
  - 普通文本 + 多行
  - **不要图片粘贴**（MVP 不要，文档场景用不上）
- 工具调用卡片可点开看输入/输出原始 JSON

### 5.3 首启空状态

不做 Onboarding 向导。首次启动如果还没有 workspace 或 provider，主视图显示一个简洁空状态：
- 创建或选择 workspace/project
- 打开 Settings 配置 LLM provider
- 可选导入 MCP server 模板

空状态只负责给入口，不强制用户按固定步骤走完整流程。

### 5.4 Settings 页面

MVP 需要：
- **General**：默认 workspace、启动行为、语言（中/英）
- **Appearance**：主题（浅/深/跟系统）、字体大小、CodeMirror 主题（One Dark / 默认）
- **AI**：默认模型、推理预算
- **Providers**：列出 18+ provider，每个可配置 API key（引用 env_vars）+ base URL；含"测试连接"按钮
- **MCP Servers**：增删改、连接测试、工具列表浏览（per workspace + global）
- **Skills**：列出已发现的 skills、启停切换、查看 SKILL.md
- **Environment Variables**：所有 key 集中管理（用 safeStorage 加密）
- **File Access**：文件写工具的全局开关（`edit_file` / `write_file`）和默认权限策略
- **Git**：是否启用 git 弱化工具集；自动 snapshot 策略（手动 / agent 改动后弹提示 / 完全自动）
- **Web Fetch**：开/关 web 读取工具（默认关）
- **Debug**：token 累计用量、最近错误、日志导出、pi-server 健康状态
- **Recovery**：导出/导入 SQLite（含 sessions / messages / agent_outputs / settings）

P1 加：
- **Remote Control**：远程控制入口配置（Web/飞书/QQ、token、健康状态、会话来源）
- **Messaging**：飞书 / QQ 适配器配置

---

## 6. Agent 工具集（pi-extension 形态）

### 6.1 文档读类

| 工具 | 作用 | 权限要求 |
|---|---|---|
| `read_document` | 读取本地文件（PDF/MD/docx/txt），返回结构化内容 | 自动（路径沙箱：限 workspace.root_dir 内） |
| `list_files` | 列 workspace.root_dir 下的文件树 | 自动 |
| `search_files` | 文件名 / 全文检索（`@vscode/ripgrep`） | 自动 |

### 6.2 文档写类（带路径沙箱）

| 工具 | 作用 | 权限要求 |
|---|---|---|
| `edit_file` | 基于 `oldString → newString` 的精确替换（CodePilot 风格）；UI 必须显示 diff | **弹权限**，路径沙箱 |
| `write_file` | 直接覆盖写文件（全文重写场景）；用于"agent 创建新文档"（写入元数据到 `agent_outputs` 表） | **弹权限**，路径沙箱 |

**`edit_file` 设计**：
- 参数：`{ path, oldString, newString, expectedReplacements? }`
- `oldString` 必须在文件中精确出现 `expectedReplacements` 次（默认 1），否则失败——避免歧义替换
- 不支持模糊匹配 / regex（开放问题 #11，倾向严格匹配）
- UI 渲染 unified diff（react-diff-view），用户可整文件 accept/reject，**不做** hunk 级别 accept（开发量过大）

**`write_file` 设计**：
- 参数：`{ path, content, asAgentOutput? }`
- 若 `asAgentOutput = true`（默认），写入 `agent_outputs` 表标记元数据（用于侧栏文件树小图标区分）
- agent 创建新文档（精读笔记、写作产出）一律走 `write_file`——不再有独立的 `create_artifact` 概念

### 6.3 Git 弱化版（暴露"版本/快照"语义，隐藏 git 概念）

| 工具 | 作用 | 等效 git 命令 | 权限 |
|---|---|---|---|
| `git_status` | 列出当前 workspace 改动文件 | `git status --porcelain` | 自动（只读） |
| `git_history` | 看版本历史（最近 N 条） | `git log --oneline -n` | 自动（只读） |
| `git_diff` | 比较两个版本，或工作区 vs HEAD | `git diff` | 自动（只读） |
| `git_init` | 在 workspace.root_dir 初始化 git 仓库 | `git init` | **弹权限** |
| `git_snapshot` | 保存当前所有改动为一个版本（一键 add + commit） | `git add . && git commit -m "[marginalia] <msg>"` | **弹权限** |
| `git_revert_file` | 把某个文件回到某个版本 | `git checkout <ref> -- <file>` | **弹权限** |

**Git 弱化原则**（参见第 14 节非目标）：
- 用户视角术语：**版本** = commit，**快照** = 一次保存，**历史** = git log，**回到旧版本** = checkout
- **不做**：branch / merge / rebase / cherry-pick / reflog / stash / remote / push / pull / clone / 冲突解决
- 用户如需专业 git 操作，自己开终端用系统 git，Marginalia 不阻拦
- commit message 固定前缀 `[marginalia]`，便于在用户自己的 commit 中识别
- 实现用 `isomorphic-git`（无系统 git 依赖，便携）

### 6.4 其他

| 工具 | 作用 | 权限要求 |
|---|---|---|
| `ask_user` | 询问用户（AskUserQuestion） | UI 自动呈现 |
| `web_fetch` | 抓 URL 并提取正文（仅当 settings 启用） | 自动（启用前提下） |

### 6.5 外部工具（via MCP）

- 用户自配的 MCP servers 暴露的所有工具
- 工具名按 `<mcp-name>__<tool-name>` 命名，避免冲突
- 用户想要专业 git 工具集？装 `git-mcp`。想要 bash？装相应 MCP server。这是产品扩展点

### 6.6 明确不内置

- ❌ `bash` / `exec` —— 无沙箱，用户自装 MCP
- ❌ `find` —— `list_files` + `search_files` 已覆盖
- ❌ `grep` —— `search_files` 已是 ripgrep
- ❌ 专业 git 命令（branch/merge/rebase 等）—— 见 6.3 弱化原则

---

## 7. 多模型

直接复用 pi-ai 的 18+ provider。MVP 在 Settings 默认呈现五个最常用的：
- **Anthropic**（Claude 系）
- **OpenAI**（GPT 系）
- **Google**（Gemini 系）
- **DeepSeek**
- **Ollama**（本地）

其余通过 "Advanced providers" 折叠展开。

模型选择：会话级（每个 session 可独立切模型；切换时 pi 自动转换历史格式以适配新模型，这是 pi 现成能力）。

---

## 8. MCP 集成

**架构**：

```
pi-server
  └── mcp-manager
        ├── 维护已配置的 MCP servers 列表
        ├── 按需启动 stdio 子进程 / 建立 sse|http 连接
        ├── 调用 ListTools 拿到工具列表
        ├── 经 mcp-adapter 转换为 pi 的 ToolDefinition
        └── 注册到 pi-extension，让 agent 看见
```

**关键挑战**：pi 不原生支持 MCP。要写一个 pi-extension：
1. 在 agent 创建时拿到当前 workspace 的 MCP server 列表
2. 对每个 server，把它的工具用 TypeBox 包装成 pi 的 ToolDefinition
3. 工具执行时，把调用代理到对应的 MCP client
4. 处理工具名长度 / 重名 / 失败重连等边界

**MVP 推荐预置三个 MCP server 配置模板**（在 Settings 或首启空状态里一键导入）：
- **fs-mcp**（stdio）：本地文件夹访问
- **postgres-mcp**（stdio）：PostgreSQL 查询
- **qdrant-mcp**（stdio 或 sse）：向量检索

---

## 9. Skills

兼容性：复用 `~/.pi/agent/skills/` + 项目内 `<workspace_root>/.skills/`。

MVP 只做：
- 启动时扫描 + chokidar 文件监听热加载
- Settings/Skills 列出来，可启停
- Composer `/` 触发可选

不做：
- 不做 Skills 市场 / 安装器
- 不做 bundles 打包发布
- 不做 skill 编辑器（用户用编辑器自己改 SKILL.md）

---

## 10. 远程控制（P1，仅预留接口）

远程指的是**远程控制本机 agent**，不是远程 worker，也不是把 workspace 搬到云端。pi-server 仍运行在用户本机，文件读写、MCP 连接、provider 配置和会话持久化都发生在本机。远程入口只负责把外部消息路由到本机 agent，并把结果回传给对应渠道。

MVP 阶段做的预留工作：

1. **pi-server 默认只绑定本机**：MVP 固定 `127.0.0.1:<随机端口>`，不开放公网监听
2. **鉴权中间件代码就位**：Bearer token 用于 P1 的远程控制入口，MVP 本地桌面端可不强制
3. **会话来源字段**：`sessions.origin` 标记 `desktop` / `quick_chat` / `feishu` / `qq` / `web`
4. **channel adapter 边界**：远程渠道只允许创建消息、订阅结果、接收 AskUserQuestion；文件读写和工具权限仍走本机 pi-server 的统一权限模型

P1 实施：

| P1 子任务 | 描述 |
|---|---|
| 远程控制网关 | 本机 pi-server 增加受保护的 remote-control API，外部入口通过 token 或本机显式开启的 tunnel 调用 |
| 飞书适配器 | 新模块 `apps/pi-server/channels/feishu/`，订阅 bot 消息、路由到本机会话、把 SSE 结果格式化为飞书卡片 |
| QQ 适配器 | 同上结构，用 go-cqhttp 或 nonebot 协议 |
| Web 控制端 | 做轻量 `apps/web-control/`，用于手机浏览器发消息和查看结果。它控制本机 agent，不直接持有 workspace 文件 |

参考 open-cowork 的 `src/main/remote/channels/` 模式实现 channel-adapter 抽象。

---

## 11. 工程风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| **pi 不原生支持 MCP，需要自建 adapter** | 工程量 1-2 周，且 pi 的 extension API 稳定性需验证 | **MVP 前先做 POC**：1 天内验证一个 stdio MCP server（如 fs-mcp）能否在 pi-extension 内被 agent 调用。POC 失败要 fallback：放弃 MCP，直接给 agent 写若干内置工具 |
| pi-server 是子进程，调试链路长 | DX 差 | 主进程加 verbose 模式，pi-server 输出全打 IPC 到主窗口的 Debug View |
| **`edit_file` / `write_file` 引入文件系统写权限** | 误操作可能改坏用户文档 | 1) **强制路径沙箱**：所有文件写工具用 `path.resolve` + `path.relative` 验证目标必须在 `workspace.root_dir` 子树内，含 `..` 或绝对路径跳出立即拒绝 2) **权限模型扎实**：首次工具使用必弹询问，记忆 always/once/deny 三档 3) UI 必须展示 diff，用户可视审计 |
| **Git 操作可能破坏用户已有仓库** | 用户已用 git 管理 workspace，我们的"快照"可能与他自己的 commit 冲突 | 1) `git_snapshot` commit message 加固定前缀（如 `[marginalia]`），便于识别 2) 不做 rebase/merge，永远只追加 commit 3) `git_revert_file` 用 `checkout <ref> -- <file>` 而非 `reset`，不破坏历史 |
| 远程控制入口暴露本机 agent | 外部渠道一旦被滥用，就能间接访问本机 workspace 和 MCP | P1 默认关闭远程控制；开启时必须有 token、渠道白名单、操作审计日志。远程入口不能绕过本机工具权限，写文件仍要走同一套 allow once / always / deny |
| 文档面板"自动浮现"可能干扰用户 | UX 干扰 | 提供"禁用自动浮现"设置；浮现有动画且可一键收起；记忆用户偏好（同 session 多次收起则停止自动浮现） |
| Spreadsheet 表格需求 | 文档场景偶尔要做数据透视 | MVP 用 markdown table 即可；P2 再考虑专门 spreadsheet 视图 |
| Provider 太多导致 Settings 杂乱 | UX 问题 | 默认折叠，按使用频率推荐 |
| 多 workspace 状态切换可能产生 race | 数据安全 | 切换 workspace 时强制 close 所有 active session 的 SSE 流，等 pi-session 完全切换再开新连接 |
| CodeMirror 6 学习曲线 | extension API 复杂 | MVP 只用基础 setup + lang-markdown + lang-yaml；高级特性（vim mode / linting）放 P1 |
| isomorphic-git 对大仓库性能 | 大型 git 仓库索引慢 | MVP 不优化；文档场景 commit 通常不多。如真遇到大仓库，再切系统 git spawn |

---

## 12. MVP 验收清单

> 标准：本人一天内能用它完成"读完一篇 50 页 PDF + 输出一份精读笔记 + 调用 SQLite 查询补充数据 + 导出 markdown 笔记"全流程。

- [ ] Electron 应用能启动，pi-server 子进程自动 spawn
- [ ] 首启空状态提供创建 workspace、打开 Settings 配 provider、可选导入 MCP 模板的入口
- [ ] 至少 2 个 provider 跑通（Anthropic / OpenAI / Ollama 中任两个）
- [ ] PDF / Markdown / docx 文件能在 Reader 中打开
- [ ] Chat 流式输出、工具调用卡片显示正常
- [ ] Composer 支持 `@文件` / `/skill` 触发
- [ ] **Chat 主视图**：消息流 + tool_use 卡片 + Composer 工作正常；文档面板默认折叠
- [ ] **agent 调 `edit_file` / `read_document` 时右侧文档面板自动浮现，定位到对应文件**
- [ ] **agent 能用 `write_file` 创建新文档，文件树中显示且有 agent_outputs 小图标标记**
- [ ] **agent 能用 `edit_file` 修改 workspace 内的 markdown，UI 显示 diff，权限模型可"允许一次/总是允许/拒绝"**
- [ ] **侧栏文件树展示 workspace.root_dir，点击可在 Reader 中打开**
- [ ] **agent 能用 `git_snapshot` 保存版本，侧栏"版本历史"能看到并 diff**
- [ ] 路径沙箱生效：试图写 workspace 外的路径被拒绝
- [ ] 至少 1 个外部 MCP server（fs-mcp）连接成功且工具可被 agent 调用
- [ ] Settings 完整：providers / MCP / env vars / debug
- [ ] 会话持久化到 SQLite，重启不丢
- [ ] Debug View 显示 token 用量、错误日志、pi-server 健康
- [ ] 中文 UI 全覆盖（英文翻译可后补）
- [ ] Recovery 能导出/导入 db.sqlite

---

## 13. 阶段划分

### MVP（目标：4-6 周，单人开发）

第 1 周：
- 项目脚手架（pnpm workspace + Electron + Vite + React + shadcn/ui）
- pi-server 基础（hono + better-sqlite3 + pi-coding-agent 集成）
- pi-extension + MCP adapter POC

第 2 周：
- 主进程 fork pi-server，渲染进程通过 HTTP/SSE 连
- Workspace 模型 + Session/Message CRUD + SSE 流
- 三栏布局 + Composer 基础

第 3 周：
- Chat 主视图完整（消息流、tool 卡片、permission modal）
- 右侧文档面板浮现 / 折叠 / 全屏机制
- Reader（PDF.js + Markdown + docx）
- CodeMirror 编辑器 + Markdown 实时预览
- 侧栏文件树面板
- 内置工具 `read_document` / `list_files` / `search_files`

第 4 周：
- 文件写工具：`edit_file` / `write_file` + 路径沙箱 + diff 渲染（react-diff-view）
- Permission Modal 完整（allow once / always / deny）
- Git 弱化版（isomorphic-git）：`git_init` / `git_snapshot` / `git_history` / `git_diff` / `git_revert_file`
- 侧栏"版本历史"面板
- Settings 全套
- 首启空状态

第 5 周：
- MCP 配置 + 工具浏览（adapter 已在第 1 周 POC，本周完整化）
- Skills 加载
- Debug / Status Bar / Recovery
- i18n（中英）
- web_fetch 工具
- 多 provider 调通

第 6 周：
- 打磨、bugfix、打包

### P1（远程控制）

- 远程控制网关 + 鉴权
- 飞书适配器
- QQ 适配器
- Web 控制端（手机访问，本机 agent 执行）
- 会话树 / 分叉

### P2（增强）

- Spreadsheet 视图（独立的电子表格编辑器，处理 .csv/.xlsx）
- Share Workspace（多人协作）
- 模板工作流 / 定时任务
- Skills 市场或 Bundles

---

## 14. 非目标（明确不做）

**编辑器**：
- ❌ 代码编辑器**作为产品入口**（不做 IDE / Monaco / Language Server / Sandpack）
- ✅ 注：用 CodeMirror 作为 Markdown 编辑器**底层**——这与"代码编辑器集成"是两回事；CodeMirror 在这里只是文本编辑组件

**Bash / 终端**：
- ❌ Bash / 系统命令执行内建工具
- ❌ 内置 Terminal / PTY
- ❌ 沙箱（WSL / Lima / Docker）—— 因为没有危险工具需要沙箱

**Git**：
- ✅ 内置**弱化版 git**（snapshot / history / diff / revert），暴露"版本"语义
- ❌ **不内置专业 git**：no branch / merge / rebase / cherry-pick / reflog / stash / remote / push / pull / clone / 冲突解决 UI
- ❌ 如果用户需要专业 git 操作，用系统 git CLI 或装 git-mcp

**其他**：
- ❌ GUI / 浏览器自动化（不做 Browser Panel）
- ❌ 反向 MCP（不把自己暴露为 MCP server）
- ❌ Cloud Account / 企业策略下发（Den 那套）
- ❌ Skills 商业市场 / Bundles 发布系统
- ❌ 内置向量库 / 嵌入流水线
- ❌ 语音控制（HandsFree）
- ❌ 图像生成专用配置
- ❌ 自动更新机制（MVP 不要）

---

## 15. 开放问题

> 这些是写 spec 过程中浮现、需要 review 时定的细节：

1. ~~Markdown 编辑器选型~~ → **已定：CodeMirror 6 + lang-markdown**
2. **PDF 渲染**：pdf.js 还是 mupdf-wasm？mupdf 渲染好但 wasm 体积大
3. **会话标题生成**：是否要自动调一次小模型给会话起名？还是手动重命名？
4. **token 用量统计**：仅累计还是要按 provider/session 分类？要不要画图？
5. **Skill 触发**：`/skill` 之后是按 skill name 模糊搜还是显式选 menu？
6. ~~artifact 文件落盘~~ → **已定**：agent 产出物统一为 `workspace.root_dir` 下的普通文件，无独立落盘目录；唯一例外是 `agent_outputs` 元数据存 SQLite（仅记录路径 + session_id，不存内容）
7. **MCP server "首次连接"提示**：连不上时 UI 怎么呈现错误？
8. **pi 版本锁定**：是否锁 `0.60.x`（open-cowork 同款）还是跟最新？
9. **Git 实现**：用 `isomorphic-git`（纯 JS，无系统依赖）还是 spawn 系统 `git`？前者便携，后者性能/兼容性强
10. **自动快照策略**：是否在每次 agent 的"批量改动"完成后自动 snapshot？还是完全手动？倾向"每次 agent 完成会话且有改动时弹一次提示"
11. **edit_file 的匹配模式**：oldString 完全匹配（CodePilot 风格）还是支持模糊匹配？前者安全后者宽松

---

## 附录 A：与三个参考项目的复用清单

| 参考 | 学到的 | 复用 |
|---|---|---|
| **CodePilot** | 多模型 provider 配置 UI、Stream Session Manager、Bridge 适配器模式 | 思想复用，代码不直接 fork |
| **open-cowork** | pi 嵌入方式、Remote Manager 架构、MCP 集成模式（自建 adapter）、channel-adapter 抽象 | **思想 + 代码片段参考**（注意 license） |
| **openwork** | Workspace / Artifacts / Extensions 概念、domain 分层、shadcn/ui + Zustand + TanStack Query 栈、debug 思路 | 概念复用，不复用代码（OpenCode 内核不同） |

## 附录 B：技术栈最终清单

| 层 | 技术选择 | 备选 |
|---|---|---|
| 桌面壳 | Electron 40 | - |
| 前端构建 | Vite 7 | - |
| UI 框架 | React 19 | - |
| UI 组件库 | shadcn/ui (Base UI) | - |
| 状态管理 | Zustand | TanStack Query 用于服务端状态 |
| 服务端框架 | Hono | Express / Fastify |
| Agent SDK | @mariozechner/pi-coding-agent ~0.60 | - |
| 多模型 SDK | @mariozechner/pi-ai ~0.60（pi 自带） | - |
| MCP SDK | @modelcontextprotocol/sdk | - |
| 数据库 | better-sqlite3 | - |
| PDF | pdf.js | mupdf-wasm |
| docx 解析 | mammoth | - |
| Markdown 渲染 | react-markdown + rehype | - |
| Markdown 编辑 | **CodeMirror 6** + `@codemirror/lang-markdown` + `@codemirror/lang-yaml` + `@codemirror/state` + `@codemirror/view` + `@codemirror/theme-one-dark` | TipTap / Lexical（MVP 不用） |
| Diff 渲染 | `react-diff-view` + `diff` | - |
| Git（弱化版） | `isomorphic-git`（不依赖系统 git） | spawn 系统 `git` 子进程 |
| 文件监听 | chokidar | - |
| 内容检索 | `@vscode/ripgrep` | - |
| i18n | i18next | - |
| 加密存储 | electron safeStorage | - |
| 打包 | electron-builder | - |

---

## 附录 C：术语

- **Workspace**：用户的工作区，对应一个项目/主题。每个 workspace 有独立的资料根目录、MCP 子集、默认模型、会话集
- **Session**：一次与 agent 的对话，属于某个 workspace
- ~~**Artifact**~~：原本设计是 agent 产出的独立工件，**已统一为 workspace 内的普通文件 + `agent_outputs` 元数据标记**。术语保留以理解参考实现（openwork / Claude.ai），本项目实现上不存在独立 artifact 概念
- **Provider**：LLM 服务提供商（Anthropic / OpenAI / Ollama 等）
- **MCP Server**：外部数据/工具源，通过 Model Context Protocol 接入
- **Skill**：基于 Markdown + 元数据定义的 agent 行为模板
- **Remote Control**：远程控制本机 agent 的入口。外部 Web/IM 渠道只负责转发消息和回传结果，实际执行仍在本机 pi-server
- **Worker**：一个 pi-server 实例。MVP 阶段只有本机 worker；P1 不引入云端 worker，只增加远程控制入口
- **pi-extension**：pi-coding-agent 的扩展机制；本项目用它接入 MCP 与内置工具
- **Snapshot（版本快照）**：用户视角的"保存版本"概念，底层是一次 git commit。Marginalia 隐藏 git 术语，对外只暴露"快照/历史/回溯"
- **路径沙箱**：所有写文件类工具（edit_file / write_file / git_snapshot 等）严格限定操作路径在 `workspace.root_dir` 子树内
