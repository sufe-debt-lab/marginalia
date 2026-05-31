# Codex UI 重写 · PR 6: Sidebar 增强（Pin / Delete / 可拖宽 / 阻尼过渡）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PR 1-5 完成基础三栏架构后，把 Sidebar 升级到生产级：workspace 支持 pin（置顶）和 delete（带确认）的右键菜单；左侧 sidebar 宽度可拖拽（带 min/max 钳位 + rAF 节流）；折叠展开和 chevron 旋转加阻尼过渡；拖拽时禁用过渡防抖动。

**Architecture:** 后端补 `DELETE /workspaces/:id`（仅删 workspace 行，sessions/messages 由现有 cascade 规则或一并删，按 db 现状判断）。Pin 完全前端：Zustand 持久化 `pinnedWorkspaceIds: string[]`。`ResizeHandle` 用 PointerEvent + pointer capture + rAF flush（参考 `agent-harness/open-codex/src/renderer/components/ResizeHandle.tsx`）。右键菜单用 shadcn `ContextMenu`（vendor 后获得）。过渡：左/右栏宽度过渡用 `transition: width 200ms cubic-bezier(0.2, 0.9, 0.3, 1)`，但拖拽中通过 `html[data-resizing-panels] *{transition: none !important}` 关掉，避免拖拽尾随。

**Tech Stack:** shadcn ContextMenu / AlertDialog（PR 6 vendor），既有 Zustand，Hono pi-server。

**Spec reference:** 本 PR 是 spec 验收后的增量（来自用户在 writing-plans 阶段的反馈："sidebar 功能 ui 不够好"），将在合并前由 spec 维护人补到 spec 的"Open questions"或新增"PR 6: Sidebar UX upgrades"段。

**Commit gate:** 同 PR 2 — TDD 闭环、`pnpm typecheck`、相关测试，UI 变动必须有 Electron 截图。涉及拖拽/动画的 commit 截图至少 2 张：静止态 + 拖拽过程中的中间态。

---

## File Structure

后端新建：
- 无新文件，修改 `apps/pi-server/src/db/repositories.ts`（加 `deleteWorkspace`）
- 修改 `apps/pi-server/src/app.ts`（加 DELETE 路由）
- 修改 `apps/pi-server/test/workspace-session.test.ts`（加 delete 用例）

前端新建：
- `apps/desktop/src/components/ui/context-menu.tsx` — shadcn vendored
- `apps/desktop/src/components/ui/alert-dialog.tsx` — shadcn vendored
- `apps/desktop/src/components/ResizeHandle.tsx` + test — 4-10px 拖拽条
- `apps/desktop/src/sidebar/WorkspaceActions.tsx` + test — 右键菜单（Pin / Rename 占位 / Delete）
- `apps/desktop/src/sidebar/ConfirmDeleteDialog.tsx` + test — 删除确认弹窗
- `apps/desktop/src/hooks/useSidebarResize.ts` + test — 包装 resize 逻辑 + 持久化

前端修改：
- `apps/desktop/src/store/app-store.ts` — 加 `pinnedWorkspaceIds: string[]`, `togglePin`, `removePin`；加 `leftSidebarWidth: number`, `setLeftSidebarWidth`；扩展 `partialize`
- `apps/desktop/src/store/app-store.test.ts` — 补 pin / width 用例
- `apps/desktop/src/api/client.ts` — 加 `deleteWorkspace(id)`
- `apps/desktop/src/api/client.test.ts` — 补 delete 用例
- `apps/desktop/src/hooks/useWorkspaces.ts` — 加 `remove(id)` 方法（调 api + 本地剔除）
- `apps/desktop/src/sidebar/WorkspaceTree.tsx` — 包 `<WorkspaceActions>` 右键、加 pin 图标徽章
- `apps/desktop/src/sidebar/Sidebar.tsx` — 把 workspaces 分成 pinned / unpinned 两组渲染
- `apps/desktop/src/app/AppShell.tsx` — 改 grid-cols 为内联 `style.width`，挂 ResizeHandle；加 `data-resizing-panels` 全局 CSS
- `apps/desktop/src/styles.css` — 加阻尼过渡的全局类 + `[data-resizing-panels]` 兜底

---

## Task 1: 后端 deleteWorkspace

**Files:**
- Modify: `apps/pi-server/src/db/repositories.ts`
- Modify: `apps/pi-server/src/app.ts`
- Modify: `apps/pi-server/test/workspace-session.test.ts`

- [ ] **Step 1: 加测试用例**

在 `apps/pi-server/test/workspace-session.test.ts` 末尾加：

```ts
it("DELETE /workspaces/:id removes workspace and cascades sessions", async () => {
  const created = await app.request("/workspaces", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "to-delete", rootDir: "/tmp/to-delete" })
  });
  const ws = (await created.json()) as { id: string };

  const del = await app.request(`/workspaces/${ws.id}`, { method: "DELETE" });
  expect(del.status).toBe(204);

  const list = await app.request("/workspaces");
  const items = (await list.json()) as { id: string }[];
  expect(items.find((w) => w.id === ws.id)).toBeUndefined();
});

it("DELETE /workspaces/:id returns 404 for unknown id", async () => {
  const del = await app.request("/workspaces/no-such-id", { method: "DELETE" });
  expect(del.status).toBe(404);
});
```

> ⚠️ 如果该测试文件用了 `beforeEach` 重建 db，确保新用例不会与既有用例冲突——按文件实际结构调整。

- [ ] **Step 2: 实现 repository 函数**

在 `apps/pi-server/src/db/repositories.ts` 末尾加：

```ts
export function deleteWorkspace(db: Database.Database, id: string): boolean {
  const tx = db.transaction(() => {
    // sessions 表外键依赖 workspace_id；先删消息，再删 sessions，最后删 workspace
    const sessions = db.prepare("select id from sessions where workspace_id = ?").all(id) as { id: string }[];
    const delMessages = db.prepare("delete from messages where session_id = ?");
    const delSession = db.prepare("delete from sessions where id = ?");
    for (const s of sessions) {
      delMessages.run(s.id);
      delSession.run(s.id);
    }
    const result = db.prepare("delete from workspaces where id = ?").run(id);
    return result.changes > 0;
  });
  return tx();
}
```

> 如果 schema 与上面 SQL 不符（表名 / 列名不同），按 `apps/pi-server/src/db/migrations.ts` 中的真实定义调整。

- [ ] **Step 3: 加 HTTP 路由**

在 `apps/pi-server/src/app.ts` 中 `/workspaces` POST 路由附近加：

```ts
import { deleteWorkspace } from "./db/repositories.js";

app.delete("/workspaces/:id", (c) => {
  const ok = deleteWorkspace(db, c.req.param("id"));
  if (!ok) return c.json({ error: "not found" }, 404);
  return c.body(null, 204);
});
```

- [ ] **Step 4: 跑 server 测试**

Run: `pnpm --filter @marginalia/pi-server test -- workspace-session`

Expected: PASS（含新的 2 个用例）。

- [ ] **Step 5: Commit**

```bash
git add apps/pi-server/src/db/repositories.ts apps/pi-server/src/app.ts apps/pi-server/test/workspace-session.test.ts
git commit -m "feat(pi-server): DELETE /workspaces/:id cascades sessions and messages"
```

---

## Task 2: ApiClient.deleteWorkspace

**Files:**
- Modify: `apps/desktop/src/api/client.ts`
- Modify: `apps/desktop/src/api/client.test.ts`

- [ ] **Step 1: 加测试**

在 `apps/desktop/src/api/client.test.ts` 加：

```ts
it("deleteWorkspace returns void on 204", async () => {
  global.fetch = vi.fn(async () => new Response(null, { status: 204 }));
  const api = new ApiClient("http://x");
  await expect(api.deleteWorkspace("w")).resolves.toBeUndefined();
});

it("deleteWorkspace throws on non-2xx", async () => {
  global.fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json" }
      })
  );
  const api = new ApiClient("http://x");
  await expect(api.deleteWorkspace("w")).rejects.toThrow(/not found/);
});
```

- [ ] **Step 2: 在 ApiClient 加方法**

```ts
async deleteWorkspace(id: string): Promise<void> {
  const response = await fetch(`${this.baseUrl}/workspaces/${id}`, { method: "DELETE" });
  if (response.status === 204) return;
  const error = (await response.json().catch(() => ({ error: response.statusText }))) as { error?: string };
  throw new Error(error.error ?? response.statusText);
}
```

- [ ] **Step 3: 测试通过**

Run: `pnpm --filter @marginalia/desktop test -- client`

Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/api/client.ts apps/desktop/src/api/client.test.ts
git commit -m "feat(desktop): ApiClient.deleteWorkspace"
```

---

## Task 3: Zustand store 扩展（pin + sidebar width）

**Files:**
- Modify: `apps/desktop/src/store/app-store.ts`
- Modify: `apps/desktop/src/store/app-store.test.ts`

- [ ] **Step 1: 加测试**

在 `apps/desktop/src/store/app-store.test.ts` 的 describe 内加：

```ts
it("togglePin adds and removes workspace ids", () => {
  const { togglePin } = useAppStore.getState();
  togglePin("w1");
  togglePin("w2");
  expect(useAppStore.getState().pinnedWorkspaceIds).toEqual(["w1", "w2"]);
  togglePin("w1");
  expect(useAppStore.getState().pinnedWorkspaceIds).toEqual(["w2"]);
});

it("removePin called by workspace deletion removes the id silently", () => {
  const { togglePin, removePin } = useAppStore.getState();
  togglePin("w1");
  removePin("w1");
  expect(useAppStore.getState().pinnedWorkspaceIds).toEqual([]);
  // calling removePin on non-pinned id is a no-op
  removePin("never");
  expect(useAppStore.getState().pinnedWorkspaceIds).toEqual([]);
});

it("setLeftSidebarWidth clamps between 180 and 480 and persists", () => {
  const { setLeftSidebarWidth } = useAppStore.getState();
  setLeftSidebarWidth(50);
  expect(useAppStore.getState().leftSidebarWidth).toBe(180);
  setLeftSidebarWidth(9999);
  expect(useAppStore.getState().leftSidebarWidth).toBe(480);
  setLeftSidebarWidth(300);
  expect(useAppStore.getState().leftSidebarWidth).toBe(300);
  const stored = JSON.parse(localStorage.getItem("my-cowork-app") || "{}");
  expect(stored.state?.leftSidebarWidth).toBe(300);
  expect(stored.state?.pinnedWorkspaceIds).toBeDefined();
});
```

同时把每个 `useAppStore.setState({...})` 重置块更新成包含 `pinnedWorkspaceIds: []` 和 `leftSidebarWidth: 240` 字段以防 store schema 漂移。

- [ ] **Step 2: 改 store**

```ts
interface AppState {
  // ... existing
  pinnedWorkspaceIds: string[];
  leftSidebarWidth: number;

  togglePin: (id: string) => void;
  removePin: (id: string) => void;
  setLeftSidebarWidth: (px: number) => void;
}

const MIN_WIDTH = 180;
const MAX_WIDTH = 480;

// 默认值：
pinnedWorkspaceIds: [],
leftSidebarWidth: 240,

// actions：
togglePin: (id) =>
  set((s) => {
    const exists = s.pinnedWorkspaceIds.includes(id);
    return {
      pinnedWorkspaceIds: exists
        ? s.pinnedWorkspaceIds.filter((x) => x !== id)
        : [...s.pinnedWorkspaceIds, id]
    };
  }),
removePin: (id) =>
  set((s) => ({
    pinnedWorkspaceIds: s.pinnedWorkspaceIds.filter((x) => x !== id)
  })),
setLeftSidebarWidth: (px) =>
  set({ leftSidebarWidth: Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(px))) }),

// persist partialize：
partialize: (s) => ({
  activeWorkspaceId: s.activeWorkspaceId,
  leftSidebarCollapsed: s.leftSidebarCollapsed,
  rightPanelCollapsed: s.rightPanelCollapsed,
  pinnedWorkspaceIds: s.pinnedWorkspaceIds,
  leftSidebarWidth: s.leftSidebarWidth,
  locale: s.locale  // 已由 PR 1 引入
})
```

- [ ] **Step 3: 测试通过**

Run: `pnpm --filter @marginalia/desktop test -- app-store`

Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/store/app-store.ts apps/desktop/src/store/app-store.test.ts
git commit -m "feat(desktop): app-store adds pin + sidebar width"
```

---

## Task 4: vendor shadcn ContextMenu + AlertDialog

**Files:**
- Create: `apps/desktop/src/components/ui/context-menu.tsx`
- Create: `apps/desktop/src/components/ui/alert-dialog.tsx`

- [ ] **Step 1: 安装 Radix 子包**

Run:
```bash
pnpm --filter @marginalia/desktop add @radix-ui/react-context-menu@^2 @radix-ui/react-alert-dialog@^1
```

Expected: 安装成功。

- [ ] **Step 2: vendor 组件**

Run:
```bash
cd apps/desktop
pnpm dlx shadcn@latest add -y context-menu alert-dialog
```

Expected: 两个文件写入 `src/components/ui/`。

- [ ] **Step 3: typecheck**

Run: `pnpm --filter @marginalia/desktop typecheck`

Expected: 通过。

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/package.json pnpm-lock.yaml apps/desktop/src/components/ui/context-menu.tsx apps/desktop/src/components/ui/alert-dialog.tsx
git commit -m "chore(desktop): vendor shadcn context-menu + alert-dialog"
```

---

## Task 5: ResizeHandle 组件

**Files:**
- Create: `apps/desktop/src/components/ResizeHandle.tsx`
- Create: `apps/desktop/src/components/ResizeHandle.test.tsx`

参考 `agent-harness/open-codex/src/renderer/components/ResizeHandle.tsx`，结构相同（同样 MIT 协议，可借鉴）。

- [ ] **Step 1: 测试**

Create `apps/desktop/src/components/ResizeHandle.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ResizeHandle } from "./ResizeHandle.js";

describe("ResizeHandle", () => {
  it("renders a separator role", () => {
    render(
      <ResizeHandle side="right" getWidth={() => 240} onWidth={() => {}} />
    );
    const sep = screen.getByRole("separator");
    expect(sep).toBeInTheDocument();
    expect(sep).toHaveAttribute("aria-orientation", "vertical");
  });

  it("calls onWidth via rAF on pointer move with delta", async () => {
    const onWidth = vi.fn();
    const getWidth = () => 240;
    render(<ResizeHandle side="right" getWidth={getWidth} onWidth={onWidth} />);
    const sep = screen.getByRole("separator");

    // simulate pointer down + move (jsdom 提供 PointerEvent；setPointerCapture 是 no-op stub）
    sep.dispatchEvent(
      new PointerEvent("pointerdown", { clientX: 100, pointerId: 1, bubbles: true })
    );
    sep.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 150, pointerId: 1, bubbles: true })
    );
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(onWidth).toHaveBeenCalledWith(290);

    sep.dispatchEvent(new PointerEvent("pointerup", { clientX: 150, pointerId: 1, bubbles: true }));
  });
});
```

> jsdom 不内置 `setPointerCapture`/`releasePointerCapture`。在 `apps/desktop/src/test/setup.ts` 加：
> ```ts
> if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
> if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
> ```

- [ ] **Step 2: 测试失败**

Run: `pnpm --filter @marginalia/desktop test -- ResizeHandle`

Expected: FAIL。

- [ ] **Step 3: 实现**

Create `apps/desktop/src/components/ResizeHandle.tsx`（结构基于 open-codex，做了 React 18 兼容化）:

```tsx
import { useEffect, useRef } from "react";
import { cn } from "@/lib/cn.js";

interface Props {
  side: "left" | "right";
  getWidth: () => number;
  onWidth: (next: number) => void;
  onCommit?: (next: number) => void;
}

export function ResizeHandle({ side, getWidth, onWidth, onCommit }: Props) {
  const dragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const nextWidth = useRef(0);
  const frame = useRef<number | null>(null);
  const getRef = useRef(getWidth);
  const setRef = useRef(onWidth);
  const commitRef = useRef(onCommit);

  useEffect(() => {
    getRef.current = getWidth;
    setRef.current = onWidth;
    commitRef.current = onCommit;
  }, [getWidth, onWidth, onCommit]);

  function clearGlobals() {
    document.documentElement.removeAttribute("data-resizing-panels");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }

  function flush() {
    frame.current = null;
    setRef.current(nextWidth.current);
  }

  function endDrag(pointerId?: number, target?: Element) {
    if (!dragging.current) return;
    dragging.current = false;
    if (pointerId !== undefined && target instanceof HTMLElement) {
      try {
        target.releasePointerCapture(pointerId);
      } catch {
        /* ignore */
      }
    }
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
      setRef.current(nextWidth.current);
    }
    commitRef.current?.(nextWidth.current);
    clearGlobals();
  }

  useEffect(() => {
    const cancel = () => endDrag();
    window.addEventListener("pointerup", cancel);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("pointerup", cancel);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      if (dragging.current) clearGlobals();
    };
  }, []);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onPointerDown={(e) => {
        dragging.current = true;
        startX.current = e.clientX;
        startWidth.current = getRef.current();
        nextWidth.current = startWidth.current;
        e.currentTarget.setPointerCapture(e.pointerId);
        document.documentElement.setAttribute("data-resizing-panels", "true");
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        const dx = e.clientX - startX.current;
        nextWidth.current = startWidth.current + (side === "right" ? dx : -dx);
        if (frame.current === null) frame.current = requestAnimationFrame(flush);
      }}
      onPointerUp={(e) => endDrag(e.pointerId, e.currentTarget)}
      onPointerCancel={() => endDrag()}
      onLostPointerCapture={() => endDrag()}
      className={cn(
        "group absolute top-0 z-30 h-full w-[10px] cursor-col-resize touch-none select-none app-no-drag",
        side === "right" ? "-right-[5px]" : "-left-[5px]"
      )}
    >
      <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-accent/40 group-active:bg-accent/70" />
    </div>
  );
}
```

- [ ] **Step 4: 测试通过**

Run: `pnpm --filter @marginalia/desktop test -- ResizeHandle`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/components/ResizeHandle.tsx apps/desktop/src/components/ResizeHandle.test.tsx apps/desktop/src/test/setup.ts
git commit -m "feat(desktop): ResizeHandle pointer-capture + rAF splitter"
```

---

## Task 6: WorkspaceActions 右键菜单

**Files:**
- Create: `apps/desktop/src/sidebar/WorkspaceActions.tsx`
- Create: `apps/desktop/src/sidebar/WorkspaceActions.test.tsx`

- [ ] **Step 1: 测试**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceActions } from "./WorkspaceActions.js";

const workspace = { id: "w1", name: "alpha", rootDir: "/a" };

describe("WorkspaceActions", () => {
  it("Pin item toggles pin via callback", async () => {
    const onPin = vi.fn();
    render(
      <WorkspaceActions workspace={workspace} pinned={false} onPin={onPin} onDelete={vi.fn()}>
        <button>trigger</button>
      </WorkspaceActions>
    );
    await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByText("trigger") });
    await userEvent.click(screen.getByText(/^pin$/i));
    expect(onPin).toHaveBeenCalledWith("w1");
  });

  it("Delete item triggers confirm dialog via callback", async () => {
    const onDelete = vi.fn();
    render(
      <WorkspaceActions workspace={workspace} pinned={false} onPin={vi.fn()} onDelete={onDelete}>
        <button>trigger</button>
      </WorkspaceActions>
    );
    await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByText("trigger") });
    await userEvent.click(screen.getByText(/^delete$/i));
    expect(onDelete).toHaveBeenCalledWith(workspace);
  });

  it("Shows Unpin label when already pinned", async () => {
    render(
      <WorkspaceActions workspace={workspace} pinned={true} onPin={vi.fn()} onDelete={vi.fn()}>
        <button>trigger</button>
      </WorkspaceActions>
    );
    await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByText("trigger") });
    expect(screen.getByText(/^unpin$/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 失败**

Run: `pnpm --filter @marginalia/desktop test -- WorkspaceActions`

Expected: FAIL。

- [ ] **Step 3: 实现**

```tsx
import { Pin, PinOff, Trash2 } from "lucide-react";
import type { Workspace } from "@/api/client.js";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from "@/components/ui/context-menu.js";

interface Props {
  workspace: Workspace;
  pinned: boolean;
  onPin: (id: string) => void;
  onDelete: (workspace: Workspace) => void;
  children: React.ReactNode;
}

export function WorkspaceActions({ workspace, pinned, onPin, onDelete, children }: Props) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        <ContextMenuItem onSelect={() => onPin(workspace.id)}>
          {pinned ? <PinOff className="mr-2 h-3.5 w-3.5" /> : <Pin className="mr-2 h-3.5 w-3.5" />}
          {pinned ? "Unpin" : "Pin"}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() => onDelete(workspace)}
          className="text-destructive focus:bg-destructive/10 focus:text-destructive"
        >
          <Trash2 className="mr-2 h-3.5 w-3.5" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
```

> **i18n note**：本组件文案应走 `useTranslation().t("sidebar.pin")` 等 key；在 PR 1 的 `messages.ts` 加上 `sidebar.pin`, `sidebar.unpin`, `sidebar.delete`。如果 PR 1 还没合并，本任务可暂用硬编码英文，标 followup。

- [ ] **Step 4: 通过**

Run: `pnpm --filter @marginalia/desktop test -- WorkspaceActions`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/sidebar/WorkspaceActions.tsx apps/desktop/src/sidebar/WorkspaceActions.test.tsx
git commit -m "feat(desktop): WorkspaceActions context menu (pin + delete)"
```

---

## Task 7: ConfirmDeleteDialog

**Files:**
- Create: `apps/desktop/src/sidebar/ConfirmDeleteDialog.tsx`
- Create: `apps/desktop/src/sidebar/ConfirmDeleteDialog.test.tsx`

- [ ] **Step 1: 测试**

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog.js";

describe("ConfirmDeleteDialog", () => {
  it("renders workspace name in description", () => {
    render(
      <ConfirmDeleteDialog
        open
        workspaceName="alpha"
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText(/alpha/i)).toBeInTheDocument();
  });

  it("Confirm calls onConfirm and Cancel calls onClose", async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmDeleteDialog open workspaceName="alpha" onConfirm={onConfirm} onClose={onClose} />
    );
    await userEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(onConfirm).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 失败**

Run: `pnpm --filter @marginalia/desktop test -- ConfirmDeleteDialog`

Expected: FAIL。

- [ ] **Step 3: 实现**

```tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog.js";

interface Props {
  open: boolean;
  workspaceName: string;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDeleteDialog({ open, workspaceName, onConfirm, onClose }: Props) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete workspace?</AlertDialogTitle>
          <AlertDialogDescription>
            "{workspaceName}" and all of its chat history will be removed from the desktop database.
            Files on disk are not touched.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 4: 通过**

Run: `pnpm --filter @marginalia/desktop test -- ConfirmDeleteDialog`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/sidebar/ConfirmDeleteDialog.tsx apps/desktop/src/sidebar/ConfirmDeleteDialog.test.tsx
git commit -m "feat(desktop): ConfirmDeleteDialog for workspace removal"
```

---

## Task 8: useWorkspaces.remove

**Files:**
- Modify: `apps/desktop/src/hooks/useWorkspaces.ts`
- Modify: `apps/desktop/src/hooks/useWorkspaces.test.ts`

- [ ] **Step 1: 加测试**

在已有 describe 内加：

```ts
it("remove deletes via api and prunes local list", async () => {
  const api = {
    listWorkspaces: vi.fn(async () => [
      { id: "a", name: "A", rootDir: "/a" },
      { id: "b", name: "B", rootDir: "/b" }
    ]),
    createWorkspace: vi.fn(),
    deleteWorkspace: vi.fn(async () => {})
  } as unknown as ApiClient;
  const { result } = renderHook(() => useWorkspaces(api));
  await waitFor(() => expect(result.current.data).toHaveLength(2));
  await act(async () => {
    await result.current.remove("a");
  });
  expect(api.deleteWorkspace).toHaveBeenCalledWith("a");
  expect(result.current.data.map((w) => w.id)).toEqual(["b"]);
});
```

- [ ] **Step 2: 实现**

在 `useWorkspaces` 内加：

```ts
const remove = useCallback(
  async (id: string) => {
    await api.deleteWorkspace(id);
    setData((items) => items.filter((w) => w.id !== id));
  },
  [api]
);

return { data, loading, error, create, remove };
```

- [ ] **Step 3: 通过**

Run: `pnpm --filter @marginalia/desktop test -- useWorkspaces`

Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/hooks/useWorkspaces.ts apps/desktop/src/hooks/useWorkspaces.test.ts
git commit -m "feat(desktop): useWorkspaces.remove"
```

---

## Task 9: WorkspaceTree 集成 pin 图标 + 右键菜单

**Files:**
- Modify: `apps/desktop/src/sidebar/WorkspaceTree.tsx`
- Modify: `apps/desktop/src/sidebar/WorkspaceTree.test.tsx`

- [ ] **Step 1: 加测试**

在已有 describe 内加：

```ts
it("renders a pin icon when pinned", () => {
  useAppStore.setState({ pinnedWorkspaceIds: ["w"] });
  render(<WorkspaceTree api={fakeApi()} workspace={workspace} />);
  // pin icon 用 aria-label="pinned"
  expect(screen.getByLabelText("pinned")).toBeInTheDocument();
});

it("right-click + Pin toggles pin state", async () => {
  render(<WorkspaceTree api={fakeApi()} workspace={workspace} />);
  await userEvent.pointer({ keys: "[MouseRight]", target: screen.getByText("demo") });
  await userEvent.click(screen.getByText(/^pin$/i));
  expect(useAppStore.getState().pinnedWorkspaceIds).toContain("w");
});
```

- [ ] **Step 2: 修组件**

在 `WorkspaceTree.tsx`：

- import `WorkspaceActions`、`ConfirmDeleteDialog`、`useWorkspaces`（如还没引用）
- 用 `useAppStore((s) => s.pinnedWorkspaceIds.includes(workspace.id))` 决定 pin 状态
- 把整个 header button 包在 `<WorkspaceActions workspace={workspace} pinned={isPinned} onPin={togglePin} onDelete={openDeleteDialog}>` 内
- header button 右侧加（pinned 时）`<Pin aria-label="pinned" className="h-3 w-3 text-muted-foreground" />`
- 组件根加一个 `<ConfirmDeleteDialog open={deleteTarget !== null} workspaceName={deleteTarget?.name ?? ""} onConfirm={confirmDelete} onClose={...} />`
- `confirmDelete`：调 `workspaces.remove(workspace.id)` + `useAppStore.getState().removePin(workspace.id)`；如 `activeWorkspaceId === workspace.id`，`setActiveWorkspace(null)` 并 `setActiveSession(null)`；失败 toast；成功后关闭对话框

⚠️ 注意：`useWorkspaces` 在每个 `WorkspaceTree` 实例里都会自己 fetch 一次。为避免重复，**把 `remove` 函数从 Sidebar 一层（持有 useWorkspaces 的地方）作为 prop 传下来**，而不是在 WorkspaceTree 内再次调用 `useWorkspaces(api)`。这是设计修正：

修改 `WorkspaceTree` props：

```ts
interface Props {
  api: ApiClient;
  workspace: Workspace;
  onDelete: (id: string) => Promise<void>;
}
```

Sidebar 把 `workspaces.remove` 透传给每个 tree。

⚠️ **PR 2 测试补丁**：PR 2 的 `WorkspaceTree.test.tsx` 中所有 `<WorkspaceTree api={...} workspace={...} />` 调用都缺新增的 `onDelete` prop。本 step 同时修这些用例：

```tsx
// 之前
render(<WorkspaceTree api={fakeApi()} workspace={workspace} />);
// 改为
render(<WorkspaceTree api={fakeApi()} workspace={workspace} onDelete={async () => {}} />);
```

否则 PR 6 合并后 PR 2 的测试会编译失败。

- [ ] **Step 3: 通过**

Run: `pnpm --filter @marginalia/desktop test -- WorkspaceTree`

Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/sidebar/WorkspaceTree.tsx apps/desktop/src/sidebar/WorkspaceTree.test.tsx
git commit -m "feat(desktop): WorkspaceTree adds pin badge + context menu actions"
```

---

## Task 10: Sidebar 分组渲染 pinned / unpinned

**Files:**
- Modify: `apps/desktop/src/sidebar/Sidebar.tsx`
- Modify: `apps/desktop/src/sidebar/Sidebar.test.tsx`

- [ ] **Step 1: 加测试**

```ts
it("renders pinned workspaces in a separate group above the rest", async () => {
  useAppStore.setState({ pinnedWorkspaceIds: ["w1"] });
  const api = {
    listWorkspaces: vi.fn(async () => [
      { id: "w1", name: "alpha", rootDir: "/a" },
      { id: "w2", name: "beta", rootDir: "/b" }
    ]),
    createWorkspace: vi.fn(),
    deleteWorkspace: vi.fn()
  } as unknown as ApiClient;
  render(<Sidebar api={api} />);
  await waitFor(() => screen.getByText("alpha"));
  const pinnedHeading = screen.getByText(/pinned/i);
  // alpha should appear in DOM order before "Workspaces" heading
  const workspacesHeading = screen.getByText(/^workspaces$/i);
  expect(pinnedHeading.compareDocumentPosition(workspacesHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
```

- [ ] **Step 2: 改 Sidebar**

把 `workspaces.data.map(...)` 替换为：

```tsx
const pinned = useAppStore((s) => s.pinnedWorkspaceIds);
const pinnedSet = new Set(pinned);
const pinnedList = workspaces.data.filter((w) => pinnedSet.has(w.id));
// pinned 按 pinnedWorkspaceIds 中的顺序排序
pinnedList.sort((a, b) => pinned.indexOf(a.id) - pinned.indexOf(b.id));
const otherList = workspaces.data.filter((w) => !pinnedSet.has(w.id));

// JSX：
{pinnedList.length > 0 && (
  <>
    <div className="px-3 pt-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
      {t("common.pinned")}
    </div>
    <div className="space-y-0.5 px-2">
      {pinnedList.map((w) => (
        <WorkspaceTree key={w.id} api={api} workspace={w} onDelete={workspaces.remove} />
      ))}
    </div>
  </>
)}
<div className="flex items-center justify-between px-3 pt-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
  <span>{t("common.workspaces")}</span>
  ...
</div>
{otherList.map((w) => (
  <WorkspaceTree key={w.id} api={api} workspace={w} onDelete={workspaces.remove} />
))}
```

在 PR 1 的 messages.ts 加 `common.pinned: "Pinned" / "已置顶"`。

- [ ] **Step 3: 通过**

Run: `pnpm --filter @marginalia/desktop test -- Sidebar`

Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/sidebar/Sidebar.tsx apps/desktop/src/sidebar/Sidebar.test.tsx apps/desktop/src/i18n/messages.ts
git commit -m "feat(desktop): Sidebar groups pinned workspaces above the rest"
```

---

## Task 11: AppShell 接 ResizeHandle + 阻尼过渡

**Files:**
- Modify: `apps/desktop/src/app/AppShell.tsx`
- Modify: `apps/desktop/src/app/AppShell.test.tsx`
- Modify: `apps/desktop/src/styles.css`

- [ ] **Step 1: styles.css 加全局阻尼 + 拖拽中禁用过渡**

在 `apps/desktop/src/styles.css` 末尾加：

```css
@layer components {
  .pane-width-transition {
    transition: width 200ms cubic-bezier(0.2, 0.9, 0.3, 1);
  }
}

html[data-resizing-panels] * {
  transition: none !important;
  animation-duration: 0ms !important;
}
```

- [ ] **Step 2: 改 AppShell 为内联 width + ResizeHandle**

把 `<div className={cn("grid flex-1 overflow-hidden", ...)}>` 改为 flex 布局，每个 panel 用内联 style.width：

```tsx
import { ResizeHandle } from "@/components/ResizeHandle.js";

const leftWidth = useAppStore((s) => s.leftSidebarWidth);
const setLeftWidth = useAppStore((s) => s.setLeftSidebarWidth);

return (
  <div className="flex h-screen flex-col">
    <Topbar title={title} />
    <div className="flex flex-1 overflow-hidden">
      {!leftCollapsed && (
        <aside
          aria-label="Sidebar"
          style={{ width: leftWidth }}
          className="pane-width-transition relative shrink-0 overflow-hidden"
        >
          <Sidebar api={api} />
          <ResizeHandle
            side="right"
            getWidth={() => leftWidth}
            onWidth={setLeftWidth}
          />
        </aside>
      )}
      <main className="flex-1 overflow-hidden bg-background">
        {/* ... 同 PR 3/5 的 view 路由 ... */}
      </main>
      {showRight && activeWorkspaceId && (
        <aside
          aria-label="Document panel"
          className="w-[320px] shrink-0 overflow-hidden border-l border-border"
        >
          <DocumentPanel api={api} workspaceId={activeWorkspaceId} />
        </aside>
      )}
    </div>
  </div>
);
```

> 右栏暂不可拖拽（spec 没明确要求；如果用户后续要，可以镜像左栏，加 ResizeHandle side="left" 在右栏左边）。

- [ ] **Step 3: 修测试**

`AppShell.test.tsx` 中 sidebar 宽度断言（如果之前用了 grid-cols 类名断言）改成 `expect(...).toHaveStyle({ width: "240px" })`。加一个新用例：

```ts
it("uses leftSidebarWidth from store", () => {
  useAppStore.setState({ leftSidebarWidth: 320 });
  render(<AppShell serverUrl="http://x" onRestart={vi.fn()} />);
  const aside = screen.getByRole("complementary", { name: /sidebar/i });
  expect(aside).toHaveStyle({ width: "320px" });
});
```

- [ ] **Step 4: 通过**

Run:
```bash
pnpm --filter @marginalia/desktop test -- AppShell
pnpm --filter @marginalia/desktop typecheck
```

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/app/AppShell.tsx apps/desktop/src/app/AppShell.test.tsx apps/desktop/src/styles.css
git commit -m "feat(desktop): AppShell uses ResizeHandle and damped width transitions"
```

---

## Task 12: WorkspaceTree 折叠 chevron 动画 + 列表入场过渡

**Files:**
- Modify: `apps/desktop/src/sidebar/WorkspaceTree.tsx`

- [ ] **Step 1: 给 chevron 加 spring 过渡**

`WorkspaceTree.tsx` 中 chevron 的 className 已经有 `transition-transform`，把它换成更柔和的：

```tsx
<ChevronRight
  className={cn(
    "h-3.5 w-3.5 transition-transform duration-200 ease-[cubic-bezier(0.2,0.9,0.3,1)]",
    expanded && "rotate-90"
  )}
/>
```

- [ ] **Step 2: 给 session 列表加入场动画**

把 `<ul>` 加上：

```tsx
<ul
  className={cn(
    "ml-6 mt-0.5 space-y-0.5 overflow-hidden",
    "transition-[max-height,opacity] duration-200 ease-[cubic-bezier(0.2,0.9,0.3,1)]"
  )}
  style={{
    maxHeight: expanded ? `${Math.min(sessions.data.length * 32 + 8, 480)}px` : "0px",
    opacity: expanded ? 1 : 0
  }}
>
  {/* ... */}
</ul>
```

> 这是无 framer-motion 的纯 CSS 方案。`max-height` 用估算避免 `auto` 不能过渡。若实际 session 行高不一致，估算需要调；首版可接受。

- [ ] **Step 3: typecheck + 跑测试**

Run:
```bash
pnpm --filter @marginalia/desktop typecheck
pnpm --filter @marginalia/desktop test -- WorkspaceTree
```

Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/sidebar/WorkspaceTree.tsx
git commit -m "polish(desktop): WorkspaceTree chevron + list slide-in transitions"
```

---

## Task 13: dev 烟测 + 截图验收

- [ ] **Step 1: 启动 dev**

Run: `pnpm --filter @marginalia/desktop dev`

操作清单：

1. Sidebar 创建 2 个 workspace
2. 右键其中一个 → Pin → 检查它跳到顶部 Pinned 组
3. 右键 → Unpin → 回到 Workspaces 组
4. 右键 → Delete → 弹 ConfirmDeleteDialog → Cancel：无变化
5. 再 Delete → Confirm：workspace 消失；如果它是 active，主区域回到 NewThreadView 且 WorkspaceChip 变为 "Select workspace…"
6. 拖动 sidebar 右边缘 — 鼠标变成 col-resize；宽度跟手；< 180px 不再变；> 480px 也不再变
7. 松开 — 宽度持久化；刷新窗口（dev 模式可关重开）— 宽度恢复
8. 点 Topbar PanelLeft — sidebar 折叠；再点 — 展开（应该带 200ms cubic-bezier 滑入）
9. 点 workspace 折叠箭头 — chevron 旋转有阻尼感；sessions 列表带 fade + slide-down
10. 拖动 sidebar 时切到 chat 视图 → 切回 → 拖动正常（验证全局 `data-resizing-panels` 不影响其它过渡）

- [ ] **Step 2: 截图**

用 `bridge.captureScreenshot` 或 macOS ⌘+Shift+4 截 3 张到 `output/codex-ui-pr6/`：

```
output/codex-ui-pr6/
  01-pinned-and-context-menu.png
  02-resize-dragging.png
  03-collapsed-vs-expanded.png
```

把这 3 张与 `docs/superpowers/specs/assets/codex-ui-reference/02-chat-with-files.png` 并排查看，"质感"应不输 Codex。

- [ ] **Step 3: Commit screenshots（可选）**

如果项目允许 commit 截图（参考 spec 现已有 `assets/codex-ui-reference/*.png` 在 git 中），把验收截图也提交：

```bash
git add output/codex-ui-pr6/
git commit -m "test(desktop): visual verification screenshots for PR 6"
```

---

## Task 14: 最终全套测试 + 自验

- [ ] **Step 1: 全套测试**

Run:
```bash
pnpm --filter @marginalia/desktop test
pnpm --filter @marginalia/pi-server test
pnpm --filter @marginalia/desktop typecheck
```

Expected: 全绿。

- [ ] **Step 2: 检查 PR 6 完成度**

对照本 plan 顶部 Goal 中列出的 4 项：

- workspace pin/unpin ✓
- workspace delete（含确认）✓
- sidebar 宽度可拖拽（含 min/max + 持久化）✓
- 阻尼过渡（chevron / list / panel width）✓

如有缺失，加补丁 commit。

---

## Definition of Done

- [ ] 14 个任务完成、每步 commit
- [ ] `pnpm test`（desktop + pi-server）全绿
- [ ] `pnpm typecheck` 通过
- [ ] dev 模式上述 10 个手测项全部通过
- [ ] 验收截图至少 3 张归档在 `output/codex-ui-pr6/`
- [ ] PR 描述里附 spec 反向更新说明：spec § Open questions / § PR 6 段需要补一条 "sidebar pin/delete/resize + damped transitions 已实现"
