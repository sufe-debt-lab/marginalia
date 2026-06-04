# Codex UI 重写 · PR 2: AppShell + Topbar + Sidebar

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用新的 AppShell（三栏可折叠）+ Topbar（macOS drag + 折叠按钮）+ Sidebar（workspace 列表 + New chat + Settings + 新建 workspace + 英文/中文切换）替换旧 `App.tsx` 的根渲染，并在 macOS 启用 `hiddenInset`。主区域暂用占位组件；右栏只在 `chat` view 显示占位。一次性删除旧 `WorkspaceShell.tsx`、`chat/ChatView.tsx`、`documents/DocumentPanel.tsx`（含测试）。本 PR 后 UI 视觉完全换新，但消息流、文档面板、设置都还是占位。

**Architecture:** AppShell 用 Zustand 读 view + 折叠状态决定布局。Sidebar 用 `useWorkspaces` 自定义 hook 拉 workspaces，并校验持久化的 `activeWorkspaceId`；每条 workspace 展开后用 `useSessions(workspaceId)` 拉 sessions。Topbar 按钮调 store 的 toggle actions。新建 workspace 直接走 `pickWorkspaceDirectory` + `createWorkspace`，失败用 sonner toast。所有用户可见文案通过 PR 1 的 `useTranslation().t()` 获取。

**Tech Stack:** React 18, Zustand store from PR 1, shadcn (Button, Tooltip, ScrollArea), lucide-react icons, sonner toast。

**Spec reference:** § 三栏壳层, § 视图, § i18n, § Electron 主进程, § 失败 / 边缘场景（pickWorkspaceDirectory 取消、createWorkspace 失败、空 workspace 时点 New chat、activeWorkspaceId 回退、health 失败）。

**Commit gate:** 每个 commit 前必须完成 TDD 闭环：相关测试先失败，再实现到通过；随后运行相关测试和 `pnpm --filter @marginalia/desktop typecheck`。提交前对照 spec 和本 plan，确认测试覆盖新增行为和边缘场景。涉及 UI 的 commit 必须启动 Electron dev 窗口做截图验证；截图至少覆盖英文和中文各一个关键状态，路径写入 PR 记录或 commit 前记录。浏览器打开 Vite 页面不能替代 Electron 截图验收。

---

## File Structure

新建：
- `apps/desktop/src/app/AppShell.tsx` — 三栏 grid 布局，读 store 决定左右栏宽度
- `apps/desktop/src/app/AppShell.test.tsx`
- `apps/desktop/src/app/Topbar.tsx` — 顶栏（drag 区域、左/右栏切换按钮、active 标题、Settings 入口）
- `apps/desktop/src/app/Topbar.test.tsx`
- `apps/desktop/src/app/placeholders.tsx` — `MainPlaceholder` + `DocumentPanelPlaceholder`
- `apps/desktop/src/sidebar/Sidebar.tsx` — 顶部入口 + workspaces 区 + 底部 Settings
- `apps/desktop/src/sidebar/Sidebar.test.tsx`
- `apps/desktop/src/sidebar/WorkspaceTree.tsx` — 单个 workspace + sessions 折叠树
- `apps/desktop/src/sidebar/WorkspaceTree.test.tsx`
- `apps/desktop/src/hooks/useWorkspaces.ts`
- `apps/desktop/src/hooks/useWorkspaces.test.ts`
- `apps/desktop/src/hooks/useSessions.ts`
- `apps/desktop/src/hooks/useSessions.test.ts`
- `apps/desktop/src/hooks/useApi.ts` — 单例 `ApiClient` provider/hook（接收 serverUrl）

修改：
- `apps/desktop/src/App.tsx` — 改为只做 health 检测 + 在 ready 时渲染 `<AppShell serverUrl={...} />`
- `apps/desktop/src/App.test.tsx` — 重写
- `apps/desktop/electron/main.ts` — 启用 macOS `hiddenInset`，与 Topbar 同 PR 落地

删除：
- `apps/desktop/src/workspaces/WorkspaceShell.tsx`
- `apps/desktop/src/workspaces/WorkspaceShell.test.tsx`
- `apps/desktop/src/chat/ChatView.tsx`
- `apps/desktop/src/chat/ChatView.test.tsx`
- `apps/desktop/src/documents/DocumentPanel.tsx`
- `apps/desktop/src/documents/DocumentPanel.test.tsx`

---

## Task 1: ApiClient 单例 hook

**Files:**
- Create: `apps/desktop/src/hooks/useApi.ts`

- [ ] **Step 1: 实现 useApi**

Create `apps/desktop/src/hooks/useApi.ts`:

```ts
import { useMemo } from "react";
import { ApiClient } from "@/api/client.js";

export function useApi(serverUrl: string): ApiClient {
  return useMemo(() => new ApiClient(serverUrl), [serverUrl]);
}
```

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @marginalia/desktop typecheck`

Expected: 通过。

- [ ] **Step 3: Commit**

Run:
```bash
git add apps/desktop/src/hooks/useApi.ts
git commit -m "feat(desktop): add useApi hook for memoized ApiClient"
```

---

## Task 2: useWorkspaces hook

**Files:**
- Create: `apps/desktop/src/hooks/useWorkspaces.ts`
- Create: `apps/desktop/src/hooks/useWorkspaces.test.ts`

- [ ] **Step 1: 写测试**

Create `apps/desktop/src/hooks/useWorkspaces.test.ts`:

```ts
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient, Workspace } from "@/api/client.js";
import { useWorkspaces } from "./useWorkspaces.js";

function fakeApi(workspaces: Workspace[]): ApiClient {
  return {
    listWorkspaces: vi.fn(async () => workspaces),
    createWorkspace: vi.fn(async (input) => ({ id: "new", ...input }))
  } as unknown as ApiClient;
}

describe("useWorkspaces", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads workspaces on mount", async () => {
    const api = fakeApi([{ id: "a", name: "A", rootDir: "/a" }]);
    const { result } = renderHook(() => useWorkspaces(api));
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data[0].name).toBe("A");
    expect(result.current.loading).toBe(false);
  });

  it("creates a workspace and prepends to list", async () => {
    const api = fakeApi([{ id: "a", name: "A", rootDir: "/a" }]);
    const { result } = renderHook(() => useWorkspaces(api));
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    await act(async () => {
      await result.current.create({ name: "B", rootDir: "/b" });
    });
    expect(result.current.data.map((w) => w.name)).toEqual(["B", "A"]);
  });
});
```

- [ ] **Step 2: 运行测试看失败**

Run: `pnpm --filter @marginalia/desktop test -- useWorkspaces`

Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现**

Create `apps/desktop/src/hooks/useWorkspaces.ts`:

```ts
import { useCallback, useEffect, useState } from "react";
import type { ApiClient, Workspace } from "@/api/client.js";

export function useWorkspaces(api: ApiClient) {
  const [data, setData] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .listWorkspaces()
      .then((items) => {
        if (active) {
          setData(items);
          setError(null);
        }
      })
      .catch((err: Error) => {
        if (active) setError(err);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api]);

  const create = useCallback(
    async (input: { name: string; rootDir: string }) => {
      const created = await api.createWorkspace(input);
      setData((items) => [created, ...items]);
      return created;
    },
    [api]
  );

  return { data, loading, error, create };
}
```

- [ ] **Step 4: 测试通过**

Run: `pnpm --filter @marginalia/desktop test -- useWorkspaces`

Expected: PASS（2 个用例）。

- [ ] **Step 5: Commit**

Run:
```bash
git add apps/desktop/src/hooks/useWorkspaces.ts apps/desktop/src/hooks/useWorkspaces.test.ts
git commit -m "feat(desktop): add useWorkspaces hook"
```

---

## Task 3: useSessions hook

**Files:**
- Create: `apps/desktop/src/hooks/useSessions.ts`
- Create: `apps/desktop/src/hooks/useSessions.test.ts`

- [ ] **Step 1: 写测试**

Create `apps/desktop/src/hooks/useSessions.test.ts`:

```ts
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient, Session } from "@/api/client.js";
import { useSessions } from "./useSessions.js";

function fakeApi(sessions: Session[]): ApiClient {
  return {
    listSessions: vi.fn(async () => sessions),
    createSession: vi.fn(async (input) => ({
      id: "new",
      workspaceId: input.workspaceId,
      title: input.title,
      origin: "ui",
      model: null
    }))
  } as unknown as ApiClient;
}

describe("useSessions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads sessions for workspaceId", async () => {
    const api = fakeApi([
      { id: "s1", workspaceId: "w", title: "first", origin: "ui", model: null }
    ]);
    const { result } = renderHook(() => useSessions(api, "w"));
    await waitFor(() => expect(result.current.data).toHaveLength(1));
  });

  it("returns empty list when workspaceId is null", async () => {
    const api = fakeApi([]);
    const { result } = renderHook(() => useSessions(api, null));
    expect(result.current.data).toEqual([]);
    expect(api.listSessions).not.toHaveBeenCalled();
  });

  it("creates a session and prepends", async () => {
    const api = fakeApi([
      { id: "s1", workspaceId: "w", title: "first", origin: "ui", model: null }
    ]);
    const { result } = renderHook(() => useSessions(api, "w"));
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    await act(async () => {
      await result.current.create("new title");
    });
    expect(result.current.data.map((s) => s.title)).toEqual(["new title", "first"]);
  });
});
```

- [ ] **Step 2: 运行测试看失败**

Run: `pnpm --filter @marginalia/desktop test -- useSessions`

Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现**

Create `apps/desktop/src/hooks/useSessions.ts`:

```ts
import { useCallback, useEffect, useState } from "react";
import type { ApiClient, Session } from "@/api/client.js";

export function useSessions(api: ApiClient, workspaceId: string | null) {
  const [data, setData] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!workspaceId) {
      setData([]);
      return;
    }
    let active = true;
    setLoading(true);
    api
      .listSessions(workspaceId)
      .then((items) => {
        if (active) {
          setData(items);
          setError(null);
        }
      })
      .catch((err: Error) => {
        if (active) setError(err);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, workspaceId]);

  const create = useCallback(
    async (title: string) => {
      if (!workspaceId) throw new Error("workspaceId required");
      const created = await api.createSession({ workspaceId, title });
      setData((items) => [created, ...items]);
      return created;
    },
    [api, workspaceId]
  );

  return { data, loading, error, create };
}
```

- [ ] **Step 4: 测试通过**

Run: `pnpm --filter @marginalia/desktop test -- useSessions`

Expected: PASS（3 个用例）。

- [ ] **Step 5: Commit**

Run:
```bash
git add apps/desktop/src/hooks/useSessions.ts apps/desktop/src/hooks/useSessions.test.ts
git commit -m "feat(desktop): add useSessions hook"
```

---

## Task 4: Placeholders 组件

**Files:**
- Create: `apps/desktop/src/app/placeholders.tsx`

- [ ] **Step 1: 实现**

Create `apps/desktop/src/app/placeholders.tsx`:

```tsx
import { useTranslation } from "@/i18n/useTranslation.js";

export function MainPlaceholder({ view }: { view: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full items-center justify-center">
      <div className="rounded-lg border border-dashed border-border bg-card px-6 py-8 text-center text-sm text-muted-foreground">
        <p className="font-medium text-foreground">{t("placeholders.comingNextPr")}</p>
        <p className="mt-1">{t("placeholders.currentView")}: <code className="rounded bg-muted px-1.5 py-0.5">{view}</code></p>
      </div>
    </div>
  );
}

export function DocumentPanelPlaceholder() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      {t("placeholders.documentPanelComing")}
    </div>
  );
}
```

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @marginalia/desktop typecheck`

Expected: 通过。

- [ ] **Step 3: Commit**

Run:
```bash
git add apps/desktop/src/app/placeholders.tsx
git commit -m "feat(desktop): add main + document panel placeholders"
```

---

## Task 5: Topbar

**Files:**
- Create: `apps/desktop/src/app/Topbar.tsx`
- Create: `apps/desktop/src/app/Topbar.test.tsx`

- [ ] **Step 1: 写测试**

Create `apps/desktop/src/app/Topbar.test.tsx`:

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "@/store/app-store.js";
import { Topbar } from "./Topbar.js";

describe("Topbar", () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    useAppStore.setState({
      view: "new-thread",
      locale: "en",
      activeWorkspaceId: null,
      activeSessionId: null,
      pendingPrompt: null,
      contextFiles: [],
      leftSidebarCollapsed: false,
      rightPanelCollapsed: false
    });
  });

  it("renders a title from the active session or workspace name", () => {
    render(<Topbar title="my-workspace" />);
    expect(screen.getByText("my-workspace")).toBeInTheDocument();
  });

  it("toggles left sidebar", async () => {
    render(<Topbar title="" />);
    await userEvent.click(screen.getByRole("button", { name: /toggle left sidebar/i }));
    expect(useAppStore.getState().leftSidebarCollapsed).toBe(true);
  });

  it("toggles right panel only when view=chat", async () => {
    render(<Topbar title="" />);
    expect(screen.queryByRole("button", { name: /toggle right panel/i })).toBeNull();
    useAppStore.setState({ view: "chat" });
    cleanup();
    render(<Topbar title="" />);
    await userEvent.click(screen.getByRole("button", { name: /toggle right panel/i }));
    expect(useAppStore.getState().rightPanelCollapsed).toBe(true);
  });
});
```

- [ ] **Step 2: 测试失败**

Run: `pnpm --filter @marginalia/desktop test -- Topbar`

Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现**

Create `apps/desktop/src/app/Topbar.tsx`:

```tsx
import { PanelLeft, PanelRight } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { useAppStore } from "@/store/app-store.js";
import { cn } from "@/lib/cn.js";

const isMac = typeof process !== "undefined" && process.platform === "darwin";

export function Topbar({ title }: { title: string }) {
  const { t } = useTranslation();
  const view = useAppStore((s) => s.view);
  const toggleLeft = useAppStore((s) => s.toggleLeftSidebar);
  const toggleRight = useAppStore((s) => s.toggleRightPanel);

  return (
    <header
      className={cn(
        "app-drag flex h-11 items-center gap-2 border-b border-border bg-background px-3",
        isMac && "pl-[88px]"
      )}
    >
      <Button
        variant="ghost"
        size="icon"
        className="app-no-drag h-8 w-8"
        aria-label={t("common.toggleLeftSidebar")}
        onClick={toggleLeft}
      >
        <PanelLeft className="h-4 w-4" />
      </Button>
      <div className="flex-1 truncate text-sm font-medium text-foreground/80">{title}</div>
      {view === "chat" && (
        <Button
          variant="ghost"
          size="icon"
          className="app-no-drag h-8 w-8"
          aria-label={t("common.toggleRightPanel")}
          onClick={toggleRight}
        >
          <PanelRight className="h-4 w-4" />
        </Button>
      )}
    </header>
  );
}
```

- [ ] **Step 4: 测试通过**

Run: `pnpm --filter @marginalia/desktop test -- Topbar`

Expected: PASS（3 个用例）。

- [ ] **Step 5: Commit**

Run:
```bash
git add apps/desktop/src/app/Topbar.tsx apps/desktop/src/app/Topbar.test.tsx
git commit -m "feat(desktop): add topbar with drag region and sidebar toggles"
```

---

## Task 6: WorkspaceTree 组件

**Files:**
- Create: `apps/desktop/src/sidebar/WorkspaceTree.tsx`
- Create: `apps/desktop/src/sidebar/WorkspaceTree.test.tsx`

- [ ] **Step 1: 写测试**

Create `apps/desktop/src/sidebar/WorkspaceTree.test.tsx`:

```tsx
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient, Workspace } from "@/api/client.js";
import { useAppStore } from "@/store/app-store.js";
import { WorkspaceTree } from "./WorkspaceTree.js";

function fakeApi(): ApiClient {
  return {
    listSessions: vi.fn(async () => [
      { id: "s1", workspaceId: "w", title: "first", origin: "ui", model: null },
      { id: "s2", workspaceId: "w", title: "second", origin: "ui", model: null }
    ])
  } as unknown as ApiClient;
}

const workspace: Workspace = { id: "w", name: "demo", rootDir: "/x" };

describe("WorkspaceTree", () => {
  beforeEach(() => {
    cleanup();
    useAppStore.setState({
      activeWorkspaceId: null,
      activeSessionId: null,
      view: "new-thread",
      locale: "en",
      pendingPrompt: null,
      contextFiles: [],
      leftSidebarCollapsed: false,
      rightPanelCollapsed: false
    });
  });

  it("renders workspace name and expands to show sessions on click", async () => {
    render(<WorkspaceTree api={fakeApi()} workspace={workspace} />);
    await userEvent.click(screen.getByRole("button", { name: /demo/i }));
    await waitFor(() => expect(screen.getByText("first")).toBeInTheDocument());
    expect(screen.getByText("second")).toBeInTheDocument();
  });

  it("selecting a session updates store", async () => {
    render(<WorkspaceTree api={fakeApi()} workspace={workspace} />);
    await userEvent.click(screen.getByRole("button", { name: /demo/i }));
    await waitFor(() => screen.getByText("first"));
    await userEvent.click(screen.getByText("first"));
    expect(useAppStore.getState().activeWorkspaceId).toBe("w");
    expect(useAppStore.getState().activeSessionId).toBe("s1");
    expect(useAppStore.getState().view).toBe("chat");
  });
});
```

- [ ] **Step 2: 测试失败**

Run: `pnpm --filter @marginalia/desktop test -- WorkspaceTree`

Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现**

Create `apps/desktop/src/sidebar/WorkspaceTree.tsx`:

```tsx
import { useState } from "react";
import { ChevronRight, Folder } from "lucide-react";
import type { ApiClient, Workspace } from "@/api/client.js";
import { useSessions } from "@/hooks/useSessions.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { useAppStore } from "@/store/app-store.js";
import { cn } from "@/lib/cn.js";

export function WorkspaceTree({ api, workspace }: { api: ApiClient; workspace: Workspace }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const sessions = useSessions(api, expanded ? workspace.id : null);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setActiveWorkspace = useAppStore((s) => s.setActiveWorkspace);
  const setView = useAppStore((s) => s.setView);

  function selectSession(sessionId: string) {
    setActiveWorkspace(workspace.id);
    setActiveSession(sessionId);
    setView("chat");
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-sm text-foreground/80 hover:bg-accent"
      >
        <ChevronRight
          className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-90")}
        />
        <Folder className="h-3.5 w-3.5" />
        <span className="truncate">{workspace.name}</span>
      </button>
      {expanded && (
        <ul className="ml-6 mt-0.5 space-y-0.5">
          {sessions.loading && <li className="px-2 py-1 text-xs text-muted-foreground">{t("common.loading")}</li>}
          {!sessions.loading && sessions.data.length === 0 && (
            <li className="px-2 py-1 text-xs text-muted-foreground">{t("common.noChats")}</li>
          )}
          {sessions.data.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => selectSession(s.id)}
                className={cn(
                  "w-full truncate rounded px-2 py-1 text-left text-sm text-foreground/70 hover:bg-accent",
                  activeSessionId === s.id && "bg-accent text-foreground"
                )}
              >
                {s.title || t("common.untitled")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 测试通过**

Run: `pnpm --filter @marginalia/desktop test -- WorkspaceTree`

Expected: PASS（2 个用例）。

- [ ] **Step 5: Commit**

Run:
```bash
git add apps/desktop/src/sidebar/WorkspaceTree.tsx apps/desktop/src/sidebar/WorkspaceTree.test.tsx
git commit -m "feat(desktop): add WorkspaceTree expandable item with sessions"
```

---

## Task 7: Sidebar

**Files:**
- Create: `apps/desktop/src/sidebar/Sidebar.tsx`
- Create: `apps/desktop/src/sidebar/Sidebar.test.tsx`

- [ ] **Step 1: 写测试**

Create `apps/desktop/src/sidebar/Sidebar.test.tsx`:

```tsx
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/api/client.js";
import { useAppStore } from "@/store/app-store.js";
import { Sidebar } from "./Sidebar.js";

function fakeApi(): ApiClient {
  return {
    listWorkspaces: vi.fn(async () => [
      { id: "w1", name: "alpha", rootDir: "/a" }
    ]),
    createWorkspace: vi.fn(async (input) => ({ id: "new", ...input }))
  } as unknown as ApiClient;
}

describe("Sidebar", () => {
  beforeEach(() => {
    cleanup();
    useAppStore.setState({
      view: "new-thread",
      locale: "en",
      activeWorkspaceId: null,
      activeSessionId: null,
      pendingPrompt: null,
      contextFiles: [],
      leftSidebarCollapsed: false,
      rightPanelCollapsed: false
    });
    window.marginalia = {
      getPiServerStatus: vi.fn(),
      restartPiServer: vi.fn(),
      pickWorkspaceDirectory: vi.fn(async () => "/picked/path")
    };
  });

  it("clicking New chat sets view to new-thread", async () => {
    useAppStore.setState({ view: "settings" });
    render(<Sidebar api={fakeApi()} />);
    await userEvent.click(screen.getByRole("button", { name: /new chat/i }));
    expect(useAppStore.getState().view).toBe("new-thread");
  });

  it("clicking Settings sets view to settings", async () => {
    render(<Sidebar api={fakeApi()} />);
    await userEvent.click(screen.getByRole("button", { name: /settings/i }));
    expect(useAppStore.getState().view).toBe("settings");
  });

  it("lists workspaces from api", async () => {
    render(<Sidebar api={fakeApi()} />);
    await waitFor(() => expect(screen.getByText("alpha")).toBeInTheDocument());
  });

  it("falls back to the first workspace when persisted activeWorkspaceId is missing", async () => {
    useAppStore.setState({ activeWorkspaceId: "deleted" });
    render(<Sidebar api={fakeApi()} />);
    await waitFor(() => expect(useAppStore.getState().activeWorkspaceId).toBe("w1"));
  });

  it("switches language to Chinese", async () => {
    render(<Sidebar api={fakeApi()} />);
    await userEvent.click(screen.getByRole("button", { name: /中文/i }));
    expect(screen.getByRole("button", { name: "新建聊天" })).toBeInTheDocument();
  });

  it("plus button picks a directory and creates a workspace", async () => {
    const api = fakeApi();
    render(<Sidebar api={api} />);
    await waitFor(() => screen.getByText("alpha"));
    await userEvent.click(screen.getByRole("button", { name: /new workspace/i }));
    await waitFor(() => expect(api.createWorkspace).toHaveBeenCalledWith({ name: "path", rootDir: "/picked/path" }));
  });

  it("plus button: when picker cancels, no create call", async () => {
    const api = fakeApi();
    window.marginalia!.pickWorkspaceDirectory = vi.fn(async () => null);
    render(<Sidebar api={api} />);
    await waitFor(() => screen.getByText("alpha"));
    await userEvent.click(screen.getByRole("button", { name: /new workspace/i }));
    expect(api.createWorkspace).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 测试失败**

Run: `pnpm --filter @marginalia/desktop test -- Sidebar`

Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现**

Create `apps/desktop/src/sidebar/Sidebar.tsx`:

```tsx
import { useEffect } from "react";
import { Languages, PenSquare, Plus, Settings } from "lucide-react";
import { toast } from "sonner";
import type { ApiClient } from "@/api/client.js";
import { Button } from "@/components/ui/button.js";
import { ScrollArea } from "@/components/ui/scroll-area.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { useWorkspaces } from "@/hooks/useWorkspaces.js";
import { useAppStore } from "@/store/app-store.js";
import { cn } from "@/lib/cn.js";
import { WorkspaceTree } from "./WorkspaceTree.js";

function basename(p: string): string {
  const trimmed = p.replace(/\/+$/, "");
  return trimmed.split("/").pop() || trimmed || "workspace";
}

export function Sidebar({ api }: { api: ApiClient }) {
  const { locale, t } = useTranslation();
  const workspaces = useWorkspaces(api);
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setLocale = useAppStore((s) => s.setLocale);
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
  const setActiveWorkspace = useAppStore((s) => s.setActiveWorkspace);

  useEffect(() => {
    if (workspaces.loading) return;
    const exists = workspaces.data.some((w) => w.id === activeWorkspaceId);
    if (!activeWorkspaceId || !exists) {
      setActiveWorkspace(workspaces.data[0]?.id ?? null);
    }
  }, [activeWorkspaceId, setActiveWorkspace, workspaces.data, workspaces.loading]);

  async function newWorkspace() {
    const picked = await window.marginalia?.pickWorkspaceDirectory?.();
    if (!picked) return;
    try {
      const created = await workspaces.create({ name: basename(picked), rootDir: picked });
      useAppStore.getState().setActiveWorkspace(created.id);
      toast.success(`${t("toast.workspaceCreated")}: ${created.name}`);
    } catch (err) {
      toast.error(`${t("toast.createWorkspaceFailed")}: ${(err as Error).message}`);
    }
  }

  function newChat() {
    setActiveSession(null);
    setView("new-thread");
  }

  return (
    <aside className="flex h-full flex-col border-r border-border bg-muted/30">
      <div className="space-y-1 p-2">
        <Button
          variant="ghost"
          className="w-full justify-start gap-2"
          onClick={newChat}
          aria-label={t("common.newChat")}
        >
          <PenSquare className="h-4 w-4" />
          {t("common.newChat")}
        </Button>
      </div>
      <div className="flex items-center justify-between px-3 pt-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        <span>{t("common.workspaces")}</span>
        <button
          type="button"
          onClick={newWorkspace}
          aria-label={t("common.newWorkspace")}
          className="rounded p-1 hover:bg-accent"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <ScrollArea className="flex-1 px-2 pb-2">
        <div className="space-y-0.5 pt-1">
          {workspaces.loading && (
            <p className="px-2 py-1 text-xs text-muted-foreground">{t("common.loading")}</p>
          )}
          {!workspaces.loading && workspaces.data.length === 0 && (
            <p className="px-2 py-1 text-xs text-muted-foreground">{t("common.noWorkspaces")}</p>
          )}
          {workspaces.data.map((w) => (
            <WorkspaceTree key={w.id} api={api} workspace={w} />
          ))}
        </div>
      </ScrollArea>
      <div className="border-t border-border p-2">
        <Button
          variant="ghost"
          className="mb-1 w-full justify-start gap-2"
          onClick={() => setLocale(locale === "en" ? "zh" : "en")}
          aria-label={t("common.language")}
        >
          <Languages className="h-4 w-4" />
          {locale === "en" ? t("common.chinese") : t("common.english")}
        </Button>
        <Button
          variant="ghost"
          className={cn("w-full justify-start gap-2", view === "settings" && "bg-accent")}
          onClick={() => setView("settings")}
          aria-label={t("common.settings")}
        >
          <Settings className="h-4 w-4" />
          {t("common.settings")}
        </Button>
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: 测试通过**

Run: `pnpm --filter @marginalia/desktop test -- Sidebar`

Expected: PASS（5 个用例）。

- [ ] **Step 5: Commit**

Run:
```bash
git add apps/desktop/src/sidebar/Sidebar.tsx apps/desktop/src/sidebar/Sidebar.test.tsx
git commit -m "feat(desktop): add sidebar with new-chat / workspaces / settings"
```

---

## Task 8: AppShell

**Files:**
- Create: `apps/desktop/src/app/AppShell.tsx`
- Create: `apps/desktop/src/app/AppShell.test.tsx`

- [ ] **Step 1: 写测试**

Create `apps/desktop/src/app/AppShell.test.tsx`:

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@/store/app-store.js";
import { AppShell } from "./AppShell.js";

describe("AppShell", () => {
  beforeEach(() => {
    cleanup();
    useAppStore.setState({
      view: "new-thread",
      locale: "en",
      activeWorkspaceId: null,
      activeSessionId: null,
      pendingPrompt: null,
      contextFiles: [],
      leftSidebarCollapsed: false,
      rightPanelCollapsed: false
    });
    global.fetch = vi.fn(async () => new Response("[]", { headers: { "content-type": "application/json" } }));
    window.marginalia = {
      getPiServerStatus: vi.fn(),
      restartPiServer: vi.fn()
    };
  });

  it("renders three panels: sidebar, main, right (right hidden when not chat)", () => {
    render(<AppShell serverUrl="http://x" />);
    expect(screen.getByRole("complementary", { name: /sidebar/i })).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: /document panel/i })).toBeNull();
  });

  it("shows right panel when view is chat", () => {
    useAppStore.setState({ view: "chat" });
    render(<AppShell serverUrl="http://x" />);
    expect(screen.getByRole("complementary", { name: /document panel/i })).toBeInTheDocument();
  });

  it("hides sidebar when leftSidebarCollapsed", () => {
    useAppStore.setState({ leftSidebarCollapsed: true });
    render(<AppShell serverUrl="http://x" />);
    expect(screen.queryByRole("complementary", { name: /sidebar/i })).toBeNull();
  });

  it("toggle persists to localStorage", async () => {
    render(<AppShell serverUrl="http://x" />);
    await userEvent.click(screen.getByRole("button", { name: /toggle left sidebar/i }));
    const stored = JSON.parse(localStorage.getItem("marginalia-app") || "{}");
    expect(stored.state?.leftSidebarCollapsed).toBe(true);
  });
});
```

- [ ] **Step 2: 测试失败**

Run: `pnpm --filter @marginalia/desktop test -- AppShell`

Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现**

Create `apps/desktop/src/app/AppShell.tsx`:

```tsx
import { useApi } from "@/hooks/useApi.js";
import { useAppStore } from "@/store/app-store.js";
import { cn } from "@/lib/cn.js";
import { Sidebar } from "@/sidebar/Sidebar.js";
import { Topbar } from "./Topbar.js";
import { MainPlaceholder, DocumentPanelPlaceholder } from "./placeholders.js";

export function AppShell({ serverUrl }: { serverUrl: string }) {
  const api = useApi(serverUrl);
  const view = useAppStore((s) => s.view);
  const leftCollapsed = useAppStore((s) => s.leftSidebarCollapsed);
  const rightCollapsed = useAppStore((s) => s.rightPanelCollapsed);
  const showRight = view === "chat" && !rightCollapsed;

  return (
    <div className="flex h-screen flex-col">
      <Topbar title="" />
      <div
        className={cn(
          "grid flex-1 overflow-hidden",
          leftCollapsed && showRight && "grid-cols-[1fr_320px]",
          leftCollapsed && !showRight && "grid-cols-[1fr]",
          !leftCollapsed && showRight && "grid-cols-[240px_1fr_320px]",
          !leftCollapsed && !showRight && "grid-cols-[240px_1fr]"
        )}
      >
        {!leftCollapsed && (
          <aside aria-label="Sidebar" className="overflow-hidden">
            <Sidebar api={api} />
          </aside>
        )}
        <main className="overflow-hidden bg-background">
          <MainPlaceholder view={view} />
        </main>
        {showRight && (
          <aside aria-label="Document panel" className="overflow-hidden border-l border-border">
            <DocumentPanelPlaceholder />
          </aside>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 测试通过**

Run: `pnpm --filter @marginalia/desktop test -- AppShell`

Expected: PASS（4 个用例）。

- [ ] **Step 5: Commit**

Run:
```bash
git add apps/desktop/src/app/AppShell.tsx apps/desktop/src/app/AppShell.test.tsx
git commit -m "feat(desktop): add three-pane AppShell with toggleable sidebars"
```

---

## Task 9: 重写 App.tsx 并删除旧组件

**Files:**
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/App.test.tsx`
- Delete: `apps/desktop/src/workspaces/WorkspaceShell.tsx`
- Delete: `apps/desktop/src/workspaces/WorkspaceShell.test.tsx`
- Delete: `apps/desktop/src/chat/ChatView.tsx`
- Delete: `apps/desktop/src/chat/ChatView.test.tsx`
- Delete: `apps/desktop/src/documents/DocumentPanel.tsx`
- Delete: `apps/desktop/src/documents/DocumentPanel.test.tsx`

- [ ] **Step 1: 重写 App.test.tsx**

Replace `apps/desktop/src/App.test.tsx`:

```tsx
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";

describe("App", () => {
  beforeEach(() => {
    cleanup();
    global.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify({ status: "ok" }), {
          headers: { "content-type": "application/json" }
        });
      }
      return new Response("[]", { headers: { "content-type": "application/json" } });
    });
  });

  it("renders AppShell when pi-server is ready", async () => {
    window.marginalia = {
      getPiServerStatus: vi.fn(async () => ({ status: "ready" as const, url: "http://127.0.0.1:4312" })),
      restartPiServer: vi.fn()
    };
    render(<App />);
    await waitFor(() => expect(screen.getByRole("main")).toBeInTheDocument());
  });

  it("retries a failed pi-server start", async () => {
    window.marginalia = {
      getPiServerStatus: vi.fn(async () => ({ status: "failed" as const, error: "boom", logs: [] })),
      restartPiServer: vi.fn(async () => ({ status: "ready" as const, url: "http://127.0.0.1:4312" }))
    };
    render(<App />);
    await screen.findByText("boom");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(window.marginalia?.restartPiServer).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("main")).toBeInTheDocument());
  });

  it("shows retry UI when health check fails", async () => {
    window.marginalia = {
      getPiServerStatus: vi.fn(async () => ({ status: "ready" as const, url: "http://127.0.0.1:4312" })),
      restartPiServer: vi.fn()
    };
    global.fetch = vi.fn(async () => new Response("boom", { status: 500 }));
    render(<App />);
    await screen.findByText(/health check failed/i);
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 重写 App.tsx**

Replace `apps/desktop/src/App.tsx`:

```tsx
import { useEffect, useState } from "react";
import { AppShell } from "@/app/AppShell.js";
import { Button } from "@/components/ui/button.js";
import { useTranslation } from "@/i18n/useTranslation.js";

type Health = { status: "ok" };
type UiStatus = PiServerStatus & { health?: Health };

function getBridge() {
  if (window.marginalia) return window.marginalia;
  const serverUrl = new URLSearchParams(window.location.search).get("serverUrl");
  if (import.meta.env.DEV && serverUrl) {
    return {
      getPiServerStatus: async () => ({ status: "ready" as const, url: serverUrl }),
      restartPiServer: async () => ({ status: "ready" as const, url: serverUrl })
    };
  }
  return null;
}

export function App() {
  const { t } = useTranslation();
  const [server, setServer] = useState<UiStatus>({ status: "starting" });

  async function loadHealth(status: PiServerStatus) {
    if (status.status !== "ready") {
      setServer(status);
      return;
    }
    try {
      const response = await fetch(`${status.url}/health`);
      if (!response.ok) throw new Error(`health check failed: ${response.status}`);
      const health = (await response.json()) as Health;
      setServer({ ...status, health });
    } catch (err) {
      setServer({ status: "failed", error: (err as Error).message, logs: [] });
    }
  }

  useEffect(() => {
    const bridge = getBridge();
    if (!bridge) {
      setServer({ status: "failed", error: "desktop bridge unavailable", logs: [] });
      return;
    }
    void bridge.getPiServerStatus().then(loadHealth);
  }, []);

  async function retry() {
    const bridge = getBridge();
    if (!bridge) return;
    setServer({ status: "starting" });
    await loadHealth(await bridge.restartPiServer());
  }

  if (server.status === "starting") {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        {t("status.startingServer")}
      </div>
    );
  }
  if (server.status === "failed") {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 text-sm">
        <p className="text-destructive">{server.error}</p>
        <Button onClick={retry}>{t("common.retry")}</Button>
      </div>
    );
  }

  return <AppShell serverUrl={server.url} />;
}
```

- [ ] **Step 3: 删除旧组件**

Run:
```bash
rm apps/desktop/src/workspaces/WorkspaceShell.tsx
rm apps/desktop/src/workspaces/WorkspaceShell.test.tsx
rmdir apps/desktop/src/workspaces
rm apps/desktop/src/chat/ChatView.tsx
rm apps/desktop/src/chat/ChatView.test.tsx
rmdir apps/desktop/src/chat 2>/dev/null || true
rm apps/desktop/src/documents/DocumentPanel.tsx
rm apps/desktop/src/documents/DocumentPanel.test.tsx
rmdir apps/desktop/src/documents 2>/dev/null || true
```

- [ ] **Step 4: typecheck**

Run: `pnpm --filter @marginalia/desktop typecheck`

Expected: 通过。如有报错，多半是 import 还引用了删掉的文件——按报错修复。

- [ ] **Step 5: 跑全套测试**

Run: `pnpm --filter @marginalia/desktop test`

Expected: 全绿。被删测试自然消失，剩余 + 新增的应全过。

- [ ] **Step 6: Commit**

Run:
```bash
git add apps/desktop/src/App.tsx apps/desktop/src/App.test.tsx
git add -A apps/desktop/src/workspaces apps/desktop/src/chat apps/desktop/src/documents 2>/dev/null || true
git commit -m "feat(desktop): replace App root with AppShell, remove legacy WorkspaceShell/ChatView/DocumentPanel"
```

---

## Task 10: Electron 主进程：hiddenInset titleBar

**Files:**
- Modify: `apps/desktop/electron/main.ts`

- [ ] **Step 1: 给 createWindow 加 macOS 条件**

Edit `apps/desktop/electron/main.ts`，把 `createWindow` 的 BrowserWindow 配置替换为：

```ts
async function createWindow() {
  await bootServer();
  const isMac = process.platform === "darwin";
  windowRef = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: "#fafaf9",
    titleBarStyle: isMac ? "hiddenInset" : "default",
    trafficLightPosition: isMac ? { x: 14, y: 14 } : undefined,
    webPreferences: {
      preload: path.join(import.meta.dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    await windowRef.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await windowRef.loadFile(path.resolve(import.meta.dirname, "../index.html"));
  }
}
```

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @marginalia/desktop typecheck`

Expected: 通过。

- [ ] **Step 3: Electron dev 截图验证窗口外观**

Run: `pnpm --filter @marginalia/desktop dev`

Expected：
- macOS：窗口顶部无系统标题栏，红黄绿圆点出现在左上 (14, 14)
- Topbar 的左侧 padding 不遮挡红黄绿圆点
- 左栏 toggle 按钮可点击，Topbar 空白区可拖动窗口

通过 Electron 窗口保存截图，路径写入 PR 记录。Ctrl+C 退出。

- [ ] **Step 4: Commit**

Run:
```bash
pnpm --filter @marginalia/desktop typecheck
git add apps/desktop/electron/main.ts
git commit -m "feat(desktop): enable hiddenInset titlebar with new topbar"
```

---

## Task 11: dev 烟测

- [ ] **Step 1: 启动 dev**

Run: `pnpm --filter @marginalia/desktop dev`

操作清单：
1. 等窗口出现：顶部应有 Topbar 条（无标题栏文字、左侧有 PanelLeft 图标按钮、内容居中）
2. 左侧 Sidebar 可见：包含 "New chat" 按钮、Workspaces 标题 + "+" 按钮、底部 "Settings" 按钮
3. 已有 workspace 列出时可点开折叠箭头看 sessions
4. 点 "Settings" — view 切换；中间区域显示 placeholder "Coming next PR / Current view: settings"
5. 点 "New chat" — 中间显示 "Current view: new-thread"
6. 点击 sidebar 顶部的 PanelLeft 切换按钮 — sidebar 隐藏；再点显回
7. 点 "+" 新建 workspace — 弹文件夹选择器 → 选个文件夹 → 应该 toast "Workspace created"
8. 点语言切换到中文 — Sidebar、placeholder、toast 文案切成中文；刷新后仍保持中文
9. 通过 Electron 窗口保存英文 new-thread、中文 settings、hiddenInset Topbar 三张截图
10. 关闭窗口

Expected: 所有交互正常；视觉风格已经是 shadcn 灰白浅色调；右栏不显示（view ≠ chat），切到 `chat` view 时显示右栏占位。

- [ ] **Step 2: 完成 PR 2**

最终 `git log --oneline` 应有约 11 个新 commit。`git status` 应干净。

---

## Definition of Done

- [ ] 11 个任务完成、每步提交
- [ ] `pnpm --filter @marginalia/desktop test` 全绿
- [ ] `pnpm --filter @marginalia/desktop typecheck` 通过
- [ ] dev 模式 UI 已切换为新壳层、Sidebar 可用、view 切换可见
- [ ] 英文 / 中文切换可用，刷新后保留语言选择
- [ ] 持久化的 `activeWorkspaceId` 不存在时会回退到第一个 workspace 或 null
- [ ] health check 失败时显示错误 + Retry，而不是未处理 promise
- [ ] macOS `hiddenInset` 已启用且不遮挡 Topbar 控件
- [ ] Electron UI 关键状态截图已保存：英文 new-thread、中文 settings、macOS Topbar / hiddenInset
- [ ] 旧 `WorkspaceShell` / `ChatView` / `DocumentPanel` 文件已不存在
- [ ] 创建 workspace 通过 pickDir + toast 流程工作

下一 PR：`docs/internal/plans/2026-05-26-codex-ui-03-chat-composer.md`
