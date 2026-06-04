# Codex UI 重写 · PR 5: SettingsView（Providers / Models / About）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Settings 视图。Sidebar 已有的 "Settings" 入口在 PR 2 已 wire 到 `view='settings'`，但 PR 3 把它降级为渲染 NewThreadView。本 PR 让 view='settings' 真正渲染 SettingsView，三级 nav（Providers / Models / About），Providers 支持 CRUD（用 shadcn Dialog），Models 显示每 provider 的默认模型，About 显示版本 + 重启按钮。

**Architecture:** SettingsView 内部用 `useState` 管 active section。Providers 编辑用 shadcn Dialog（结构化表单需要 modal）。后端如未实现 CRUD（`createProvider` 已有；`updateProvider` / `deleteProvider` 未必），本期 UI 上对未实现操作显示 disabled + tooltip。

**Tech Stack:** shadcn Dialog/Input/Button/Tabs, lucide-react, ApiClient.{listProviders, createProvider, testProvider}（如有 update/delete 则一并接）。

**Spec reference:** § SettingsView, § ApiClient (Providers 段)。

---

## File Structure

新建：
- `apps/desktop/src/settings/SettingsView.tsx` + test
- `apps/desktop/src/settings/ProvidersPane.tsx` + test
- `apps/desktop/src/settings/ProviderEditDialog.tsx` + test
- `apps/desktop/src/settings/ModelsPane.tsx` + test
- `apps/desktop/src/settings/AboutPane.tsx` + test

修改：
- `apps/desktop/src/app/AppShell.tsx` — 当 `view === 'settings'` 时渲染 `<SettingsView api={api} />`，去掉 PR 3 那行 `effectiveView = view === 'settings' ? 'new-thread' : view`

---

## Task 1: ProviderEditDialog

**Files:**
- Create: `apps/desktop/src/settings/ProviderEditDialog.tsx`
- Create: `apps/desktop/src/settings/ProviderEditDialog.test.tsx`

- [ ] **Step 1: 测试**

Create `apps/desktop/src/settings/ProviderEditDialog.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProviderEditDialog } from "./ProviderEditDialog.js";

describe("ProviderEditDialog", () => {
  it("renders form for new provider with empty fields", async () => {
    render(
      <ProviderEditDialog open initial={null} onSubmit={vi.fn()} onClose={vi.fn()} />
    );
    expect(screen.getByLabelText(/name/i)).toHaveValue("");
    expect(screen.getByLabelText(/api key/i)).toHaveValue("");
  });

  it("submitting calls onSubmit with form values", async () => {
    const onSubmit = vi.fn();
    render(
      <ProviderEditDialog open initial={null} onSubmit={onSubmit} onClose={vi.fn()} />
    );
    await userEvent.type(screen.getByLabelText(/name/i), "Minimax");
    await userEvent.type(screen.getByLabelText(/api key/i), "sk-xxx");
    await userEvent.type(screen.getByLabelText(/default model/i), "M2.7");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(onSubmit).toHaveBeenCalledWith({
      name: "Minimax",
      apiKey: "sk-xxx",
      baseUrl: null,
      defaultModel: "M2.7"
    });
  });

  it("save disabled when name empty", () => {
    render(
      <ProviderEditDialog open initial={null} onSubmit={vi.fn()} onClose={vi.fn()} />
    );
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: 失败**

Run: `pnpm --filter @marginalia/desktop test -- ProviderEditDialog`

Expected: FAIL。

- [ ] **Step 3: 实现**

Create `apps/desktop/src/settings/ProviderEditDialog.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";

export interface ProviderFormValue {
  name: string;
  apiKey: string;
  baseUrl: string | null;
  defaultModel: string;
}

interface Props {
  open: boolean;
  initial: { name: string; baseUrl?: string | null; defaultModel: string } | null;
  onSubmit: (value: ProviderFormValue) => void;
  onClose: () => void;
}

export function ProviderEditDialog({ open, initial, onSubmit, onClose }: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "");
  const [defaultModel, setDefaultModel] = useState(initial?.defaultModel ?? "");

  useEffect(() => {
    setName(initial?.name ?? "");
    setApiKey("");
    setBaseUrl(initial?.baseUrl ?? "");
    setDefaultModel(initial?.defaultModel ?? "");
  }, [initial, open]);

  function submit() {
    onSubmit({
      name: name.trim(),
      apiKey: apiKey.trim(),
      baseUrl: baseUrl.trim() || null,
      defaultModel: defaultModel.trim()
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit provider" : "Add provider"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <label className="block">
            <span className="mb-1 block text-xs text-muted-foreground">Name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-muted-foreground">Base URL (optional)</span>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              aria-label="Base URL"
              placeholder="https://api.example.com/v1"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-muted-foreground">API key</span>
            <Input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              type="password"
              aria-label="API key"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-muted-foreground">Default model</span>
            <Input
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
              aria-label="Default model"
            />
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!name.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: 通过**

Run: `pnpm --filter @marginalia/desktop test -- ProviderEditDialog`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/settings/ProviderEditDialog.tsx apps/desktop/src/settings/ProviderEditDialog.test.tsx
git commit -m "feat(desktop): add ProviderEditDialog form"
```

---

## Task 2: ProvidersPane

**Files:**
- Create: `apps/desktop/src/settings/ProvidersPane.tsx`
- Create: `apps/desktop/src/settings/ProvidersPane.test.tsx`

- [ ] **Step 1: 测试**

Create `apps/desktop/src/settings/ProvidersPane.test.tsx`:

```tsx
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/api/client.js";
import { ProvidersPane } from "./ProvidersPane.js";

function fakeApi(): ApiClient {
  return {
    listProviders: vi.fn(async () => [
      { id: "p1", name: "Minimax", defaultModel: "M2.7" }
    ]),
    createProvider: vi.fn(async (input) => ({ id: "new", ...input, baseUrl: input.baseUrl ?? null })),
    testProvider: vi.fn(async () => ({ ok: true, message: "pong" }))
  } as unknown as ApiClient;
}

describe("ProvidersPane", () => {
  beforeEach(() => cleanup());

  it("lists providers", async () => {
    render(<ProvidersPane api={fakeApi()} />);
    await waitFor(() => expect(screen.getByText("Minimax")).toBeInTheDocument());
  });

  it("opens add dialog and creates provider", async () => {
    const api = fakeApi();
    render(<ProvidersPane api={api} />);
    await waitFor(() => screen.getByText("Minimax"));
    await userEvent.click(screen.getByRole("button", { name: /add provider/i }));
    await userEvent.type(screen.getByLabelText(/name/i), "OpenAI");
    await userEvent.type(screen.getByLabelText(/api key/i), "sk-1");
    await userEvent.type(screen.getByLabelText(/default model/i), "gpt-4o");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() =>
      expect(api.createProvider).toHaveBeenCalledWith({
        name: "OpenAI",
        apiKey: "sk-1",
        baseUrl: null,
        defaultModel: "gpt-4o"
      })
    );
  });

  it("test button calls testProvider", async () => {
    const api = fakeApi();
    render(<ProvidersPane api={api} />);
    await waitFor(() => screen.getByText("Minimax"));
    await userEvent.click(screen.getByRole("button", { name: /test/i }));
    await waitFor(() => expect(api.testProvider).toHaveBeenCalledWith("p1"));
  });
});
```

- [ ] **Step 2: 失败**

Run: `pnpm --filter @marginalia/desktop test -- ProvidersPane`

Expected: FAIL。

- [ ] **Step 3: 实现**

Create `apps/desktop/src/settings/ProvidersPane.tsx`:

```tsx
import { useState } from "react";
import { Plus, ZapOff } from "lucide-react";
import { toast } from "sonner";
import type { ApiClient, Provider } from "@/api/client.js";
import { Button } from "@/components/ui/button.js";
import { useProviders } from "@/hooks/useProviders.js";
import { ProviderEditDialog, type ProviderFormValue } from "./ProviderEditDialog.js";

export function ProvidersPane({ api }: { api: ApiClient }) {
  const providers = useProviders(api);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [items, setItems] = useState<Provider[]>([]);

  // sync hook -> local list (so we can prepend new ones)
  if (items.length === 0 && providers.data.length > 0) {
    setItems(providers.data);
  }

  async function handleSave(value: ProviderFormValue) {
    try {
      const created = await api.createProvider(value);
      setItems((existing) => [created, ...existing.filter((p) => p.id !== created.id)]);
      toast.success(`Provider "${created.name}" added`);
      setDialogOpen(false);
    } catch (err) {
      toast.error(`Failed: ${(err as Error).message}`);
    }
  }

  async function handleTest(id: string) {
    try {
      const result = await api.testProvider(id);
      toast[result.ok ? "success" : "error"](result.message);
    } catch (err) {
      toast.error(`Test failed: ${(err as Error).message}`);
    }
  }

  const displayed = items.length > 0 ? items : providers.data;

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-medium">Providers</h2>
      <div className="rounded-md border border-border">
        {providers.loading && (
          <p className="px-4 py-3 text-sm text-muted-foreground">Loading…</p>
        )}
        {!providers.loading && displayed.length === 0 && (
          <div className="flex items-center gap-3 px-4 py-6 text-sm text-muted-foreground">
            <ZapOff className="h-4 w-4" />
            No providers yet
          </div>
        )}
        {displayed.map((p, idx) => (
          <div
            key={p.id}
            className={`flex items-center justify-between px-4 py-3 ${
              idx > 0 ? "border-t border-border" : ""
            }`}
          >
            <div>
              <p className="text-sm font-medium">{p.name}</p>
              <p className="text-xs text-muted-foreground">{p.defaultModel}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => handleTest(p.id)}>
                Test
              </Button>
            </div>
          </div>
        ))}
      </div>
      <Button variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
        <Plus className="mr-1 h-3 w-3" />
        Add provider
      </Button>
      <ProviderEditDialog
        open={dialogOpen}
        initial={null}
        onSubmit={handleSave}
        onClose={() => setDialogOpen(false)}
      />
    </div>
  );
}
```

- [ ] **Step 4: 通过**

Run: `pnpm --filter @marginalia/desktop test -- ProvidersPane`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/settings/ProvidersPane.tsx apps/desktop/src/settings/ProvidersPane.test.tsx
git commit -m "feat(desktop): add ProvidersPane with add + test"
```

---

## Task 3: ModelsPane

**Files:**
- Create: `apps/desktop/src/settings/ModelsPane.tsx`
- Create: `apps/desktop/src/settings/ModelsPane.test.tsx`

- [ ] **Step 1: 测试**

Create `apps/desktop/src/settings/ModelsPane.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/api/client.js";
import { ModelsPane } from "./ModelsPane.js";

describe("ModelsPane", () => {
  it("lists each provider with default model", async () => {
    const api = {
      listProviders: vi.fn(async () => [
        { id: "p1", name: "Minimax", defaultModel: "M2.7" },
        { id: "p2", name: "OpenAI", defaultModel: "gpt-4o" }
      ])
    } as unknown as ApiClient;
    render(<ModelsPane api={api} />);
    await waitFor(() => expect(screen.getByText("Minimax")).toBeInTheDocument());
    expect(screen.getByText("OpenAI")).toBeInTheDocument();
    expect(screen.getByText("M2.7")).toBeInTheDocument();
    expect(screen.getByText("gpt-4o")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 失败**

Run: `pnpm --filter @marginalia/desktop test -- ModelsPane`

Expected: FAIL。

- [ ] **Step 3: 实现**

Create `apps/desktop/src/settings/ModelsPane.tsx`:

```tsx
import type { ApiClient } from "@/api/client.js";
import { useProviders } from "@/hooks/useProviders.js";

export function ModelsPane({ api }: { api: ApiClient }) {
  const providers = useProviders(api);
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-medium">Models</h2>
      <p className="text-xs text-muted-foreground">
        Each provider exposes one default model. Add more provider entries for additional models.
      </p>
      <div className="rounded-md border border-border">
        {providers.loading && <p className="px-4 py-3 text-sm text-muted-foreground">Loading…</p>}
        {!providers.loading && providers.data.length === 0 && (
          <p className="px-4 py-6 text-sm text-muted-foreground">No providers configured</p>
        )}
        {providers.data.map((p, idx) => (
          <div
            key={p.id}
            className={`flex items-center justify-between px-4 py-3 ${
              idx > 0 ? "border-t border-border" : ""
            }`}
          >
            <span className="text-sm font-medium">{p.name}</span>
            <code className="rounded bg-muted px-2 py-0.5 text-xs">{p.defaultModel}</code>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 通过**

Run: `pnpm --filter @marginalia/desktop test -- ModelsPane`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/settings/ModelsPane.tsx apps/desktop/src/settings/ModelsPane.test.tsx
git commit -m "feat(desktop): add ModelsPane (read-only listing)"
```

---

## Task 4: AboutPane

**Files:**
- Create: `apps/desktop/src/settings/AboutPane.tsx`
- Create: `apps/desktop/src/settings/AboutPane.test.tsx`

- [ ] **Step 1: 测试**

Create `apps/desktop/src/settings/AboutPane.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AboutPane } from "./AboutPane.js";

describe("AboutPane", () => {
  it("shows app name and version", () => {
    render(<AboutPane serverUrl="http://x" onRestart={vi.fn()} />);
    expect(screen.getByText(/marginalia/i)).toBeInTheDocument();
    expect(screen.getByText(/http:\/\/x/)).toBeInTheDocument();
  });

  it("clicking restart triggers callback", async () => {
    const onRestart = vi.fn();
    render(<AboutPane serverUrl="http://x" onRestart={onRestart} />);
    await userEvent.click(screen.getByRole("button", { name: /restart pi-server/i }));
    expect(onRestart).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 失败**

Run: `pnpm --filter @marginalia/desktop test -- AboutPane`

Expected: FAIL。

- [ ] **Step 3: 实现**

Create `apps/desktop/src/settings/AboutPane.tsx`:

```tsx
import { Button } from "@/components/ui/button.js";

interface Props {
  serverUrl: string;
  onRestart: () => void;
}

export function AboutPane({ serverUrl, onRestart }: Props) {
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-medium">About</h2>
      <dl className="space-y-2 rounded-md border border-border px-4 py-3 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">App</dt>
          <dd>Marginalia desktop</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">pi-server</dt>
          <dd className="font-mono text-xs">{serverUrl}</dd>
        </div>
      </dl>
      <Button variant="outline" size="sm" onClick={onRestart}>
        Restart pi-server
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: 通过**

Run: `pnpm --filter @marginalia/desktop test -- AboutPane`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/settings/AboutPane.tsx apps/desktop/src/settings/AboutPane.test.tsx
git commit -m "feat(desktop): add AboutPane with restart button"
```

---

## Task 5: SettingsView 整合

**Files:**
- Create: `apps/desktop/src/settings/SettingsView.tsx`
- Create: `apps/desktop/src/settings/SettingsView.test.tsx`

- [ ] **Step 1: 测试**

Create `apps/desktop/src/settings/SettingsView.test.tsx`:

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/api/client.js";
import { SettingsView } from "./SettingsView.js";

function fakeApi(): ApiClient {
  return {
    listProviders: vi.fn(async () => []),
    createProvider: vi.fn(),
    testProvider: vi.fn()
  } as unknown as ApiClient;
}

describe("SettingsView", () => {
  beforeEach(() => cleanup());

  it("renders Providers section by default", () => {
    render(<SettingsView api={fakeApi()} serverUrl="http://x" onRestart={vi.fn()} />);
    expect(screen.getByRole("heading", { name: /providers/i })).toBeInTheDocument();
  });

  it("switches to Models pane", async () => {
    render(<SettingsView api={fakeApi()} serverUrl="http://x" onRestart={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /^models$/i }));
    expect(screen.getByRole("heading", { name: /^models$/i })).toBeInTheDocument();
  });

  it("switches to About pane", async () => {
    render(<SettingsView api={fakeApi()} serverUrl="http://x" onRestart={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /^about$/i }));
    expect(screen.getByRole("heading", { name: /^about$/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 失败**

Run: `pnpm --filter @marginalia/desktop test -- SettingsView`

Expected: FAIL。

- [ ] **Step 3: 实现**

Create `apps/desktop/src/settings/SettingsView.tsx`:

```tsx
import { useState } from "react";
import type { ApiClient } from "@/api/client.js";
import { cn } from "@/lib/cn.js";
import { AboutPane } from "./AboutPane.js";
import { ModelsPane } from "./ModelsPane.js";
import { ProvidersPane } from "./ProvidersPane.js";

type Section = "providers" | "models" | "about";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "providers", label: "Providers" },
  { id: "models", label: "Models" },
  { id: "about", label: "About" }
];

interface Props {
  api: ApiClient;
  serverUrl: string;
  onRestart: () => void;
}

export function SettingsView({ api, serverUrl, onRestart }: Props) {
  const [section, setSection] = useState<Section>("providers");

  return (
    <div className="mx-auto flex h-full w-full max-w-4xl gap-6 px-6 py-8">
      <nav className="w-44 shrink-0 space-y-1">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSection(s.id)}
            className={cn(
              "w-full rounded px-3 py-1.5 text-left text-sm hover:bg-accent",
              section === s.id ? "bg-accent font-medium text-foreground" : "text-muted-foreground"
            )}
          >
            {s.label}
          </button>
        ))}
      </nav>
      <main className="flex-1 overflow-auto">
        {section === "providers" && <ProvidersPane api={api} />}
        {section === "models" && <ModelsPane api={api} />}
        {section === "about" && <AboutPane serverUrl={serverUrl} onRestart={onRestart} />}
      </main>
    </div>
  );
}
```

- [ ] **Step 4: 通过**

Run: `pnpm --filter @marginalia/desktop test -- SettingsView`

Expected: PASS（3 个用例）。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/settings/SettingsView.tsx apps/desktop/src/settings/SettingsView.test.tsx
git commit -m "feat(desktop): add SettingsView with section nav"
```

---

## Task 6: AppShell 接 SettingsView

**Files:**
- Modify: `apps/desktop/src/app/AppShell.tsx`
- Modify: `apps/desktop/src/App.tsx`

- [ ] **Step 1: AppShell 暴露 onRestart**

Edit `apps/desktop/src/app/AppShell.tsx`：

- Props 改成 `{ serverUrl: string; onRestart: () => void }`
- 在主区域分发逻辑中加入 settings 分支；删除 PR 3 的 `effectiveView = view === 'settings' ? 'new-thread' : view`
- 替换 `<main>` 内容：

```tsx
import { SettingsView } from "@/settings/SettingsView.js";

// ... in JSX:
<main className="overflow-hidden bg-background">
  {view === "settings" ? (
    <SettingsView api={api} serverUrl={serverUrl} onRestart={onRestart} />
  ) : view === "chat" && activeSessionId ? (
    <ChatView api={api} sessionId={activeSessionId} />
  ) : (
    <NewThreadView api={api} />
  )}
</main>
```

- [ ] **Step 2: App.tsx 把 retry 作为 onRestart 传下去**

Edit `apps/desktop/src/App.tsx`：

把 `return <AppShell serverUrl={server.url} />;` 改成：

```tsx
return <AppShell serverUrl={server.url} onRestart={retry} />;
```

- [ ] **Step 3: typecheck + 全套测试**

Run:
```bash
pnpm --filter @marginalia/desktop typecheck
pnpm --filter @marginalia/desktop test
```

Expected: 全绿。`AppShell.test.tsx` 用例需要传 `onRestart={vi.fn()}` props。修一下断言里的 props。

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/app/AppShell.tsx apps/desktop/src/App.tsx apps/desktop/src/app/AppShell.test.tsx
git commit -m "feat(desktop): route view=settings to SettingsView"
```

---

## Task 7: dev 烟测

- [ ] **Step 1: 启动 dev**

Run: `pnpm --filter @marginalia/desktop dev`

操作清单：
1. 点 Sidebar 底部 "Settings" — 主区域应渲染 SettingsView：左侧 Providers/Models/About nav，右侧默认 Providers
2. 点 "Add provider" — 弹窗出现，填写表单 → Save → toast 提示成功 → 列表更新
3. 点 provider 行的 "Test" — toast 显示连通性结果
4. 点 "Models" tab — 显示每 provider 默认 model
5. 点 "About" tab — 显示版本信息 + Restart pi-server 按钮；点 Restart — pi-server 重启（窗口可能短暂显示 "Starting…" 然后回到 ready）
6. 点 Sidebar "New chat" 回到 NewThreadView，新加的 provider 应该出现在 ModelPicker 里

Expected: 所有交互正常。

---

## Task 8: 最终 PR 5 完成检查

- [ ] **Step 1: 全套测试 + typecheck**

```bash
pnpm --filter @marginalia/desktop typecheck
pnpm --filter @marginalia/desktop test
```

Expected: 全绿。

- [ ] **Step 2: 对照 Codex 参考截图**

打开 `docs/internal/specs/assets/codex-ui-reference/01-empty-state.png` 和 `02-chat-with-files.png`，把当前 dev 模式截图与之并排：

- 字体（Inter）✓
- 圆角（0.5rem / 8px）✓
- 间距整体偏松
- 灰阶（背景接近 #fafaf9，边框低对比）✓
- 三栏比例合理（左 240px 中 flex 右 320px）✓
- Topbar 高度 ~44px ✓
- 输入框圆角胶囊感 ✓

不要求像素一致，但"质感"应在同一水平。如果差距明显，记录到 followups 而非阻塞合并。

- [ ] **Step 3: Commit followups（如有）**

如果在烟测中发现小问题（间距、行高、对齐），快速修一次并提交。

```bash
git commit -m "polish(desktop): tighten spacing / line-height to match codex reference"
```

---

## Definition of Done

- [ ] 8 个任务完成、每步 commit
- [ ] `pnpm test` 全绿
- [ ] `pnpm typecheck` 通过
- [ ] Sidebar Settings 入口可进入完整 SettingsView
- [ ] Providers 可 Add + Test
- [ ] Models 显示每 provider 默认模型
- [ ] About 显示版本 + Restart 工作
- [ ] dev 模式整体视觉与 Codex 参考截图在同一水平

---

## 全局完成（PR 1-5 都合并后）

- [ ] 旧 `WorkspaceShell.tsx` / 旧 `ChatView.tsx` / 旧 `DocumentPanel.tsx` 已不存在
- [ ] 三栏 + Topbar + Sidebar + NewThread/Chat/Settings 三视图全部可用
- [ ] @ mention、/ slash、ModelPicker、Workspace/Branch chip 全部工作
- [ ] DocumentPanel 多 tab、pierre tree、Markdown/代码预览、Attach to chat 全部工作
- [ ] SettingsView Providers CRUD（至少 Add+Test）+ Models 显示 + About 重启
- [ ] 视觉对比验收通过
