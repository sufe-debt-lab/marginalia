# Codex UI 重写 · PR 4: DocumentPanel（Tabs + Pierre Tree + Viewer + Attach）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现右栏 DocumentPanel：顶部多 Tab（已打开文件，× 关闭）、路径条 + 文件树抽屉按钮、主区代码/Markdown 预览、底部 "Attach to chat" 按钮。文件树用 `@pierre/trees` 渲染（在 shadow root 内）。删除 PR 2 的 `DocumentPanelPlaceholder`。

**Architecture:** DocumentPanel 自身管理 `openTabs[]` + `activeTabPath` + `treeOpen` 状态。useFileTree hook 拉一次 paths 列表后缓存；变更监听不做。DocumentViewer 根据后缀决定渲染：`.md` 用 ReactMarkdown，否则用 highlight.js。Attach to chat 调 store.addContextFile。

**Tech Stack:** @pierre/trees (FileTree + React entry), react-markdown / highlight.js（PR 3 已建立的 lib）, shadcn Tabs, ApiClient.listFiles + readDocument。

**Spec reference:** § 右栏 DocumentPanel, § 失败 / 边缘场景（readDocument 失败、超大文件、文件树空）。

---

## File Structure

新建：
- `apps/desktop/src/hooks/useFileTree.ts` + test — 拉一次文件路径列表
- `apps/desktop/src/hooks/useDocumentContent.ts` + test — 按 path 缓存读
- `apps/desktop/src/documents/DocumentPanel.tsx` + test
- `apps/desktop/src/documents/DocumentTabs.tsx` + test
- `apps/desktop/src/documents/DocumentTree.tsx` + test — pierre tree 封装
- `apps/desktop/src/documents/DocumentViewer.tsx` + test

修改：
- `apps/desktop/src/app/AppShell.tsx` — 替换 `DocumentPanelPlaceholder` 为真 `DocumentPanel`
- `apps/desktop/src/app/placeholders.tsx` — 整文件删除（PR 2 的 `MainPlaceholder` 在 PR 3 已经不被用，本 PR 删整个文件）

---

## Task 1: useFileTree hook

**Files:**
- Create: `apps/desktop/src/hooks/useFileTree.ts`
- Create: `apps/desktop/src/hooks/useFileTree.test.ts`

`pi-server` 已存在 `listFiles(workspaceId)` 返回 `FileEntry[]`，但当前实现可能只返回根目录或扁平列表。我们假定它返回足够的 paths（如果不够，PR 内调 server 加 recursive 标志；本 PR 任务里不展开）。

- [ ] **Step 1: 测试**

Create `apps/desktop/src/hooks/useFileTree.test.ts`:

```ts
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/api/client.js";
import { useFileTree } from "./useFileTree.js";

describe("useFileTree", () => {
  it("loads paths for a workspace", async () => {
    const api = {
      listFiles: vi.fn(async () => [
        { path: "README.md", name: "README.md", kind: "file" as const },
        { path: "src/App.tsx", name: "App.tsx", kind: "file" as const }
      ])
    } as unknown as ApiClient;
    const { result } = renderHook(() => useFileTree(api, "w"));
    await waitFor(() => expect(result.current.paths).toEqual(["README.md", "src/App.tsx"]));
  });

  it("returns empty when workspaceId is null", () => {
    const api = { listFiles: vi.fn() } as unknown as ApiClient;
    const { result } = renderHook(() => useFileTree(api, null));
    expect(result.current.paths).toEqual([]);
    expect(api.listFiles).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 失败**

Run: `pnpm --filter @marginalia/desktop test -- useFileTree`

Expected: FAIL。

- [ ] **Step 3: 实现**

Create `apps/desktop/src/hooks/useFileTree.ts`:

```ts
import { useEffect, useState } from "react";
import type { ApiClient } from "@/api/client.js";

export function useFileTree(api: ApiClient, workspaceId: string | null) {
  const [paths, setPaths] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!workspaceId) {
      setPaths([]);
      return;
    }
    let active = true;
    setLoading(true);
    api
      .listFiles(workspaceId)
      .then((items) => {
        if (!active) return;
        setPaths(Array.isArray(items) ? items.map((i) => i.path) : []);
        setError(null);
      })
      .catch((err: Error) => {
        if (active) setError(err);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [api, workspaceId]);

  return { paths, loading, error };
}
```

- [ ] **Step 4: 通过**

Run: `pnpm --filter @marginalia/desktop test -- useFileTree`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/hooks/useFileTree.ts apps/desktop/src/hooks/useFileTree.test.ts
git commit -m "feat(desktop): add useFileTree hook"
```

---

## Task 2: useDocumentContent hook（带缓存）

**Files:**
- Create: `apps/desktop/src/hooks/useDocumentContent.ts`
- Create: `apps/desktop/src/hooks/useDocumentContent.test.ts`

- [ ] **Step 1: 测试**

Create `apps/desktop/src/hooks/useDocumentContent.test.ts`:

```ts
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/api/client.js";
import { useDocumentContent } from "./useDocumentContent.js";

describe("useDocumentContent", () => {
  it("reads content via api and caches per path", async () => {
    const api = {
      readDocument: vi.fn(async (_w, p) => ({
        path: p,
        mime: "text/plain",
        text: `content of ${p}`,
        truncated: false
      }))
    } as unknown as ApiClient;
    const { result, rerender } = renderHook(({ path }: { path: string | null }) =>
      useDocumentContent(api, "w", path),
      { initialProps: { path: "a.txt" } }
    );
    await waitFor(() => expect(result.current.content?.text).toBe("content of a.txt"));
    rerender({ path: "a.txt" });
    expect(api.readDocument).toHaveBeenCalledTimes(1);
  });

  it("returns null when path is null", () => {
    const api = { readDocument: vi.fn() } as unknown as ApiClient;
    const { result } = renderHook(() => useDocumentContent(api, "w", null));
    expect(result.current.content).toBeNull();
  });

  it("captures errors", async () => {
    const api = {
      readDocument: vi.fn(async () => {
        throw new Error("boom");
      })
    } as unknown as ApiClient;
    const { result } = renderHook(() => useDocumentContent(api, "w", "x.txt"));
    await waitFor(() => expect(result.current.error?.message).toBe("boom"));
  });
});
```

- [ ] **Step 2: 失败**

Run: `pnpm --filter @marginalia/desktop test -- useDocumentContent`

Expected: FAIL。

- [ ] **Step 3: 实现**

Create `apps/desktop/src/hooks/useDocumentContent.ts`:

```ts
import { useEffect, useRef, useState } from "react";
import type { ApiClient, DocumentContent } from "@/api/client.js";

export function useDocumentContent(
  api: ApiClient,
  workspaceId: string,
  path: string | null
) {
  const cacheRef = useRef<Map<string, DocumentContent>>(new Map());
  const [content, setContent] = useState<DocumentContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!path) {
      setContent(null);
      return;
    }
    const cacheKey = `${workspaceId}::${path}`;
    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      setContent(cached);
      setError(null);
      return;
    }
    let active = true;
    setLoading(true);
    api
      .readDocument(workspaceId, path)
      .then((doc) => {
        if (!active) return;
        cacheRef.current.set(cacheKey, doc);
        setContent(doc);
        setError(null);
      })
      .catch((err: Error) => {
        if (active) {
          setError(err);
          setContent(null);
        }
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [api, workspaceId, path]);

  return { content, loading, error };
}
```

- [ ] **Step 4: 通过**

Run: `pnpm --filter @marginalia/desktop test -- useDocumentContent`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/hooks/useDocumentContent.ts apps/desktop/src/hooks/useDocumentContent.test.ts
git commit -m "feat(desktop): add useDocumentContent hook with in-memory cache"
```

---

## Task 3: DocumentTabs 组件

**Files:**
- Create: `apps/desktop/src/documents/DocumentTabs.tsx`
- Create: `apps/desktop/src/documents/DocumentTabs.test.tsx`

- [ ] **Step 1: 测试**

Create `apps/desktop/src/documents/DocumentTabs.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DocumentTabs } from "./DocumentTabs.js";

describe("DocumentTabs", () => {
  it("renders tabs with active highlight", () => {
    render(
      <DocumentTabs
        tabs={["README.md", "src/App.tsx"]}
        activeTab="src/App.tsx"
        onSelect={() => {}}
        onClose={() => {}}
        onAdd={() => {}}
      />
    );
    expect(screen.getByText("README.md")).toBeInTheDocument();
    expect(screen.getByText("App.tsx")).toBeInTheDocument();
  });

  it("close removes a tab", async () => {
    const onClose = vi.fn();
    render(
      <DocumentTabs
        tabs={["README.md"]}
        activeTab="README.md"
        onSelect={() => {}}
        onClose={onClose}
        onAdd={() => {}}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /close README\.md/i }));
    expect(onClose).toHaveBeenCalledWith("README.md");
  });

  it("select switches active tab", async () => {
    const onSelect = vi.fn();
    render(
      <DocumentTabs
        tabs={["README.md", "src/App.tsx"]}
        activeTab="README.md"
        onSelect={onSelect}
        onClose={() => {}}
        onAdd={() => {}}
      />
    );
    await userEvent.click(screen.getByText("App.tsx"));
    expect(onSelect).toHaveBeenCalledWith("src/App.tsx");
  });

  it("add button triggers onAdd", async () => {
    const onAdd = vi.fn();
    render(
      <DocumentTabs tabs={[]} activeTab={null} onSelect={() => {}} onClose={() => {}} onAdd={onAdd} />
    );
    await userEvent.click(screen.getByRole("button", { name: /add tab/i }));
    expect(onAdd).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 失败**

Run: `pnpm --filter @marginalia/desktop test -- DocumentTabs`

Expected: FAIL。

- [ ] **Step 3: 实现**

Create `apps/desktop/src/documents/DocumentTabs.tsx`:

```tsx
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/cn.js";

function basename(p: string): string {
  return p.split("/").pop() || p;
}

interface Props {
  tabs: readonly string[];
  activeTab: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onAdd: () => void;
}

export function DocumentTabs({ tabs, activeTab, onSelect, onClose, onAdd }: Props) {
  return (
    <div className="flex h-9 items-center gap-1 border-b border-border bg-muted/30 px-2 overflow-x-auto">
      {tabs.map((path) => (
        <div
          key={path}
          className={cn(
            "group flex h-7 items-center gap-1 rounded px-2 text-xs",
            activeTab === path ? "bg-background text-foreground" : "text-muted-foreground hover:bg-background/60"
          )}
        >
          <button type="button" className="truncate max-w-[160px]" onClick={() => onSelect(path)}>
            {basename(path)}
          </button>
          <button
            type="button"
            aria-label={`Close ${path}`}
            onClick={() => onClose(path)}
            className="opacity-0 group-hover:opacity-100 hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
      <button
        type="button"
        aria-label="Add tab"
        onClick={onAdd}
        className="ml-1 flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-background/60"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
```

- [ ] **Step 4: 通过**

Run: `pnpm --filter @marginalia/desktop test -- DocumentTabs`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/documents/DocumentTabs.tsx apps/desktop/src/documents/DocumentTabs.test.tsx
git commit -m "feat(desktop): add DocumentTabs component"
```

---

## Task 4: DocumentTree（pierre 封装）

**Files:**
- Create: `apps/desktop/src/documents/DocumentTree.tsx`
- Create: `apps/desktop/src/documents/DocumentTree.test.tsx`

pierre/trees 在 shadow root 渲染。React 入口的 API（参考 https://github.com/pierrecomputer/pierre/tree/main/packages/trees/src/react）大致是：

```tsx
import { FileTree } from "@pierre/trees/react";
<FileTree paths={paths} onSelect={...} />
```

如果实际 API 命名略不同（hook 风格 / class 风格），按 pierre/trees README 调整。本任务假设其 React entry export 了 `<FileTree>` 组件。如不可用，**fallback**：直接 `import { FileTree } from "@pierre/trees"` 然后用 `useEffect` + `tree.render({ containerWrapper })` 手动挂载到一个 `ref.current`。下面给出 React 组件包装的两种实现。

- [ ] **Step 1: 测试（最小契约）**

Create `apps/desktop/src/documents/DocumentTree.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DocumentTree } from "./DocumentTree.js";

describe("DocumentTree", () => {
  it("renders empty state when no paths", () => {
    render(<DocumentTree paths={[]} onSelect={() => {}} />);
    expect(screen.getByText(/no files/i)).toBeInTheDocument();
  });

  it("renders a host element when paths are provided", () => {
    const { container } = render(
      <DocumentTree paths={["README.md", "src/App.tsx"]} onSelect={() => {}} />
    );
    expect(container.querySelector("[data-pierre-tree-host]")).not.toBeNull();
  });
});
```

- [ ] **Step 2: 失败**

Run: `pnpm --filter @marginalia/desktop test -- DocumentTree`

Expected: FAIL。

- [ ] **Step 3: 实现（用命令式 API + ref）**

Create `apps/desktop/src/documents/DocumentTree.tsx`:

```tsx
import { useEffect, useRef } from "react";
import { FileTree } from "@pierre/trees";

interface Props {
  paths: readonly string[];
  onSelect: (path: string) => void;
}

export function DocumentTree({ paths, onSelect }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const treeRef = useRef<FileTree | null>(null);

  useEffect(() => {
    if (!hostRef.current || paths.length === 0) return;
    const tree = new FileTree({
      paths: [...paths],
      initialExpansion: "open",
      flattenEmptyDirectories: true,
      search: true
    });
    tree.render({ containerWrapper: hostRef.current });
    treeRef.current = tree;
    return () => {
      treeRef.current = null;
      if (hostRef.current) hostRef.current.innerHTML = "";
    };
  }, [paths]);

  // pierre/trees 的 onSelect / row-click 监听通过事件 hook；具体 API 按实际包文档对接。
  // 这里给出占位事件桥：监听 host 容器的自定义事件 "pierre:select"。
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    function handler(e: Event) {
      const detail = (e as CustomEvent<{ path: string }>).detail;
      if (detail?.path) onSelect(detail.path);
    }
    host.addEventListener("pierre:select", handler);
    return () => host.removeEventListener("pierre:select", handler);
  }, [onSelect]);

  if (paths.length === 0) {
    return <p className="px-3 py-2 text-xs text-muted-foreground">No files</p>;
  }
  return <div ref={hostRef} data-pierre-tree-host className="h-full overflow-auto p-1" />;
}
```

> ⚠️ **集成验证（实施者必做）**：在 dev 模式下用 pierre/trees 真实跑一次。若 `pierre:select` 事件名不对，根据 pierre/trees runtime 调试结果调整事件名或改用 pierre/trees 文档里的 selection callback API。如果 pierre/trees 提供 React 组件 `<FileTree>`（在 `@pierre/trees/react` 入口下），优先用：

```tsx
import { FileTree } from "@pierre/trees/react";
// <FileTree paths={[...paths]} onSelect={onSelect} />
```

- [ ] **Step 4: 通过**

Run: `pnpm --filter @marginalia/desktop test -- DocumentTree`

Expected: PASS（jsdom 跑得起；shadow DOM 渲染细节不在测试覆盖范围）。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/documents/DocumentTree.tsx apps/desktop/src/documents/DocumentTree.test.tsx
git commit -m "feat(desktop): add DocumentTree wrapper around @pierre/trees"
```

---

## Task 5: DocumentViewer

**Files:**
- Create: `apps/desktop/src/documents/DocumentViewer.tsx`
- Create: `apps/desktop/src/documents/DocumentViewer.test.tsx`

- [ ] **Step 1: 测试**

Create `apps/desktop/src/documents/DocumentViewer.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DocumentViewer } from "./DocumentViewer.js";

describe("DocumentViewer", () => {
  it("renders empty state when no content", () => {
    render(<DocumentViewer path={null} content={null} loading={false} error={null} />);
    expect(screen.getByText(/select a file/i)).toBeInTheDocument();
  });

  it("renders markdown for .md", () => {
    render(
      <DocumentViewer
        path="x.md"
        content={{ path: "x.md", mime: "text/markdown", text: "# Hi", truncated: false }}
        loading={false}
        error={null}
      />
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Hi");
  });

  it("renders code with highlight", () => {
    render(
      <DocumentViewer
        path="x.ts"
        content={{ path: "x.ts", mime: "text/plain", text: "const a = 1;", truncated: false }}
        loading={false}
        error={null}
      />
    );
    expect(document.querySelector("pre code")).not.toBeNull();
  });

  it("renders error", () => {
    render(<DocumentViewer path="x" content={null} loading={false} error={new Error("nope")} />);
    expect(screen.getByText("nope")).toBeInTheDocument();
  });

  it("renders truncated warning", () => {
    render(
      <DocumentViewer
        path="big"
        content={{ path: "big", mime: "text/plain", text: "...", truncated: true }}
        loading={false}
        error={null}
      />
    );
    expect(screen.getByText(/truncated/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 失败**

Run: `pnpm --filter @marginalia/desktop test -- DocumentViewer`

Expected: FAIL。

- [ ] **Step 3: 实现**

Create `apps/desktop/src/documents/DocumentViewer.tsx`:

```tsx
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { DocumentContent } from "@/api/client.js";
import { highlightCode } from "@/lib/highlight.js";
import { markdownComponents } from "@/lib/markdown.js";

function languageFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return ext;
}

interface Props {
  path: string | null;
  content: DocumentContent | null;
  loading: boolean;
  error: Error | null;
}

export function DocumentViewer({ path, content, loading, error }: Props) {
  if (!path) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Open file</p>
        <p>Select a file from the workspace tree</p>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-destructive">
        {error.message}
      </div>
    );
  }
  if (!content) return null;

  const isMarkdown = path.endsWith(".md") || content.mime === "text/markdown";
  const lang = languageFromPath(path);

  return (
    <div className="flex h-full flex-col overflow-auto">
      {content.truncated && (
        <p className="border-b border-border bg-muted/30 px-3 py-1 text-xs text-muted-foreground">
          File truncated for preview.
        </p>
      )}
      <div className="flex-1 p-3 text-sm">
        {isMarkdown ? (
          <div className="prose prose-sm max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {content.text}
            </ReactMarkdown>
          </div>
        ) : (
          <pre className="overflow-x-auto rounded-md bg-muted/40 p-3">
            <code
              className="hljs font-mono text-xs"
              dangerouslySetInnerHTML={{ __html: highlightCode(content.text, lang) }}
            />
          </pre>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 通过**

Run: `pnpm --filter @marginalia/desktop test -- DocumentViewer`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/documents/DocumentViewer.tsx apps/desktop/src/documents/DocumentViewer.test.tsx
git commit -m "feat(desktop): add DocumentViewer with markdown + code preview"
```

---

## Task 6: DocumentPanel（整合）

**Files:**
- Create: `apps/desktop/src/documents/DocumentPanel.tsx`
- Create: `apps/desktop/src/documents/DocumentPanel.test.tsx`

- [ ] **Step 1: 测试**

Create `apps/desktop/src/documents/DocumentPanel.test.tsx`:

```tsx
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/api/client.js";
import { useAppStore } from "@/store/app-store.js";
import { DocumentPanel } from "./DocumentPanel.js";

function fakeApi(): ApiClient {
  return {
    listFiles: vi.fn(async () => [
      { path: "README.md", name: "README.md", kind: "file" as const },
      { path: "src/App.tsx", name: "App.tsx", kind: "file" as const }
    ]),
    readDocument: vi.fn(async (_w, p) => ({
      path: p,
      mime: "text/markdown",
      text: "# Hi",
      truncated: false
    }))
  } as unknown as ApiClient;
}

describe("DocumentPanel", () => {
  beforeEach(() => {
    cleanup();
    useAppStore.setState({
      activeWorkspaceId: "w1",
      activeSessionId: "s1",
      view: "chat",
      pendingPrompt: null,
      contextFiles: [],
      leftSidebarCollapsed: false,
      rightPanelCollapsed: false
    });
  });

  it("shows empty state when no tabs are open", () => {
    render(<DocumentPanel api={fakeApi()} workspaceId="w1" />);
    expect(screen.getByText(/open file/i)).toBeInTheDocument();
  });

  it("opening file tree drawer toggles visibility", async () => {
    render(<DocumentPanel api={fakeApi()} workspaceId="w1" />);
    await userEvent.click(screen.getByRole("button", { name: /toggle file tree/i }));
    await waitFor(() => expect(screen.getByText(/loading|no files|src/i)).toBeInTheDocument());
  });

  it("attach to chat adds active tab path to context", async () => {
    const api = fakeApi();
    render(<DocumentPanel api={api} workspaceId="w1" />);
    // manually open a tab via direct hook (simulate via "+" Command — but for test, call store)
    // Use add-tab UX: in this test, we'll open via the tree drawer button — but to keep test simple,
    // we'll dispatch a custom event to simulate tree selection.
    const hostBefore = document.querySelector("[data-pierre-tree-host]");
    if (!hostBefore) {
      // open drawer first
      await userEvent.click(screen.getByRole("button", { name: /toggle file tree/i }));
    }
    await waitFor(() => document.querySelector("[data-pierre-tree-host]"));
    const host = document.querySelector("[data-pierre-tree-host]");
    host?.dispatchEvent(
      new CustomEvent("pierre:select", { detail: { path: "README.md" }, bubbles: true })
    );
    await waitFor(() => screen.getByRole("button", { name: /attach to chat/i }));
    await userEvent.click(screen.getByRole("button", { name: /attach to chat/i }));
    expect(useAppStore.getState().contextFiles).toContain("README.md");
  });
});
```

- [ ] **Step 2: 失败**

Run: `pnpm --filter @marginalia/desktop test -- DocumentPanel`

Expected: FAIL。

- [ ] **Step 3: 实现**

Create `apps/desktop/src/documents/DocumentPanel.tsx`:

```tsx
import { useState } from "react";
import { FolderTree } from "lucide-react";
import type { ApiClient } from "@/api/client.js";
import { Button } from "@/components/ui/button.js";
import { useDocumentContent } from "@/hooks/useDocumentContent.js";
import { useFileTree } from "@/hooks/useFileTree.js";
import { useAppStore } from "@/store/app-store.js";
import { cn } from "@/lib/cn.js";
import { DocumentTabs } from "./DocumentTabs.js";
import { DocumentTree } from "./DocumentTree.js";
import { DocumentViewer } from "./DocumentViewer.js";

export function DocumentPanel({ api, workspaceId }: { api: ApiClient; workspaceId: string }) {
  const [tabs, setTabs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [treeOpen, setTreeOpen] = useState(false);
  const tree = useFileTree(api, workspaceId);
  const doc = useDocumentContent(api, workspaceId, activeTab);
  const addContextFile = useAppStore((s) => s.addContextFile);

  function openTab(path: string) {
    setTabs((existing) => (existing.includes(path) ? existing : [...existing, path]));
    setActiveTab(path);
  }

  function closeTab(path: string) {
    setTabs((existing) => existing.filter((p) => p !== path));
    setActiveTab((current) => {
      if (current !== path) return current;
      const remaining = tabs.filter((p) => p !== path);
      return remaining[remaining.length - 1] ?? null;
    });
  }

  return (
    <div className="flex h-full flex-col">
      <DocumentTabs
        tabs={tabs}
        activeTab={activeTab}
        onSelect={setActiveTab}
        onClose={closeTab}
        onAdd={() => setTreeOpen(true)}
      />
      <div className="flex items-center gap-2 border-b border-border bg-muted/20 px-3 py-1.5 text-xs">
        <span className="flex-1 truncate text-muted-foreground">{activeTab ?? "/"}</span>
        <button
          type="button"
          aria-label="Toggle file tree"
          onClick={() => setTreeOpen((v) => !v)}
          className={cn(
            "rounded p-1 hover:bg-accent",
            treeOpen && "bg-accent text-foreground"
          )}
        >
          <FolderTree className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex flex-1 overflow-hidden">
        {treeOpen && (
          <div className="w-48 border-r border-border bg-muted/10 text-xs">
            {tree.loading && <p className="p-2 text-muted-foreground">Loading…</p>}
            {!tree.loading && <DocumentTree paths={tree.paths} onSelect={openTab} />}
          </div>
        )}
        <div className="flex-1 overflow-hidden">
          <DocumentViewer
            path={activeTab}
            content={doc.content}
            loading={doc.loading}
            error={doc.error}
          />
          {activeTab && (
            <div className="border-t border-border bg-background px-3 py-2 text-right">
              <Button
                variant="outline"
                size="sm"
                onClick={() => addContextFile(activeTab)}
                aria-label="Attach to chat"
              >
                Attach to chat
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 通过**

Run: `pnpm --filter @marginalia/desktop test -- DocumentPanel`

Expected: PASS（3 个用例）。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/documents/DocumentPanel.tsx apps/desktop/src/documents/DocumentPanel.test.tsx
git commit -m "feat(desktop): add DocumentPanel with tabs + tree drawer + viewer + attach"
```

---

## Task 7: 连接到 AppShell + 删除占位

**Files:**
- Modify: `apps/desktop/src/app/AppShell.tsx`
- Delete: `apps/desktop/src/app/placeholders.tsx`

- [ ] **Step 1: 替换占位**

Edit `apps/desktop/src/app/AppShell.tsx`：

- 删除 `import { DocumentPanelPlaceholder } from "./placeholders.js";`
- 增加 `import { DocumentPanel } from "@/documents/DocumentPanel.js";`
- 把右栏 `<DocumentPanelPlaceholder />` 替换成：

```tsx
{showRight && activeWorkspaceId && (
  <aside aria-label="Document panel" className="overflow-hidden border-l border-border">
    <DocumentPanel api={api} workspaceId={activeWorkspaceId} />
  </aside>
)}
```

（注意条件：右栏只在 `view==='chat' && !collapsed && activeWorkspaceId` 时显示）。

- [ ] **Step 2: 删除 placeholders 文件**

Run:
```bash
rm apps/desktop/src/app/placeholders.tsx
```

- [ ] **Step 3: typecheck**

Run: `pnpm --filter @marginalia/desktop typecheck`

Expected: 通过。

- [ ] **Step 4: 跑全套测试**

Run: `pnpm --filter @marginalia/desktop test`

Expected: 全绿。`AppShell.test.tsx` 中可能要给 chat 视图用例的 fetch mock 加上 `/files` 的返回，让 DocumentPanel 不抛错。例：

```ts
global.fetch = vi.fn(async (input) => {
  const url = String(input);
  if (url.includes("/files")) return new Response("[]", { headers: { "content-type": "application/json" } });
  return new Response("[]", { headers: { "content-type": "application/json" } });
});
```

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/app/AppShell.tsx
git rm apps/desktop/src/app/placeholders.tsx
git commit -m "feat(desktop): wire DocumentPanel into AppShell right panel, drop placeholder"
```

---

## Task 8: dev 烟测

- [ ] **Step 1: 启动 dev**

Run: `pnpm --filter @marginalia/desktop dev`

操作清单：
1. NewThread → 提交一条消息进入 chat
2. 右栏应显示 DocumentPanel，初始状态：空 tabs + "Open file / Select a file from the workspace tree"
3. 点路径条右侧 `FolderTree` 图标 — 抽屉打开，左侧是 pierre 文件树（应能看到 workspace 下的文件结构）
4. 点击一个文件（比如 `README.md`）— 应：
   - 文件出现在 tabs 中
   - 路径条更新
   - 主区域渲染 markdown 内容
5. 再点另一个文件（比如 `package.json`）— 第二个 tab 出现并激活
6. 点 tab 上的 × 关闭 — 当前关掉 → 切到剩下的；全关掉 → 回到空态
7. 点底部 "Attach to chat" — composer 输入区上方应出现文件徽章
8. 点 Topbar 的 PanelRight 按钮 — 右栏整体折叠/展开

Expected: pierre 文件树渲染、文件预览（markdown 与代码）、tab 切换、attach to chat 全部工作。

**已知风险**：pierre/trees 的 `pierre:select` 事件名可能不对；若树渲染但点击无效，去 pierre/trees 文档查实际 selection API，修改 `DocumentTree.tsx` 的事件桥。

---

## Definition of Done

- [ ] 8 个任务完成、每步 commit
- [ ] `pnpm test` 全绿
- [ ] `pnpm typecheck` 通过
- [ ] 右栏 DocumentPanel 在 chat 视图下渲染
- [ ] 文件树抽屉 + 多 tab + viewer + attach to chat 全部工作
- [ ] `placeholders.tsx` 已删除

下一 PR：`docs/internal/plans/2026-05-26-codex-ui-05-settings.md`
