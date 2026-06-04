# Codex 风格 Electron Agent GUI 重做设计

## 背景

`apps/desktop` 目前的界面是裸 HTML 表单堆叠：标题输入框、Browse 按钮、workspace 列表、消息列表、Provider/Model 选择器、文档面板，全部用浏览器默认样式渲染。两个核心问题：

1. **视觉粗糙**：没有任何样式系统，所有控件原生外观，密度差、间距乱、无视觉层级
2. **信息架构混乱**：Workspace 创建表单与 workspace 列表混在 sidebar，Session 标题输入与消息列表混在主区域，Provider/Model 选择放在 ChatView 顶部，文件操作分散在多处

参考实现：

- `agent-harness/pi-gui` —— 同样基于 pi runtime 的 Electron shell，已经实现完整的 Codex 风格 UI（plain CSS）
- `agent-harness/CodePilot` —— Tailwind + shadcn 栈的成熟参考
- `agent-harness/deer-flow/frontend` —— Tailwind 栈的纯网页参考
- Codex 桌面客户端截图（用户提供）—— 视觉目标

本次重做是**视觉 + 信息架构**两层的改造，不引入新业务功能。

## 视觉验收基准

最终视觉效果对标 Codex 桌面客户端：

- `assets/codex-ui-reference/01-empty-state.png` —— 空态（new-thread）：标题、居中输入框、底部 chips、左侧 sidebar 项目+会话树、字体/间距/灰阶
- `assets/codex-ui-reference/02-chat-with-files.png` —— 进入会话 + 右栏打开 Tabs + 文件树抽屉：三栏比例、tabs 外观、文件树字号、Topbar 按钮排布

**对比范围：仅视觉样式**（字体、间距、圆角、灰阶、阴影、控件外观、布局比例）。**不包括功能复刻**（Codex 的 Search / Plugins / Automations / Connect cards / 5.5 Medium 模型标识等本期不做）。验收时把实现截图与上述两张参照图并排查看，判断"质感是否在同一水准"，而非"控件是否一一对应"。

## 目标

- 三栏可折叠布局，主区域支持 `new-thread` / `chat` / `settings` 三种视图
- 视觉风格对齐 Codex：浅色、低对比、强排版层级、Inter 字体、圆角 6-8px、中性灰阶
- Workspace / Session / Provider / Model 的创建与切换都通过可见、可达的 UI（非散落表单）
- UI 文案支持英文 / 中文切换，默认英文，用户选择持久化
- Composer 集成 `@` 文件提及、`/` 斜杠命令、内联 Model 选择器
- 右栏文件面板支持多 tab、可折叠文件树（@pierre/trees）、Markdown / 代码预览、Attach to chat
- 全程键盘可达（textbox 用 aria-label，菜单/弹层用 Radix 自带 a11y）

## 非目标

- 跨会话搜索、Plugins、Automations（截图里 Codex 有的入口）
- 工具调用 / Agent 步骤时间线（pi-server 目前只发 `assistant_delta`；以后再加）
- 图片附件、麦克风 / STT、git diff 渲染
- 主题切换、暗色模式（首版只做浅色）
- 端到端 Playwright 测试（继续靠 Vitest + RTL）
- 自动同步文件树（首次拉一次，不监听 fs 变更）
- 运行时数据校验（zod 等）

## 架构

### 顶层视图（views）

由 Zustand store 持有 `view: 'new-thread' | 'chat' | 'settings'`，`<AppShell>` 据此决定主区域内容。三个视图共用 Topbar + Sidebar，右栏仅在 `chat` 视图显示。

| view       | 触发                              | 主区域            | Right panel |
| ---------- | --------------------------------- | ----------------- | ----------- |
| new-thread | Sidebar "New chat" 或 无 active session | `<NewThreadView>` | 隐藏        |
| chat       | 选中 / 新建 session 并已发出第一条 prompt | `<ChatView>`     | 默认显示（按钮可收起）|
| settings   | Sidebar "Settings"                | `<SettingsView>`  | 隐藏        |

工作区切换不改 view，只改 `activeWorkspaceId`。

### 三栏壳层

```
┌──────────────────────────────────────────────────────────────┐
│ Topbar: [⛬traffic] [◧sidebar] [‹›] [title]      [⛭] [◨right] │
├──────────┬──────────────────────────────────────┬────────────┤
│ Sidebar  │  Main (NewThreadView / ChatView /    │ DocPanel   │
│ (≈240)   │   SettingsView)                       │  (≈320)   │
│ 可折叠   │  flex: 1                              │  可折叠     │
└──────────┴──────────────────────────────────────┴────────────┘
```

- Electron 主窗口 `titleBarStyle: 'hiddenInset'`，保留 macOS 红绿灯
- Topbar 整条 `-webkit-app-region: drag`，按钮单独 `no-drag`
- 左右栏折叠状态由 store 持久化到 localStorage

### 视图：NewThreadView（new-thread 空态）

居中（`max-w-[720px] mx-auto`），垂直布局：

```
                What should we build?

   ┌─────────────────────────────────────────────┐
   │  Do anything…                               │
   │                                             │
   │  ┌─────────────────────────────────────────┐│
   │  │ +  gpt-5.1-medium ▾                  ↑ ││
   │  └─────────────────────────────────────────┘│
   └─────────────────────────────────────────────┘

        📁 marginalia ▾     🌿 main ▾
```

- 标题 `text-2xl font-medium`
- 输入框 `min-h-[120px]`，autosize 至 `260px` 后内滚
- 输入框底部工具条：附件按钮 + ModelPicker Popover + Send 按钮
- 输入框**下方独立一行**才是 chip 区（用户明确要求：只在 new-thread 出现）：
  - `WorkspaceChip` — DropdownMenu 列出所有 workspace + `+ New workspace…`（直接走 `pickWorkspaceDirectory` + `createWorkspace`，无对话框）
  - `BranchChip` — 显示当前 git 分支；如果 `api.getBranch(workspaceId)` 返回 `null`（后端未实现）则隐藏
- 没有麦克风、没有 SessionMode chip（用户明确要求去掉）
- 提交流程：
  1. 校验：`prompt.trim()` 非空、`activeWorkspaceId` 已设
  2. `api.createSession({ workspaceId, title: prompt.slice(0, 32) })`（签名已与现有 `apps/desktop/src/api/client.ts:60` 一致，无需改动）
  3. `store.setActiveSession(newSession.id)` + `store.setPendingPrompt(prompt)` + `store.setView('chat')`
  4. ChatView mount 后 `useEffect` 检查 `pendingPrompt`：非空则调 `useStreamingChat.send(pendingPrompt)` 并 `store.setPendingPrompt(null)`（消费一次）
  5. 之后用户从 Sidebar 切回这个 session 时 `pendingPrompt` 已是 null，不重发

### 视图：ChatView（chat 中）

```
┌─────────────────────────────────────────────────────────┐
│  MessageStream  (flex-1, overflow-auto, max-w-3xl 居中)  │
│                                                         │
│   ╭───────────────────────────────╮                     │
│   │ user                          │  ← 右对齐灰底胶囊     │
│   ╰───────────────────────────────╯                     │
│                                                         │
│   assistant                                             │
│   ─────────                                             │
│   Markdown 渲染的回复…                                   │
│   ```ts                                                 │
│   highlight.js 代码块                                    │
│   ```                                                   │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  Composer  (sticky bottom, max-w-3xl 居中)               │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Type / for commands, @ for files…              │   │
│  │  ┌─────────────────────────────────────────────┐│   │
│  │  │ +  gpt-5.1-medium ▾  📎ChatView.tsx ×  ↑   ││   │
│  │  └─────────────────────────────────────────────┘│   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

- 没有 workspace chip
- user 消息：右对齐，灰底圆角胶囊；assistant 消息：左对齐，无背景，上方 `<span class="text-xs text-muted">assistant</span>` 标识
- streaming token 渲染：用 `requestAnimationFrame` 把每帧累积的 delta 一次性 setState（约 60fps 上限），避免每个 SSE 事件都触发 React commit 和 markdown 重解析；ReactMarkdown 组件用 `React.memo` 包一层防止稳定文本时的重复渲染
- 错误（`run_failed`）渲染成红字行 + Retry 按钮（保留现有行为）
- SlashMenu / MentionMenu：Radix `Popover`，锚定在 textarea 上方；键盘 ↑↓ Enter 选择，Esc 关闭
- 已附加的 context files 在输入框内底部一行小徽章 `📎 path × 删除`

### 视图：SettingsView

主区域换成 Settings，Sidebar 仍在，右栏隐藏。

```
┌──────────────────────────────────────────────────────┐
│  Settings                                            │
│  ┌──────────┬───────────────────────────────────┐   │
│  │ Providers│  Providers                        │   │
│  │ Models   │  ┌──────────────────────────────┐ │   │
│  │ About    │  │ Minimax        ●   [Edit]    │ │   │
│  │          │  │ OpenAI         ○   [Edit]    │ │   │
│  │          │  │ + Add provider               │ │   │
│  │          │  └──────────────────────────────┘ │   │
│  └──────────┴───────────────────────────────────┘   │
└──────────────────────────────────────────────────────┘
```

- 左侧二级 nav（vertical Tabs）：Providers / Models / About
- **Providers**：列表 + Add/Edit 按钮。Add/Edit 弹 shadcn `Dialog`（5+ 字段表单，结构性强，需要 modal）
  - 字段：`name`、`baseUrl`、`apiKey`（password input）、`defaultModel`
  - 读写：`api.listProviders` / `createProvider` / `updateProvider` / `deleteProvider`
  - 后端如未实现 CRUD，列表仍展示，按钮 disabled + tooltip "Not implemented yet"
- **Models**：每 provider 一个可展开 section，编辑候选 model 列表 + 默认 model
- **About**：版本号、health 状态、`Restart pi-server` 按钮（复用 `bridge.restartPiServer`）

### 右栏：DocumentPanel（仅 chat 视图）

```
┌──────────────────────────────────┐
│ [📄 README.md] [📄 App.tsx] [+] │  ← Tabs：已打开文件，× 关闭
├──────────────────────────────────┤
│  /apps/desktop/src/App.tsx  [📂]│  ← 路径条 + 文件树抽屉按钮
├──────────────────────────────────┤
│                                  │
│  文件内容（代码 / markdown 渲染） │
│                                  │
│  [Attach to chat]                │  ← 把当前文件加入 contextFiles
│                                  │
└──────────────────────────────────┘
```

抽屉打开（点 `[📂]`）：

```
┌──────────────────────────────────┐
│ [📄 README.md] [📄 App.tsx] [+] │
├────────────┬─────────────────────┤
│ Filter…    │  /apps/...App.tsx  │
│ > backend  │  …                 │
│ > docker   │  文件内容           │
│ > docs     │                    │
│ > frontend │                    │
│ ...        │                    │
└────────────┴─────────────────────┘
```

- Tabs 状态在 React 内存（关闭面板就丢，符合产品语义）；关闭最后一个 tab → 显示 "Open file" 空态
- 文件树用 `@pierre/trees/react`，shadow root 自带样式与 Tailwind 不冲突；路径列表来自 `api.listFiles(workspaceId, { recursive: true, maxDepth: 6 })`，本期不监听 fs 变更
- "+" 按钮 = 弹 shadcn `Command` 风格的 Combobox，与树共享同一 paths 数据源
- 内容渲染：
  - `.md` → `react-markdown` + `remark-gfm`
  - 代码 → 复用 chat 中的 highlight.js 组件（按需 `import` 语言：typescript、javascript、markdown、bash、json、yaml、xml）
  - 二进制 / 超大（>500KB）→ 占位 "File too large to preview, N bytes"
- 调 `api.readDocument(workspaceId, path)` 缓存（按 path key 的 Map，session 级别）
- "Attach to chat" → `store.addContextFile(path)`

### 数据流

**Zustand store**（`src/store/app-store.ts`）：

```ts
type AppView = 'new-thread' | 'chat' | 'settings';

interface AppState {
  view: AppView;
  locale: 'en' | 'zh';
  activeWorkspaceId: string | null;
  activeSessionId: string | null;
  pendingPrompt: string | null;        // NewThreadView 提交后留给 ChatView 自动发送
  contextFiles: string[];
  leftSidebarCollapsed: boolean;
  rightPanelCollapsed: boolean;

  setView(v: AppView): void;
  setLocale(v: 'en' | 'zh'): void;
  setActiveWorkspace(id: string | null): void;
  setActiveSession(id: string | null): void;
  setPendingPrompt(p: string | null): void;
  addContextFile(p: string): void;
  removeContextFile(p: string): void;
  clearContextFiles(): void;
  toggleLeftSidebar(): void;
  toggleRightPanel(): void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({ /* ... */ }),
    {
      name: 'marginalia-app',
      version: 1,
      partialize: (s) => ({
        activeWorkspaceId: s.activeWorkspaceId,
        locale: s.locale,
        leftSidebarCollapsed: s.leftSidebarCollapsed,
        rightPanelCollapsed: s.rightPanelCollapsed,
      }),
    }
  )
);
```

**重启时的状态**（明确决策）：

- `view` 不持久化 → 启动一律落到 `new-thread`，让用户清楚选择继续哪个 session
- `locale` 持久化 → 上次选择的英文 / 中文继续生效
- `activeSessionId` 不持久化 → 不会自动恢复正在进行的对话
- `activeWorkspaceId` 持久化 → 上次的 workspace 仍是默认选中（不存在了就回退到列表第一个或 null）
- `pendingPrompt` 不持久化 → 仅用于会话内 NewThread → Chat 的瞬时交接
- `contextFiles` 不持久化 → 进入新 session 应是干净状态

**Zustand 引入理由**：

- `contextFiles` 跨 5 层（DocumentPanel → AppShell → ChatView → Composer），prop drilling 痛
- `activeWorkspaceId` 被 Topbar / Sidebar / ChatView / DocumentPanel / NewThreadView / WorkspaceChip 共读
- Context 方案需要 2-3 个 Context + useMemo 避免雪崩 re-render；最终代码量不比 Zustand 少
- Zustand ~3KB，selector 天然防 re-render，可成长性好

**不进 store** 的状态（保持本地）：

- 服务器数据：`workspaces[]` / `sessions[]` / `messages[]` —— 自定义 hooks (`useWorkspaces` 等) 拉
- `streamingState`、`error` —— `useStreamingChat(sessionId)` 内
- `openDocumentTabs[]` / `activeTabPath` —— `<DocumentPanel>` 内
- `composerDraft` / `slashMenuOpen` / `mentionMenuOpen` —— `<Composer>` 内
- `providers[]` / `model` —— Composer 内 + Settings 内（各 useEffect 拉）

### i18n

首版使用轻量本地字典，不引入 i18next。所有用户可见文案、按钮 `aria-label`、toast、placeholder、错误占位都通过 `t(key)` 获取；开发调试文案可以保留英文，但不得出现在 production UI。

目录：

```
i18n/
  messages.ts          // en / zh 字典，使用 satisfies 校验 key 完整性
  useTranslation.ts    // 读取 store.locale，返回 t(key)
```

约束：

- 默认语言 `en`
- `locale` 存入 Zustand persist
- Sidebar 或 Settings 提供英文 / 中文切换入口；PR 2 先放在 Sidebar 底部，Settings 落地后可迁移
- 新增 UI 文案时必须同步更新 `en` 和 `zh` 字典
- 测试至少覆盖默认英文、切换中文、缺 key 时 typecheck 失败的静态约束

**ApiClient**（`apps/desktop/src/api/client.ts`）：签名保留。本期新增：

- `listFiles(workspaceId, { recursive: true, maxDepth: 6 })` —— 后端 `apps/pi-server/src/files/file-tree.ts` 已存在
- `getBranch(workspaceId)` —— 后端如未实现，方法 try-catch 返回 `null`，UI 隐藏 chip

### 工具链 / 依赖

新增：

```jsonc
{
  "tailwindcss": "^3.4",
  "autoprefixer": "^10",
  "postcss": "^8",
  "@radix-ui/react-dialog": "^1",
  "@radix-ui/react-dropdown-menu": "^2",
  "@radix-ui/react-popover": "^1",
  "@radix-ui/react-tabs": "^1",
  "@radix-ui/react-tooltip": "^1",
  "@radix-ui/react-scroll-area": "^1",
  "class-variance-authority": "^0.7",
  "clsx": "^2",
  "tailwind-merge": "^2",
  "lucide-react": "^0.460",
  "@pierre/trees": "^1.0.0-beta",
  "react-markdown": "^9",
  "remark-gfm": "^4",
  "highlight.js": "^11",
  "zustand": "^4.5",
  "sonner": "^1.5"
}
```

- shadcn/ui 通过其 CLI 把组件源码 *vendor* 到 `src/components/ui/`（不是 npm 依赖）
- `@pierre/trees` 用 shadow DOM 渲染，与 Tailwind 不冲突
- 不引入：zod（场景不足，见"非目标"说明）、SWR / TanStack Query（本地后端请求频率低）、Zustand devtools / immer middleware（暂不需要）

### 目录结构（`apps/desktop/src/`）

```
app/                   AppShell, Topbar, layout 持久化
sidebar/               Sidebar, WorkspaceTree, WorkspaceItem
chat/                  NewThreadView, ChatView, MessageStream, MessageItem
                       Composer/ (Composer.tsx, SlashMenu.tsx, MentionMenu.tsx,
                                  ModelPicker.tsx, WorkspaceChip.tsx, BranchChip.tsx)
documents/             DocumentPanel, DocumentTabs, DocumentTree (pierre),
                       DocumentViewer
settings/              SettingsView, ProvidersPane, ProviderEditDialog,
                       ModelsPane, AboutPane
store/                 app-store.ts
components/ui/         (shadcn vendored: button, dialog, input, popover,
                       dropdown-menu, tabs, tooltip, scroll-area, command,
                       sonner, ...)
hooks/                 useWorkspaces, useSessions, useMessages,
                       useStreamingChat, useFileTree
i18n/                  messages.ts, useTranslation.ts
lib/                   cn.ts, markdown.ts, highlight.ts
api/client.ts          基本不动（新增 listFiles / getBranch）
```

旧文件删除：

- `src/workspaces/WorkspaceShell.tsx` + 测试
- `src/chat/ChatView.tsx` + 测试（重写到 `src/chat/ChatView.tsx` 新版本）
- `src/documents/DocumentPanel.tsx` + 测试（重写到 `src/documents/DocumentPanel.tsx` 新版本）
- `src/styles.css` 重写为 Tailwind 入口

### Electron 主进程

`apps/desktop/electron/main.ts`：

```ts
const isMac = process.platform === 'darwin';
const win = new BrowserWindow({
  width: 1280, height: 800,
  minWidth: 960, minHeight: 600,
  titleBarStyle: isMac ? 'hiddenInset' : 'default',
  trafficLightPosition: isMac ? { x: 14, y: 14 } : undefined,
  backgroundColor: '#fafaf9',
  webPreferences: { /* unchanged */ }
});
```

Linux / Windows 下保留系统原生标题栏；Topbar 仍渲染，但红绿灯占位区不显示（Topbar 内部用 `process.platform === 'darwin'` 决定 padding-left）。

`preload.cts` 已暴露的 API 全部保留，不新增 IPC 通道。

### 失败 / 边缘场景

| 场景 | 行为 |
| --- | --- |
| pi-server health check 失败 | 现有 retry 流程保留，AppShell 在 `<main>` 区显示错误 + Retry 按钮，不渲染 view |
| pickWorkspaceDirectory 取消 | 静默返回，store 不动 |
| createWorkspace 失败（重名 / 路径无效）| `sonner` toast 错误信息，不切 active workspace |
| 无 workspace 时点 New chat | NewThreadView 渲染时 WorkspaceChip 显示 "Select workspace…"，禁用 Send 按钮 |
| streaming 中切换 session | 当前 stream 取消（abort fetch），切到新 session 重新拉 messages |
| readDocument 失败 | DocumentViewer 显示错误占位，tab 保留可关闭 |
| 文件树空 / listFiles 失败 | 树区显示 "No files" / 错误占位 |
| localStorage 中 `activeWorkspaceId` 指向已删除的 workspace | hook 校验后回退到第一个可用 workspace 或 null |
| `api.getBranch` 抛错（非 null 返回）| try-catch 当成 null 处理，BranchChip 隐藏，不影响主流程 |

### 测试策略

继续 Vitest + jsdom + Testing Library，不引入 Playwright。

**Commit gate**

每个 commit 前必须完成：

- TDD 闭环：对应任务的测试先失败，再实现到通过；纯配置任务至少要有可验证命令
- 运行该任务相关测试 + `pnpm --filter @marginalia/desktop typecheck`
- 对照本 spec 和当前 plan，确认测试覆盖了新增行为和边缘场景；如果 spec 改了，测试也要同 commit 更新
- UI 相关 commit 需要通过 Electron 窗口截图验证关键状态，截图路径写进 commit 前记录或 PR 描述；浏览器打开 Vite 页面不能替代 Electron 截图。无法截图时说明原因

**ModelPicker 复用**：NewThreadView 底栏和 ChatView Composer 底栏使用同一个 `<ModelPicker>` 组件（`src/chat/Composer/ModelPicker.tsx`），通过 `value/onChange` 控制；不写两份。

| 文件 | 命运 |
| --- | --- |
| `App.test.tsx` | 重写：health 失败显示 retry；server ready 后渲染 AppShell（不深入测 view 切换，view 切换归 `AppShell.test.tsx`） |
| `workspaces/WorkspaceShell.test.tsx` | **删除** |
| `chat/ChatView.test.tsx` | 重写：断言改可访问性查询（`getByRole('textbox', { name: /message/i })`）；保留 streaming / provider / mention 三个用例 |
| `documents/DocumentPanel.test.tsx` | 重写：tabs / tree drawer / attach to chat |
| 新增 `chat/NewThreadView.test.tsx` | hero 渲染、提交即创建 session 并切 view |
| 新增 `chat/Composer.test.tsx` | SlashMenu、MentionMenu、ModelPicker、submit |
| 新增 `sidebar/Sidebar.test.tsx` | workspace 列表、Settings 切 view、+ 新建 workspace（mock `window.marginalia.pickWorkspaceDirectory` 返回固定路径，断言 `api.createWorkspace` 被调） |
| 新增 `app/AppShell.test.tsx` | 左右栏折叠持久化（localStorage 写入）、view='settings' 主区域换 SettingsView、view='chat' 右栏显示 |
| 新增 `store/app-store.test.ts` | persist 字段 partialize、actions 行为 |
| 新增 `i18n/useTranslation.test.tsx` | 默认英文、切换中文、组件文案响应 locale |
| `api/client.test.ts` | 不动 |

## 实施排期

方案 A：一次性重写。拆 5 个 PR，每个 1-2 天，**可独立合并 + 每个 PR 后 `pnpm dev` 必须能跑**。

为了保证每个 PR 都是可运行状态，**所有 PR 必须使用同一套新组件**——不能"PR 2 用新 Shell + 旧 WorkspaceShell"这种混搭，因为旧 WorkspaceShell 的 props 是 prop drilling 模型，与新 store-driven 模型不兼容。过渡方案如下：

| # | 内容 | 过渡占位 |
| - | --- | --- |
| 1 | Tailwind + shadcn init + lucide + sonner + Zustand store + i18n 基础。Tailwind 在 PR 1 关闭 preflight，**不改任何视觉**，旧 `App.tsx` + 旧 `WorkspaceShell` 继续渲染。Zustand store 和 i18n 在本 PR 仅创建文件并 export，无组件消费它 | 无 |
| 2 | 新 `AppShell` 替换 `App.tsx` 的根渲染（保留 health 检测和 server 启动逻辑）+ 新 Sidebar + 新 Topbar + macOS `hiddenInset`。**主区域先放占位空态**：主区域写 `<MainPlaceholder/>` 一个"Chat coming next PR"卡片；右栏在 `chat` view 显示 `<DocumentPanelPlaceholder/>`，其他 view 隐藏。**旧 WorkspaceShell / 旧 ChatView / 旧 DocumentPanel 在本 PR 内整体删除**（不再 import） | 主区域 / 右栏 = 占位组件 |
| 3 | 新 NewThreadView + ChatView + Composer（含 SlashMenu / MentionMenu / ModelPicker），替换 PR 2 的 `<MainPlaceholder/>`。右栏仍是占位 `<DocumentPanelPlaceholder/>`（"Document panel coming next PR"） | 右栏 = 占位组件 |
| 4 | 新 DocumentPanel（tabs + pierre tree + viewer + attach），替换右栏占位。删除 `<DocumentPanelPlaceholder/>` | 无 |
| 5 | 新 SettingsView（Providers / Models / About）+ 补全测试。删除 `<MainPlaceholder/>` 如果还在 | 无 |

关键约束：

- **PR 2 一次性删除三个旧组件**，因为它们之间互相依赖且与新 store 模型不兼容。这是把"PR 2/3/4 衔接断裂"问题压成"PR 2 内一次性切断"的关键决策
- 占位组件就放在 `src/app/placeholders.tsx`，PR 4 / PR 5 完成后随之删除
- `MainPlaceholder` 渲染："功能开发中" + 当前 `view` 调试信息（仅 dev mode），避免给 reviewer 留死气沉沉的空白
- 每个 PR 必须保证：
  - `pnpm typecheck` 通过
  - `pnpm test` 通过（被删的测试同 PR 删除，新测试同 PR 加）
  - 每个 commit 前完成 TDD 测试、spec/测试对照检查、关键 UI 截图验证（UI commit 必须使用 Electron 截图）
  - `pnpm dev` 可启动且不报错；至少能创建 workspace、切换 view（即使主区域是占位）
  - 该 PR 视觉变化部分在浏览器里手动验证

## 风险

- **shadcn vendor 的组件数量难预估**：可能在实施中发现还需要 Sheet / Toaster / ContextMenu 等，需要现加。预留缓冲。
- **@pierre/trees 与 React 18 + Vite 兼容性未验证**：实施第一步先建 minimal 例子跑通；若 shadow root 与 Vite HMR 有冲突，退路是用裸 `<ul>` 自渲染（功能降级，开发量增加约半天）。
- **streaming markdown 性能**：每个 token 重解析 markdown 可能卡 UI。`useDeferredValue` + 节流是默认方案；若仍有问题，退路是 streaming 期间用 `<pre>` 显示纯文本，结束后切回 markdown。
- **macOS hiddenInset 在 dev 模式 vite host 模式下可能样式异常**：第一步连同验证。

## Open questions

- WorkspaceChip 下拉中的 workspace 顺序：按创建时间倒序，还是支持手动拖拽？本期默认创建时间倒序，pi-gui 的拖拽留 v2。
- 模型选择器记忆每 session 的选择：**已确认**——`session.model` 字段在 `apps/pi-server/src/db/repositories.ts:21` 已存在且 `updateSession` 支持写入，按 session 持久化（不变更现有行为）。
- 多窗口支持？本期单窗口；store 不考虑多窗口同步。
