# Codex UI 重写 · PR 3: NewThreadView + ChatView + Composer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现新版聊天主区域：`new-thread` 空态（hero + 输入框 + workspace/branch chip）与 `chat` 中态（消息流 + 底部 sticky composer）。Composer 集成 `@` 文件提及、`/` 斜杠命令、内联 Provider+Model 选择器。删除 PR 2 的 `MainPlaceholder`。

**Architecture:** Composer 是统一组件（NewThreadView 和 ChatView 都用），通过 props 控制是否显示 chip 行 / 是否调用 `useStreamingChat`。消息渲染用 `react-markdown` + 自封装的 highlight.js 代码块。Streaming 通过 `requestAnimationFrame` 每帧合并 delta，避免逐 token 重渲染。NewThreadView 提交 → 创建 session → 写 `pendingPrompt` 到 store → 切 view 到 `chat` → ChatView mount 后消费 `pendingPrompt`。

**Tech Stack:** react-markdown 9, remark-gfm 4, highlight.js 11 (按需载语言), Radix Popover/Command (shadcn cmdk 已 vendor)。

**Spec reference:** § NewThreadView, § ChatView, § 数据流（pendingPrompt 决策）, § 失败场景（streaming 中切 session、运行失败 Retry）。

---

## File Structure

新建：
- `apps/desktop/src/lib/highlight.ts` — highlight.js 实例 + 按需注册语言
- `apps/desktop/src/lib/markdown.ts` — react-markdown 共享组件配置
- `apps/desktop/src/hooks/useProviders.ts` + test
- `apps/desktop/src/hooks/useMessages.ts` + test
- `apps/desktop/src/hooks/useStreamingChat.ts` + test
- `apps/desktop/src/chat/MessageItem.tsx` + test — 单条消息（user/assistant）
- `apps/desktop/src/chat/MessageStream.tsx` + test — 整条消息列表 + 错误 + Retry
- `apps/desktop/src/chat/Composer/ModelPicker.tsx` + test — Popover provider+model
- `apps/desktop/src/chat/Composer/SlashMenu.tsx` + test — `/clear`、`/help`、`/model`
- `apps/desktop/src/chat/Composer/MentionMenu.tsx` + test — `@` 文件提及联想
- `apps/desktop/src/chat/Composer/WorkspaceChip.tsx` + test — 仅 new-thread 出现
- `apps/desktop/src/chat/Composer/BranchChip.tsx` + test — 仅在 getBranch 返回非 null 时
- `apps/desktop/src/chat/Composer/Composer.tsx` + test — 整合输入框 + slash/mention/model + chips
- `apps/desktop/src/chat/NewThreadView.tsx` + test
- `apps/desktop/src/chat/ChatView.tsx` + test

修改：
- `apps/desktop/src/api/client.ts` — 添加 `getBranch(workspaceId): Promise<string | null>`（容错）
- `apps/desktop/src/app/AppShell.tsx` — 替换 `MainPlaceholder` 为 view-based 主组件路由
- `apps/desktop/src/app/Topbar.tsx` — 接活动 session 标题
- `apps/desktop/src/app/placeholders.tsx` — 删除 `MainPlaceholder`（PR 5 时若仍有未用则一并删；本 PR 仅去掉对它的 import）

---

## Task 1: ApiClient.getBranch（容错）

**Files:**
- Modify: `apps/desktop/src/api/client.ts`
- Modify: `apps/desktop/src/api/client.test.ts`

- [ ] **Step 1: 在 client.test.ts 加一个用例**

Add to `apps/desktop/src/api/client.test.ts`（在合适的 describe 内）:

```ts
it("getBranch returns null on non-200", async () => {
  global.fetch = vi.fn(async () => new Response("not found", { status: 404 }));
  const api = new ApiClient("http://x");
  await expect(api.getBranch("w")).resolves.toBeNull();
});

it("getBranch returns branch name on success", async () => {
  global.fetch = vi.fn(
    async () =>
      new Response(JSON.stringify({ branch: "main" }), {
        headers: { "content-type": "application/json" }
      })
  );
  const api = new ApiClient("http://x");
  await expect(api.getBranch("w")).resolves.toBe("main");
});
```

- [ ] **Step 2: 测试失败**

Run: `pnpm --filter @marginalia/desktop test -- client`

Expected: FAIL — `getBranch` 不存在。

- [ ] **Step 3: 在 client.ts 加 getBranch**

Add to `ApiClient` class in `apps/desktop/src/api/client.ts`:

```ts
async getBranch(workspaceId: string): Promise<string | null> {
  try {
    const response = await fetch(`${this.baseUrl}/workspaces/${workspaceId}/branch`);
    if (!response.ok) return null;
    const body = (await response.json()) as { branch?: string };
    return body.branch ?? null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: 测试通过**

Run: `pnpm --filter @marginalia/desktop test -- client`

Expected: PASS。

- [ ] **Step 5: Commit**

Run:
```bash
git add apps/desktop/src/api/client.ts apps/desktop/src/api/client.test.ts
git commit -m "feat(desktop): add ApiClient.getBranch with null fallback"
```

---

## Task 2: useProviders hook

**Files:**
- Create: `apps/desktop/src/hooks/useProviders.ts`
- Create: `apps/desktop/src/hooks/useProviders.test.ts`

- [ ] **Step 1: 写测试**

Create `apps/desktop/src/hooks/useProviders.test.ts`:

```ts
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/api/client.js";
import { useProviders } from "./useProviders.js";

describe("useProviders", () => {
  it("loads providers on mount", async () => {
    const api = {
      listProviders: vi.fn(async () => [
        { id: "p1", name: "OpenAI", defaultModel: "gpt-4" }
      ])
    } as unknown as ApiClient;
    const { result } = renderHook(() => useProviders(api));
    await waitFor(() => expect(result.current.data).toHaveLength(1));
  });
});
```

- [ ] **Step 2: 测试失败**

Run: `pnpm --filter @marginalia/desktop test -- useProviders`

Expected: FAIL。

- [ ] **Step 3: 实现**

Create `apps/desktop/src/hooks/useProviders.ts`:

```ts
import { useEffect, useState } from "react";
import type { ApiClient, Provider } from "@/api/client.js";

export function useProviders(api: ApiClient) {
  const [data, setData] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api
      .listProviders()
      .then((items) => {
        if (active) setData(Array.isArray(items) ? items : []);
      })
      .catch(() => {})
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [api]);

  return { data, loading };
}
```

- [ ] **Step 4: 测试通过**

Run: `pnpm --filter @marginalia/desktop test -- useProviders`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/hooks/useProviders.ts apps/desktop/src/hooks/useProviders.test.ts
git commit -m "feat(desktop): add useProviders hook"
```

---

## Task 3: useMessages hook

**Files:**
- Create: `apps/desktop/src/hooks/useMessages.ts`
- Create: `apps/desktop/src/hooks/useMessages.test.ts`

- [ ] **Step 1: 测试**

Create `apps/desktop/src/hooks/useMessages.test.ts`:

```ts
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient, Message } from "@/api/client.js";
import { useMessages } from "./useMessages.js";

describe("useMessages", () => {
  it("loads messages for session", async () => {
    const api = {
      listMessages: vi.fn(async () => [
        { id: "m1", role: "user", content: "hi" }
      ] as Message[])
    } as unknown as ApiClient;
    const { result } = renderHook(() => useMessages(api, "s1"));
    await waitFor(() => expect(result.current.data).toHaveLength(1));
  });

  it("returns empty when sessionId is null", () => {
    const api = { listMessages: vi.fn() } as unknown as ApiClient;
    const { result } = renderHook(() => useMessages(api, null));
    expect(result.current.data).toEqual([]);
    expect(api.listMessages).not.toHaveBeenCalled();
  });

  it("append + replaceLast support streaming updates", () => {
    const api = { listMessages: vi.fn(async () => []) } as unknown as ApiClient;
    const { result } = renderHook(() => useMessages(api, "s1"));
    act(() => {
      result.current.append({ id: "x", role: "user", content: "u" });
      result.current.append({ id: "y", role: "assistant", content: "" });
    });
    act(() => {
      result.current.appendToLast("hello");
      result.current.appendToLast(" world");
    });
    expect(result.current.data[1].content).toBe("hello world");
  });
});
```

- [ ] **Step 2: 测试失败**

Run: `pnpm --filter @marginalia/desktop test -- useMessages`

Expected: FAIL。

- [ ] **Step 3: 实现**

Create `apps/desktop/src/hooks/useMessages.ts`:

```ts
import { useCallback, useEffect, useState } from "react";
import type { ApiClient, Message } from "@/api/client.js";

export function useMessages(api: ApiClient, sessionId: string | null) {
  const [data, setData] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sessionId) {
      setData([]);
      return;
    }
    let active = true;
    setLoading(true);
    api
      .listMessages(sessionId)
      .then((items) => {
        if (active) setData(Array.isArray(items) ? items : []);
      })
      .catch(() => {})
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [api, sessionId]);

  const append = useCallback((m: Message) => {
    setData((items) => [...items, m]);
  }, []);

  const appendToLast = useCallback((delta: string) => {
    setData((items) => {
      if (items.length === 0) return items;
      const last = items[items.length - 1];
      const next = items.slice(0, -1);
      next.push({ ...last, content: last.content + delta });
      return next;
    });
  }, []);

  return { data, loading, append, appendToLast, set: setData };
}
```

- [ ] **Step 4: 测试通过**

Run: `pnpm --filter @marginalia/desktop test -- useMessages`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/hooks/useMessages.ts apps/desktop/src/hooks/useMessages.test.ts
git commit -m "feat(desktop): add useMessages hook with append helpers"
```

---

## Task 4: useStreamingChat hook（rAF 节流）

**Files:**
- Create: `apps/desktop/src/hooks/useStreamingChat.ts`
- Create: `apps/desktop/src/hooks/useStreamingChat.test.ts`

- [ ] **Step 1: 测试**

Create `apps/desktop/src/hooks/useStreamingChat.test.ts`:

```ts
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient, RunEvent } from "@/api/client.js";
import { useStreamingChat } from "./useStreamingChat.js";

async function* makeEvents(events: RunEvent[]) {
  for (const e of events) {
    yield e;
  }
}

describe("useStreamingChat", () => {
  beforeEach(() => vi.useRealTimers());

  it("sends a message and accumulates assistant deltas", async () => {
    const onUserAppend = vi.fn();
    const onAssistantStart = vi.fn();
    const onAssistantDelta = vi.fn();
    const onComplete = vi.fn();

    const api = {
      runChat: vi.fn(async () =>
        makeEvents([
          { type: "assistant_delta", payload: { text: "hel" } },
          { type: "assistant_delta", payload: { text: "lo" } }
        ])
      ),
      createMessage: vi.fn(async (_sid, input) => ({ id: "u", role: input.role, content: input.content }))
    } as unknown as ApiClient;

    const { result } = renderHook(() =>
      useStreamingChat({
        api,
        sessionId: "s",
        providerId: "p",
        model: "m",
        onUserAppend,
        onAssistantStart,
        onAssistantDelta,
        onComplete
      })
    );

    await act(async () => {
      await result.current.send("hi", []);
    });

    await waitFor(() => expect(onAssistantDelta).toHaveBeenCalled());
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    const total = onAssistantDelta.mock.calls.reduce((acc, [s]) => acc + s, "");
    expect(total).toBe("hello");
    expect(onUserAppend).toHaveBeenCalled();
    expect(onAssistantStart).toHaveBeenCalled();
  });

  it("sets error on run_failed and stops", async () => {
    const onError = vi.fn();
    const api = {
      runChat: vi.fn(async () =>
        makeEvents([{ type: "run_failed", payload: { error: "boom" } }])
      ),
      createMessage: vi.fn(async () => ({ id: "u", role: "user", content: "" }))
    } as unknown as ApiClient;
    const { result } = renderHook(() =>
      useStreamingChat({
        api,
        sessionId: "s",
        providerId: "p",
        model: "m",
        onUserAppend: vi.fn(),
        onAssistantStart: vi.fn(),
        onAssistantDelta: vi.fn(),
        onComplete: vi.fn(),
        onError
      })
    );
    await act(async () => {
      await result.current.send("hi", []);
    });
    await waitFor(() => expect(onError).toHaveBeenCalledWith("boom"));
  });
});
```

- [ ] **Step 2: 测试失败**

Run: `pnpm --filter @marginalia/desktop test -- useStreamingChat`

Expected: FAIL。

- [ ] **Step 3: 实现**

Create `apps/desktop/src/hooks/useStreamingChat.ts`:

```ts
import { useCallback, useRef, useState } from "react";
import type { ApiClient, Message } from "@/api/client.js";

interface Options {
  api: ApiClient;
  sessionId: string | null;
  providerId: string;
  model: string;
  onUserAppend: (m: Message) => void;
  onAssistantStart: (m: Message) => void;
  onAssistantDelta: (delta: string) => void;
  onComplete: () => void;
  onError?: (msg: string) => void;
}

export function useStreamingChat(opts: Options) {
  const [sending, setSending] = useState(false);
  const bufferRef = useRef("");
  const rafRef = useRef<number | null>(null);

  function flush() {
    if (bufferRef.current.length > 0) {
      const text = bufferRef.current;
      bufferRef.current = "";
      opts.onAssistantDelta(text);
    }
    rafRef.current = null;
  }

  function schedule() {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(flush);
  }

  const send = useCallback(
    async (text: string, contextFiles: string[]) => {
      if (!opts.sessionId || !text.trim()) return;
      setSending(true);
      const savedUser = await opts.api.createMessage(opts.sessionId, {
        role: "user",
        content: text
      });
      opts.onUserAppend(savedUser);
      opts.onAssistantStart({
        id: `local-assistant-${Date.now()}`,
        role: "assistant",
        content: ""
      });
      try {
        const events = await opts.api.runChat(opts.sessionId, {
          providerId: opts.providerId,
          model: opts.model,
          message: text,
          contextFiles
        });
        for await (const event of events) {
          if (event.type === "assistant_delta") {
            const delta = (event.payload as { text?: string } | undefined)?.text ?? "";
            if (delta) {
              bufferRef.current += delta;
              schedule();
            }
          }
          if (event.type === "run_failed") {
            const errMsg = (event.payload as { error?: string } | undefined)?.error ?? "run failed";
            throw new Error(errMsg);
          }
        }
        flush();
        opts.onComplete();
      } catch (err) {
        flush();
        opts.onError?.((err as Error).message);
      } finally {
        setSending(false);
      }
    },
    [opts]
  );

  return { send, sending };
}
```

- [ ] **Step 4: 测试通过**

Run: `pnpm --filter @marginalia/desktop test -- useStreamingChat`

Expected: PASS（2 个用例）。注意：jsdom 默认有 `requestAnimationFrame`，无需 mock。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/hooks/useStreamingChat.ts apps/desktop/src/hooks/useStreamingChat.test.ts
git commit -m "feat(desktop): add useStreamingChat with rAF-throttled deltas"
```

---

## Task 5: highlight.js + markdown 工具

**Files:**
- Create: `apps/desktop/src/lib/highlight.ts`
- Create: `apps/desktop/src/lib/markdown.ts`

- [ ] **Step 1: 实现 highlight 包装**

Create `apps/desktop/src/lib/highlight.ts`:

```ts
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import "highlight.js/styles/github.css";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("md", markdown);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("tsx", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("yml", yaml);

export function highlightCode(code: string, language?: string): string {
  const lang = (language || "").toLowerCase();
  if (lang && hljs.getLanguage(lang)) {
    try {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    } catch {
      // ignore
    }
  }
  return hljs.highlightAuto(code).value;
}
```

- [ ] **Step 2: 实现 markdown 组件**

Create `apps/desktop/src/lib/markdown.ts`:

```ts
import type { Components } from "react-markdown";
import { highlightCode } from "./highlight.js";

export const markdownComponents: Components = {
  code({ inline, className, children, ...props }) {
    const raw = String(children).replace(/\n$/, "");
    if (inline) {
      return (
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]" {...props}>
          {raw}
        </code>
      );
    }
    const language = /language-(\w+)/.exec(className || "")?.[1];
    const html = highlightCode(raw, language);
    return (
      <pre className="my-2 overflow-x-auto rounded-md border border-border bg-muted/50 p-3">
        <code
          className={`hljs font-mono text-xs ${className || ""}`}
          dangerouslySetInnerHTML={{ __html: html }}
          {...props}
        />
      </pre>
    );
  },
  a({ children, href, ...rest }) {
    return (
      <a className="text-primary underline" href={href} target="_blank" rel="noreferrer" {...rest}>
        {children}
      </a>
    );
  }
};
```

⚠️ 这是 `.ts` 文件用了 JSX — 改后缀为 `.tsx`，让 TS 认识 JSX：

Run:
```bash
mv apps/desktop/src/lib/markdown.ts apps/desktop/src/lib/markdown.tsx
```

- [ ] **Step 3: typecheck**

Run: `pnpm --filter @marginalia/desktop typecheck`

Expected: 通过。

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/lib/highlight.ts apps/desktop/src/lib/markdown.tsx
git commit -m "feat(desktop): add highlight.js + markdown rendering helpers"
```

---

## Task 6: MessageItem

**Files:**
- Create: `apps/desktop/src/chat/MessageItem.tsx`
- Create: `apps/desktop/src/chat/MessageItem.test.tsx`

- [ ] **Step 1: 测试**

Create `apps/desktop/src/chat/MessageItem.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MessageItem } from "./MessageItem.js";

describe("MessageItem", () => {
  it("renders user content right-aligned in a pill", () => {
    render(<MessageItem message={{ id: "1", role: "user", content: "hello" }} />);
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("renders assistant content as markdown with label", () => {
    render(
      <MessageItem
        message={{ id: "2", role: "assistant", content: "**bold**" }}
      />
    );
    expect(screen.getByText("assistant")).toBeInTheDocument();
    expect(screen.getByText("bold").tagName).toBe("STRONG");
  });
});
```

- [ ] **Step 2: 测试失败**

Run: `pnpm --filter @marginalia/desktop test -- MessageItem`

Expected: FAIL。

- [ ] **Step 3: 实现**

Create `apps/desktop/src/chat/MessageItem.tsx`:

```tsx
import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message } from "@/api/client.js";
import { markdownComponents } from "@/lib/markdown.js";

function MessageItemImpl({ message }: { message: Message }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[70%] whitespace-pre-wrap rounded-2xl bg-muted px-3 py-2 text-sm">
          {message.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">assistant</span>
      <div className="prose prose-sm max-w-none text-sm leading-relaxed">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {message.content}
        </ReactMarkdown>
      </div>
    </div>
  );
}

export const MessageItem = memo(MessageItemImpl);
```

- [ ] **Step 4: 测试通过**

Run: `pnpm --filter @marginalia/desktop test -- MessageItem`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/chat/MessageItem.tsx apps/desktop/src/chat/MessageItem.test.tsx
git commit -m "feat(desktop): add MessageItem with markdown rendering"
```

---

## Task 7: MessageStream

**Files:**
- Create: `apps/desktop/src/chat/MessageStream.tsx`
- Create: `apps/desktop/src/chat/MessageStream.test.tsx`

- [ ] **Step 1: 测试**

Create `apps/desktop/src/chat/MessageStream.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MessageStream } from "./MessageStream.js";

describe("MessageStream", () => {
  it("renders empty state when no messages", () => {
    render(<MessageStream messages={[]} error={null} onRetry={() => {}} />);
    expect(screen.getByText(/no messages/i)).toBeInTheDocument();
  });

  it("renders messages", () => {
    render(
      <MessageStream
        messages={[
          { id: "1", role: "user", content: "hi" },
          { id: "2", role: "assistant", content: "yo" }
        ]}
        error={null}
        onRetry={() => {}}
      />
    );
    expect(screen.getByText("hi")).toBeInTheDocument();
    expect(screen.getByText("yo")).toBeInTheDocument();
  });

  it("renders error row + retry button", async () => {
    const onRetry = vi.fn();
    render(
      <MessageStream
        messages={[{ id: "1", role: "user", content: "hi" }]}
        error="boom"
        onRetry={onRetry}
      />
    );
    expect(screen.getByText("boom")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 测试失败**

Run: `pnpm --filter @marginalia/desktop test -- MessageStream`

Expected: FAIL。

- [ ] **Step 3: 实现**

Create `apps/desktop/src/chat/MessageStream.tsx`:

```tsx
import { useEffect, useRef } from "react";
import type { Message } from "@/api/client.js";
import { Button } from "@/components/ui/button.js";
import { MessageItem } from "./MessageItem.js";

interface Props {
  messages: readonly Message[];
  error: string | null;
  onRetry: () => void;
}

export function MessageStream({ messages, error, onRetry }: Props) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  if (messages.length === 0 && !error) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No messages yet
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
      {messages.map((m) => (
        <MessageItem key={m.id} message={m} />
      ))}
      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <span className="flex-1">{error}</span>
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
```

- [ ] **Step 4: 测试通过**

Run: `pnpm --filter @marginalia/desktop test -- MessageStream`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/chat/MessageStream.tsx apps/desktop/src/chat/MessageStream.test.tsx
git commit -m "feat(desktop): add MessageStream with autoscroll and error retry"
```

---

## Task 8: ModelPicker

**Files:**
- Create: `apps/desktop/src/chat/Composer/ModelPicker.tsx`
- Create: `apps/desktop/src/chat/Composer/ModelPicker.test.tsx`

- [ ] **Step 1: 测试**

Create `apps/desktop/src/chat/Composer/ModelPicker.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModelPicker } from "./ModelPicker.js";

const providers = [
  { id: "p1", name: "Minimax", defaultModel: "M2.7" },
  { id: "p2", name: "OpenAI", defaultModel: "gpt-4o" }
];

describe("ModelPicker", () => {
  it("shows current model on trigger", () => {
    render(
      <ModelPicker providers={providers} providerId="p1" model="M2.7" onChange={() => {}} />
    );
    expect(screen.getByRole("button", { name: /Minimax · M2.7/i })).toBeInTheDocument();
  });

  it("changing provider calls onChange with default model of new provider", async () => {
    const onChange = vi.fn();
    render(
      <ModelPicker providers={providers} providerId="p1" model="M2.7" onChange={onChange} />
    );
    await userEvent.click(screen.getByRole("button", { name: /Minimax/i }));
    await waitFor(() => screen.getByText("OpenAI"));
    await userEvent.click(screen.getByText("OpenAI"));
    expect(onChange).toHaveBeenCalledWith({ providerId: "p2", model: "gpt-4o" });
  });
});
```

- [ ] **Step 2: 测试失败**

Run: `pnpm --filter @marginalia/desktop test -- ModelPicker`

Expected: FAIL。

- [ ] **Step 3: 实现**

Create `apps/desktop/src/chat/Composer/ModelPicker.tsx`:

```tsx
import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { Provider } from "@/api/client.js";
import { Button } from "@/components/ui/button.js";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover.js";
import { cn } from "@/lib/cn.js";

interface Props {
  providers: readonly Provider[];
  providerId: string;
  model: string;
  onChange: (next: { providerId: string; model: string }) => void;
}

export function ModelPicker({ providers, providerId, model, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const active = providers.find((p) => p.id === providerId);
  const label = active ? `${active.name} · ${model || active.defaultModel}` : "Select model";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1 text-xs font-normal">
          {label}
          <ChevronDown className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1">
        {providers.length === 0 && (
          <p className="p-2 text-xs text-muted-foreground">No providers configured</p>
        )}
        {providers.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => {
              onChange({ providerId: p.id, model: p.defaultModel });
              setOpen(false);
            }}
            className={cn(
              "flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent",
              p.id === providerId && "bg-accent"
            )}
          >
            <span className="flex flex-col">
              <span className="font-medium">{p.name}</span>
              <span className="text-muted-foreground">{p.defaultModel}</span>
            </span>
            {p.id === providerId && <Check className="h-3 w-3" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 4: 测试通过**

Run: `pnpm --filter @marginalia/desktop test -- ModelPicker`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/chat/Composer/ModelPicker.tsx apps/desktop/src/chat/Composer/ModelPicker.test.tsx
git commit -m "feat(desktop): add ModelPicker popover"
```

---

## Task 9: SlashMenu + MentionMenu

**Files:**
- Create: `apps/desktop/src/chat/Composer/SlashMenu.tsx`
- Create: `apps/desktop/src/chat/Composer/SlashMenu.test.tsx`
- Create: `apps/desktop/src/chat/Composer/MentionMenu.tsx`
- Create: `apps/desktop/src/chat/Composer/MentionMenu.test.tsx`

- [ ] **Step 1: SlashMenu 测试**

Create `apps/desktop/src/chat/Composer/SlashMenu.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SlashMenu } from "./SlashMenu.js";

describe("SlashMenu", () => {
  it("filters by query and selects with click", async () => {
    const onSelect = vi.fn();
    render(<SlashMenu query="cle" onSelect={onSelect} onClose={() => {}} />);
    expect(screen.getByText("/clear")).toBeInTheDocument();
    expect(screen.queryByText("/help")).toBeNull();
    await userEvent.click(screen.getByText("/clear"));
    expect(onSelect).toHaveBeenCalledWith("clear");
  });
});
```

- [ ] **Step 2: SlashMenu 实现**

Create `apps/desktop/src/chat/Composer/SlashMenu.tsx`:

```tsx
import { useEffect } from "react";

const COMMANDS: { name: string; help: string }[] = [
  { name: "clear", help: "Clear current messages from view" },
  { name: "help", help: "Show keyboard shortcuts" },
  { name: "model", help: "Open the model picker" }
];

interface Props {
  query: string;
  onSelect: (name: string) => void;
  onClose: () => void;
}

export function SlashMenu({ query, onSelect, onClose }: Props) {
  const filtered = COMMANDS.filter((c) => c.name.startsWith(query.toLowerCase()));

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (filtered.length === 0) return null;
  return (
    <div className="absolute bottom-full left-0 mb-2 w-64 overflow-hidden rounded-md border border-border bg-popover shadow-md">
      {filtered.map((c) => (
        <button
          key={c.name}
          type="button"
          className="flex w-full items-baseline gap-2 px-3 py-2 text-left text-xs hover:bg-accent"
          onClick={() => onSelect(c.name)}
        >
          <span className="font-mono font-medium">/{c.name}</span>
          <span className="text-muted-foreground">{c.help}</span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: SlashMenu 测试通过**

Run: `pnpm --filter @marginalia/desktop test -- SlashMenu`

Expected: PASS。

- [ ] **Step 4: MentionMenu 测试**

Create `apps/desktop/src/chat/Composer/MentionMenu.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MentionMenu } from "./MentionMenu.js";

describe("MentionMenu", () => {
  it("renders nothing when empty", () => {
    const { container } = render(
      <MentionMenu suggestions={[]} onSelect={() => {}} onClose={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("selects a file on click", async () => {
    const onSelect = vi.fn();
    render(
      <MentionMenu
        suggestions={[{ path: "src/App.tsx" }, { path: "README.md" }]}
        onSelect={onSelect}
        onClose={() => {}}
      />
    );
    await userEvent.click(screen.getByText("src/App.tsx"));
    expect(onSelect).toHaveBeenCalledWith("src/App.tsx");
  });
});
```

- [ ] **Step 5: MentionMenu 实现**

Create `apps/desktop/src/chat/Composer/MentionMenu.tsx`:

```tsx
import { useEffect } from "react";
import { FileText } from "lucide-react";

interface Props {
  suggestions: readonly { path: string }[];
  onSelect: (path: string) => void;
  onClose: () => void;
}

export function MentionMenu({ suggestions, onSelect, onClose }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (suggestions.length === 0) return null;
  return (
    <div className="absolute bottom-full left-0 mb-2 max-h-64 w-72 overflow-auto rounded-md border border-border bg-popover shadow-md">
      {suggestions.map((s) => (
        <button
          key={s.path}
          type="button"
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent"
          onClick={() => onSelect(s.path)}
        >
          <FileText className="h-3 w-3 text-muted-foreground" />
          <span className="truncate">{s.path}</span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: MentionMenu 测试通过**

Run: `pnpm --filter @marginalia/desktop test -- MentionMenu`

Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/chat/Composer/SlashMenu.tsx apps/desktop/src/chat/Composer/SlashMenu.test.tsx \
       apps/desktop/src/chat/Composer/MentionMenu.tsx apps/desktop/src/chat/Composer/MentionMenu.test.tsx
git commit -m "feat(desktop): add SlashMenu and MentionMenu popovers"
```

---

## Task 10: WorkspaceChip + BranchChip

**Files:**
- Create: `apps/desktop/src/chat/Composer/WorkspaceChip.tsx`
- Create: `apps/desktop/src/chat/Composer/WorkspaceChip.test.tsx`
- Create: `apps/desktop/src/chat/Composer/BranchChip.tsx`
- Create: `apps/desktop/src/chat/Composer/BranchChip.test.tsx`

- [ ] **Step 1: WorkspaceChip 测试**

Create `apps/desktop/src/chat/Composer/WorkspaceChip.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceChip } from "./WorkspaceChip.js";

const workspaces = [
  { id: "w1", name: "alpha", rootDir: "/a" },
  { id: "w2", name: "beta", rootDir: "/b" }
];

describe("WorkspaceChip", () => {
  it("shows active workspace name or placeholder", () => {
    const { rerender } = render(
      <WorkspaceChip workspaces={workspaces} activeId="w1" onSelect={() => {}} onNew={() => {}} />
    );
    expect(screen.getByRole("button", { name: /alpha/i })).toBeInTheDocument();
    rerender(
      <WorkspaceChip workspaces={workspaces} activeId={null} onSelect={() => {}} onNew={() => {}} />
    );
    expect(screen.getByRole("button", { name: /select workspace/i })).toBeInTheDocument();
  });

  it("selects a workspace from dropdown", async () => {
    const onSelect = vi.fn();
    render(
      <WorkspaceChip workspaces={workspaces} activeId="w1" onSelect={onSelect} onNew={() => {}} />
    );
    await userEvent.click(screen.getByRole("button", { name: /alpha/i }));
    await userEvent.click(screen.getByText("beta"));
    expect(onSelect).toHaveBeenCalledWith("w2");
  });
});
```

- [ ] **Step 2: WorkspaceChip 实现**

Create `apps/desktop/src/chat/Composer/WorkspaceChip.tsx`:

```tsx
import { ChevronDown, Folder, Plus } from "lucide-react";
import type { Workspace } from "@/api/client.js";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu.js";

interface Props {
  workspaces: readonly Workspace[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}

export function WorkspaceChip({ workspaces, activeId, onSelect, onNew }: Props) {
  const active = workspaces.find((w) => w.id === activeId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 text-xs font-normal">
          <Folder className="h-3 w-3" />
          {active ? active.name : "Select workspace…"}
          <ChevronDown className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[200px]">
        {workspaces.map((w) => (
          <DropdownMenuItem key={w.id} onSelect={() => onSelect(w.id)}>
            <Folder className="mr-2 h-3 w-3" />
            {w.name}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onNew}>
          <Plus className="mr-2 h-3 w-3" />
          New workspace…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 3: WorkspaceChip 测试通过**

Run: `pnpm --filter @marginalia/desktop test -- WorkspaceChip`

Expected: PASS。

- [ ] **Step 4: BranchChip 测试**

Create `apps/desktop/src/chat/Composer/BranchChip.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/api/client.js";
import { BranchChip } from "./BranchChip.js";

describe("BranchChip", () => {
  it("renders nothing when getBranch returns null", async () => {
    const api = { getBranch: vi.fn(async () => null) } as unknown as ApiClient;
    const { container } = render(<BranchChip api={api} workspaceId="w" />);
    await waitFor(() => expect(api.getBranch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("renders branch name", async () => {
    const api = { getBranch: vi.fn(async () => "main") } as unknown as ApiClient;
    render(<BranchChip api={api} workspaceId="w" />);
    await waitFor(() => expect(screen.getByText("main")).toBeInTheDocument());
  });
});
```

- [ ] **Step 5: BranchChip 实现**

Create `apps/desktop/src/chat/Composer/BranchChip.tsx`:

```tsx
import { useEffect, useState } from "react";
import { GitBranch } from "lucide-react";
import type { ApiClient } from "@/api/client.js";

export function BranchChip({ api, workspaceId }: { api: ApiClient; workspaceId: string }) {
  const [branch, setBranch] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    api.getBranch(workspaceId).then((b) => {
      if (active) setBranch(b);
    });
    return () => {
      active = false;
    };
  }, [api, workspaceId]);
  if (!branch) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground">
      <GitBranch className="h-3 w-3" />
      {branch}
    </span>
  );
}
```

- [ ] **Step 6: BranchChip 测试通过**

Run: `pnpm --filter @marginalia/desktop test -- BranchChip`

Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/chat/Composer/WorkspaceChip.tsx apps/desktop/src/chat/Composer/WorkspaceChip.test.tsx \
       apps/desktop/src/chat/Composer/BranchChip.tsx apps/desktop/src/chat/Composer/BranchChip.test.tsx
git commit -m "feat(desktop): add WorkspaceChip + BranchChip"
```

---

## Task 11: Composer

**Files:**
- Create: `apps/desktop/src/chat/Composer/Composer.tsx`
- Create: `apps/desktop/src/chat/Composer/Composer.test.tsx`

Composer 接收 props 控制行为，**不直接调 streaming hook**——由父组件（ChatView / NewThreadView）注入 `onSubmit`。这样保持 Composer 是受控的纯 UI。

- [ ] **Step 1: 测试**

Create `apps/desktop/src/chat/Composer/Composer.test.tsx`:

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/api/client.js";
import { Composer } from "./Composer.js";

const providers = [{ id: "p1", name: "Minimax", defaultModel: "M2.7" }];

function api(): ApiClient {
  return {
    searchFiles: vi.fn(async () => [{ path: "src/App.tsx" }])
  } as unknown as ApiClient;
}

describe("Composer", () => {
  beforeEach(() => cleanup());

  it("submits text via Send button", async () => {
    const onSubmit = vi.fn();
    render(
      <Composer
        api={api()}
        workspaceId="w"
        providers={providers}
        providerId="p1"
        model="M2.7"
        onModelChange={vi.fn()}
        contextFiles={[]}
        onAddContextFile={vi.fn()}
        onRemoveContextFile={vi.fn()}
        sending={false}
        onSubmit={onSubmit}
        placeholder="Do anything…"
      />
    );
    await userEvent.type(screen.getByRole("textbox", { name: /message/i }), "hello");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    expect(onSubmit).toHaveBeenCalledWith("hello");
  });

  it("Ctrl/Cmd+Enter submits", async () => {
    const onSubmit = vi.fn();
    render(
      <Composer
        api={api()}
        workspaceId="w"
        providers={providers}
        providerId="p1"
        model="M2.7"
        onModelChange={vi.fn()}
        contextFiles={[]}
        onAddContextFile={vi.fn()}
        onRemoveContextFile={vi.fn()}
        sending={false}
        onSubmit={onSubmit}
        placeholder=""
      />
    );
    const input = screen.getByRole("textbox", { name: /message/i });
    await userEvent.type(input, "hi");
    await userEvent.keyboard("{Meta>}{Enter}{/Meta}");
    expect(onSubmit).toHaveBeenCalledWith("hi");
  });

  it("@ shows mention menu and selecting adds context file", async () => {
    const onAdd = vi.fn();
    render(
      <Composer
        api={api()}
        workspaceId="w"
        providers={providers}
        providerId="p1"
        model="M2.7"
        onModelChange={vi.fn()}
        contextFiles={[]}
        onAddContextFile={onAdd}
        onRemoveContextFile={vi.fn()}
        sending={false}
        onSubmit={vi.fn()}
        placeholder=""
      />
    );
    await userEvent.type(screen.getByRole("textbox", { name: /message/i }), "@");
    await userEvent.click(await screen.findByText("src/App.tsx"));
    expect(onAdd).toHaveBeenCalledWith("src/App.tsx");
  });

  it("disables send while sending", () => {
    render(
      <Composer
        api={api()}
        workspaceId="w"
        providers={providers}
        providerId="p1"
        model="M2.7"
        onModelChange={vi.fn()}
        contextFiles={[]}
        onAddContextFile={vi.fn()}
        onRemoveContextFile={vi.fn()}
        sending={true}
        onSubmit={vi.fn()}
        placeholder=""
      />
    );
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: 测试失败**

Run: `pnpm --filter @marginalia/desktop test -- Composer.test`

Expected: FAIL。

- [ ] **Step 3: 实现**

Create `apps/desktop/src/chat/Composer/Composer.tsx`:

```tsx
import { useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, Plus, X } from "lucide-react";
import type { ApiClient, Provider } from "@/api/client.js";
import { Button } from "@/components/ui/button.js";
import { cn } from "@/lib/cn.js";
import { MentionMenu } from "./MentionMenu.js";
import { ModelPicker } from "./ModelPicker.js";
import { SlashMenu } from "./SlashMenu.js";

interface Props {
  api: ApiClient;
  workspaceId: string | null;
  providers: readonly Provider[];
  providerId: string;
  model: string;
  onModelChange: (next: { providerId: string; model: string }) => void;
  contextFiles: readonly string[];
  onAddContextFile: (path: string) => void;
  onRemoveContextFile: (path: string) => void;
  sending: boolean;
  onSubmit: (text: string) => void;
  placeholder: string;
  autoFocus?: boolean;
}

export function Composer(props: Props) {
  const [draft, setDraft] = useState("");
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [mentionSuggestions, setMentionSuggestions] = useState<{ path: string }[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  function autoSize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
  }

  async function handleChange(value: string) {
    setDraft(value);
    requestAnimationFrame(autoSize);
    const slashMatch = /^\/(\w*)$/.exec(value);
    setSlashQuery(slashMatch ? slashMatch[1] : null);
    if (value.endsWith("@") && props.workspaceId) {
      const items = await props.api.searchFiles(props.workspaceId, "");
      setMentionSuggestions(Array.isArray(items) ? items : []);
    } else if (!value.includes("@")) {
      setMentionSuggestions([]);
    }
  }

  function submit() {
    const text = draft.trim();
    if (!text) return;
    props.onSubmit(text);
    setDraft("");
    setSlashQuery(null);
    setMentionSuggestions([]);
    requestAnimationFrame(autoSize);
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  }

  function pickSlash(name: string) {
    setDraft("");
    setSlashQuery(null);
    if (name === "model") {
      // model picker is a separate popover; just clear for now
    }
    if (name === "clear") {
      // ChatView decides; emit as a no-op submit prefix
    }
  }

  function pickMention(path: string) {
    props.onAddContextFile(path);
    setDraft(draft.replace(/@$/, ""));
    setMentionSuggestions([]);
    requestAnimationFrame(autoSize);
    textareaRef.current?.focus();
  }

  return (
    <div className="relative w-full">
      {slashQuery !== null && (
        <SlashMenu
          query={slashQuery}
          onSelect={pickSlash}
          onClose={() => setSlashQuery(null)}
        />
      )}
      {mentionSuggestions.length > 0 && (
        <MentionMenu
          suggestions={mentionSuggestions}
          onSelect={pickMention}
          onClose={() => setMentionSuggestions([])}
        />
      )}
      <div className="rounded-2xl border border-border bg-background px-3 pt-3 pb-2 shadow-sm">
        <textarea
          ref={props.autoFocus ? (el) => el?.focus() : textareaRef}
          aria-label="Message"
          value={draft}
          onChange={(e) => void handleChange(e.target.value)}
          onKeyDown={onKey}
          placeholder={props.placeholder}
          rows={1}
          className={cn(
            "w-full resize-none border-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground",
            "min-h-[40px] max-h-[260px]"
          )}
        />
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {props.contextFiles.map((p) => (
            <span
              key={p}
              className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs"
            >
              <span className="max-w-[200px] truncate">{p}</span>
              <button
                type="button"
                aria-label={`Remove ${p}`}
                onClick={() => props.onRemoveContextFile(p)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Add attachment">
              <Plus className="h-4 w-4" />
            </Button>
            <ModelPicker
              providers={props.providers}
              providerId={props.providerId}
              model={props.model}
              onChange={props.onModelChange}
            />
          </div>
          <Button
            size="icon"
            className="h-7 w-7 rounded-full"
            disabled={props.sending || !draft.trim()}
            onClick={submit}
            aria-label="Send"
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 测试通过**

Run: `pnpm --filter @marginalia/desktop test -- Composer.test`

Expected: PASS（4 个用例）。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/chat/Composer/Composer.tsx apps/desktop/src/chat/Composer/Composer.test.tsx
git commit -m "feat(desktop): add Composer with model picker, slash, mentions, chips"
```

---

## Task 12: NewThreadView

**Files:**
- Create: `apps/desktop/src/chat/NewThreadView.tsx`
- Create: `apps/desktop/src/chat/NewThreadView.test.tsx`

- [ ] **Step 1: 测试**

Create `apps/desktop/src/chat/NewThreadView.test.tsx`:

```tsx
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/api/client.js";
import { useAppStore } from "@/store/app-store.js";
import { NewThreadView } from "./NewThreadView.js";

function fakeApi(): ApiClient {
  return {
    listProviders: vi.fn(async () => [{ id: "p1", name: "Minimax", defaultModel: "M2.7" }]),
    listWorkspaces: vi.fn(async () => [{ id: "w1", name: "alpha", rootDir: "/a" }]),
    createSession: vi.fn(async (input) => ({
      id: "newSession",
      workspaceId: input.workspaceId,
      title: input.title,
      origin: "ui",
      model: null
    })),
    searchFiles: vi.fn(async () => []),
    getBranch: vi.fn(async () => null)
  } as unknown as ApiClient;
}

describe("NewThreadView", () => {
  beforeEach(() => {
    cleanup();
    useAppStore.setState({
      view: "new-thread",
      activeWorkspaceId: "w1",
      activeSessionId: null,
      pendingPrompt: null,
      contextFiles: [],
      leftSidebarCollapsed: false,
      rightPanelCollapsed: false
    });
  });

  it("renders hero title", async () => {
    render(<NewThreadView api={fakeApi()} />);
    await screen.findByText(/what should we build/i);
  });

  it("submitting creates session, sets pendingPrompt, switches view to chat", async () => {
    const api = fakeApi();
    render(<NewThreadView api={api} />);
    await waitFor(() => expect(api.listProviders).toHaveBeenCalled());
    await userEvent.type(screen.getByRole("textbox", { name: /message/i }), "hello world");
    await userEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(api.createSession).toHaveBeenCalledWith({ workspaceId: "w1", title: "hello world" }));
    expect(useAppStore.getState().activeSessionId).toBe("newSession");
    expect(useAppStore.getState().pendingPrompt).toBe("hello world");
    expect(useAppStore.getState().view).toBe("chat");
  });

  it("send disabled with no workspace", async () => {
    useAppStore.setState({ activeWorkspaceId: null });
    render(<NewThreadView api={fakeApi()} />);
    await userEvent.type(screen.getByRole("textbox", { name: /message/i }), "hi");
    expect(screen.getByRole("button", { name: /send/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: 测试失败**

Run: `pnpm --filter @marginalia/desktop test -- NewThreadView`

Expected: FAIL。

- [ ] **Step 3: 实现**

Create `apps/desktop/src/chat/NewThreadView.tsx`:

```tsx
import { useState } from "react";
import { toast } from "sonner";
import type { ApiClient } from "@/api/client.js";
import { useWorkspaces } from "@/hooks/useWorkspaces.js";
import { useProviders } from "@/hooks/useProviders.js";
import { useAppStore } from "@/store/app-store.js";
import { BranchChip } from "./Composer/BranchChip.js";
import { Composer } from "./Composer/Composer.js";
import { WorkspaceChip } from "./Composer/WorkspaceChip.js";

function basename(p: string): string {
  const trimmed = p.replace(/\/+$/, "");
  return trimmed.split("/").pop() || trimmed || "workspace";
}

export function NewThreadView({ api }: { api: ApiClient }) {
  const workspaces = useWorkspaces(api);
  const providers = useProviders(api);
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
  const setActiveWorkspace = useAppStore((s) => s.setActiveWorkspace);
  const setActiveSession = useAppStore((s) => s.setActiveSession);
  const setPendingPrompt = useAppStore((s) => s.setPendingPrompt);
  const setView = useAppStore((s) => s.setView);
  const contextFiles = useAppStore((s) => s.contextFiles);
  const addContext = useAppStore((s) => s.addContextFile);
  const removeContext = useAppStore((s) => s.removeContextFile);

  const firstProvider = providers.data[0];
  const [providerId, setProviderId] = useState<string>("");
  const [model, setModel] = useState<string>("");
  const actualProviderId = providerId || firstProvider?.id || "";
  const actualModel = model || firstProvider?.defaultModel || "";

  async function pickNewWorkspace() {
    const picked = await window.marginalia?.pickWorkspaceDirectory?.();
    if (!picked) return;
    try {
      const created = await workspaces.create({ name: basename(picked), rootDir: picked });
      setActiveWorkspace(created.id);
      toast.success(`Workspace "${created.name}" created`);
    } catch (err) {
      toast.error(`Failed: ${(err as Error).message}`);
    }
  }

  async function submit(text: string) {
    if (!activeWorkspaceId) return;
    try {
      const session = await api.createSession({ workspaceId: activeWorkspaceId, title: text.slice(0, 32) });
      setActiveSession(session.id);
      setPendingPrompt(text);
      setView("chat");
    } catch (err) {
      toast.error(`Failed: ${(err as Error).message}`);
    }
  }

  const canSend = Boolean(activeWorkspaceId);

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col justify-center px-4 py-12">
        <h1 className="mb-6 text-center text-2xl font-medium text-foreground">
          What should we build?
        </h1>
        <Composer
          api={api}
          workspaceId={activeWorkspaceId}
          providers={providers.data}
          providerId={actualProviderId}
          model={actualModel}
          onModelChange={({ providerId: p, model: m }) => {
            setProviderId(p);
            setModel(m);
          }}
          contextFiles={contextFiles}
          onAddContextFile={addContext}
          onRemoveContextFile={removeContext}
          sending={!canSend}
          onSubmit={submit}
          placeholder="Do anything…"
          autoFocus
        />
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <WorkspaceChip
            workspaces={workspaces.data}
            activeId={activeWorkspaceId}
            onSelect={setActiveWorkspace}
            onNew={pickNewWorkspace}
          />
          {activeWorkspaceId && <BranchChip api={api} workspaceId={activeWorkspaceId} />}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 测试通过**

Run: `pnpm --filter @marginalia/desktop test -- NewThreadView`

Expected: PASS（3 个用例）。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/chat/NewThreadView.tsx apps/desktop/src/chat/NewThreadView.test.tsx
git commit -m "feat(desktop): add NewThreadView hero with workspace + branch chips"
```

---

## Task 13: ChatView

**Files:**
- Create: `apps/desktop/src/chat/ChatView.tsx`
- Create: `apps/desktop/src/chat/ChatView.test.tsx`

- [ ] **Step 1: 测试**

Create `apps/desktop/src/chat/ChatView.test.tsx`:

```tsx
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient, RunEvent } from "@/api/client.js";
import { useAppStore } from "@/store/app-store.js";
import { ChatView } from "./ChatView.js";

async function* events(items: RunEvent[]) {
  for (const e of items) yield e;
}

function makeApi(): ApiClient {
  return {
    listProviders: vi.fn(async () => [{ id: "p1", name: "Minimax", defaultModel: "M2.7" }]),
    listMessages: vi.fn(async () => []),
    createMessage: vi.fn(async (_sid, input) => ({ id: "u", role: input.role, content: input.content })),
    runChat: vi.fn(async () => events([{ type: "assistant_delta", payload: { text: "hi" } }])),
    searchFiles: vi.fn(async () => [])
  } as unknown as ApiClient;
}

describe("ChatView", () => {
  beforeEach(() => {
    cleanup();
    useAppStore.setState({
      view: "chat",
      activeWorkspaceId: "w1",
      activeSessionId: "s1",
      pendingPrompt: null,
      contextFiles: [],
      leftSidebarCollapsed: false,
      rightPanelCollapsed: false
    });
  });

  it("consumes pendingPrompt on mount", async () => {
    useAppStore.setState({ pendingPrompt: "hello first" });
    const api = makeApi();
    render(<ChatView api={api} sessionId="s1" />);
    await waitFor(() => expect(api.runChat).toHaveBeenCalled());
    expect(useAppStore.getState().pendingPrompt).toBeNull();
  });

  it("does not auto-send when pendingPrompt is null", async () => {
    const api = makeApi();
    render(<ChatView api={api} sessionId="s1" />);
    await waitFor(() => expect(api.listMessages).toHaveBeenCalled());
    expect(api.runChat).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 测试失败**

Run: `pnpm --filter @marginalia/desktop test -- ChatView`

Expected: FAIL。

- [ ] **Step 3: 实现**

Create `apps/desktop/src/chat/ChatView.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { ApiClient } from "@/api/client.js";
import { useMessages } from "@/hooks/useMessages.js";
import { useProviders } from "@/hooks/useProviders.js";
import { useStreamingChat } from "@/hooks/useStreamingChat.js";
import { useAppStore } from "@/store/app-store.js";
import { Composer } from "./Composer/Composer.js";
import { MessageStream } from "./MessageStream.js";

export function ChatView({ api, sessionId }: { api: ApiClient; sessionId: string }) {
  const messages = useMessages(api, sessionId);
  const providers = useProviders(api);
  const pendingPrompt = useAppStore((s) => s.pendingPrompt);
  const setPendingPrompt = useAppStore((s) => s.setPendingPrompt);
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
  const contextFiles = useAppStore((s) => s.contextFiles);
  const addContext = useAppStore((s) => s.addContextFile);
  const removeContext = useAppStore((s) => s.removeContextFile);

  const firstProvider = providers.data[0];
  const [providerId, setProviderId] = useState<string>("");
  const [model, setModel] = useState<string>("");
  const actualProviderId = providerId || firstProvider?.id || "";
  const actualModel = model || firstProvider?.defaultModel || "";
  const [error, setError] = useState<string | null>(null);
  const [lastSent, setLastSent] = useState<string | null>(null);

  const stream = useStreamingChat({
    api,
    sessionId,
    providerId: actualProviderId,
    model: actualModel,
    onUserAppend: messages.append,
    onAssistantStart: messages.append,
    onAssistantDelta: messages.appendToLast,
    onComplete: () => setError(null),
    onError: setError
  });

  function submit(text: string) {
    if (!actualProviderId) {
      setError("No provider configured");
      return;
    }
    setError(null);
    setLastSent(text);
    void stream.send(text, [...contextFiles]);
  }

  // 消费 pendingPrompt 一次
  useEffect(() => {
    if (pendingPrompt && actualProviderId) {
      const text = pendingPrompt;
      setPendingPrompt(null);
      setLastSent(text);
      void stream.send(text, [...contextFiles]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPrompt, actualProviderId]);

  function retry() {
    if (lastSent) {
      setError(null);
      void stream.send(lastSent, [...contextFiles]);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-auto">
        <MessageStream messages={messages.data} error={error} onRetry={retry} />
      </div>
      <div className="border-t border-border bg-background px-4 py-3">
        <div className="mx-auto max-w-3xl">
          <Composer
            api={api}
            workspaceId={activeWorkspaceId}
            providers={providers.data}
            providerId={actualProviderId}
            model={actualModel}
            onModelChange={({ providerId: p, model: m }) => {
              setProviderId(p);
              setModel(m);
            }}
            contextFiles={contextFiles}
            onAddContextFile={addContext}
            onRemoveContextFile={removeContext}
            sending={stream.sending}
            onSubmit={submit}
            placeholder="Type / for commands, @ for files…"
          />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 测试通过**

Run: `pnpm --filter @marginalia/desktop test -- ChatView`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/chat/ChatView.tsx apps/desktop/src/chat/ChatView.test.tsx
git commit -m "feat(desktop): add ChatView with pendingPrompt consumption + retry"
```

---

## Task 14: AppShell 路由到 NewThreadView / ChatView

**Files:**
- Modify: `apps/desktop/src/app/AppShell.tsx`
- Modify: `apps/desktop/src/app/AppShell.test.tsx`
- Modify: `apps/desktop/src/app/placeholders.tsx`（只保留 `DocumentPanelPlaceholder`）
- Modify: `apps/desktop/src/app/Topbar.tsx`（接 title 来源）

- [ ] **Step 1: 更新 placeholders 只留 Document 那个**

Replace `apps/desktop/src/app/placeholders.tsx`:

```tsx
export function DocumentPanelPlaceholder() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      Document panel coming in PR 4
    </div>
  );
}
```

- [ ] **Step 2: 更新 AppShell 路由**

Replace `apps/desktop/src/app/AppShell.tsx` 中的 `<main>` 内容：

```tsx
import { useApi } from "@/hooks/useApi.js";
import { useAppStore } from "@/store/app-store.js";
import { cn } from "@/lib/cn.js";
import { ChatView } from "@/chat/ChatView.js";
import { NewThreadView } from "@/chat/NewThreadView.js";
import { Sidebar } from "@/sidebar/Sidebar.js";
import { Topbar } from "./Topbar.js";
import { DocumentPanelPlaceholder } from "./placeholders.js";

export function AppShell({ serverUrl }: { serverUrl: string }) {
  const api = useApi(serverUrl);
  const view = useAppStore((s) => s.view);
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const leftCollapsed = useAppStore((s) => s.leftSidebarCollapsed);
  const rightCollapsed = useAppStore((s) => s.rightPanelCollapsed);
  const showRight = view === "chat" && !rightCollapsed;

  // settings view 留待 PR 5；此处暂时按 new-thread 处理
  const effectiveView = view === "settings" ? "new-thread" : view;

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
          {effectiveView === "chat" && activeSessionId ? (
            <ChatView api={api} sessionId={activeSessionId} />
          ) : (
            <NewThreadView api={api} />
          )}
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

- [ ] **Step 3: 更新 AppShell.test.tsx 让 chat view 用例传 sessionId**

Edit `apps/desktop/src/app/AppShell.test.tsx`，把 "shows right panel when view is chat" 用例改为：

```tsx
it("shows right panel and chat when view is chat with active session", () => {
  useAppStore.setState({ view: "chat", activeSessionId: "s1", activeWorkspaceId: "w1" });
  render(<AppShell serverUrl="http://x" />);
  expect(screen.getByRole("complementary", { name: /document panel/i })).toBeInTheDocument();
});
```

把其他 `<AppShell>` 用例中的 `view: "chat"` 时也加 `activeSessionId: "s1"` 保证渲染 ChatView。如果某些用例没有 ChatView 的依赖 mock，则增加：

```ts
global.fetch = vi.fn(async () => new Response("[]", { headers: { "content-type": "application/json" } }));
```

放到 beforeEach 顶部。

- [ ] **Step 4: 跑 AppShell 测试**

Run: `pnpm --filter @marginalia/desktop test -- AppShell`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/app/AppShell.tsx apps/desktop/src/app/AppShell.test.tsx apps/desktop/src/app/placeholders.tsx
git commit -m "feat(desktop): wire AppShell to render NewThreadView/ChatView based on view"
```

---

## Task 15: Topbar 标题来源

**Files:**
- Modify: `apps/desktop/src/app/AppShell.tsx`
- Modify: `apps/desktop/src/app/Topbar.tsx`

- [ ] **Step 1: AppShell 计算 title 并传给 Topbar**

修改 `AppShell.tsx`，在 `useApi` 之后加：

```tsx
import { useEffect, useState } from "react";
import type { Session, Workspace } from "@/api/client.js";

// ... in AppShell：
const [activeSession, setActiveSession] = useState<Session | null>(null);
const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);

useEffect(() => {
  if (!activeSessionId) {
    setActiveSession(null);
    return;
  }
  // pi-server 暂无单 session 接口；从 workspace sessions 找
  if (!activeWorkspaceId) return;
  api.listSessions(activeWorkspaceId).then((list) => {
    setActiveSession(list.find((s) => s.id === activeSessionId) ?? null);
  });
}, [api, activeSessionId, activeWorkspaceId]);

useEffect(() => {
  if (!activeWorkspaceId) {
    setActiveWorkspace(null);
    return;
  }
  api.listWorkspaces().then((list) => {
    setActiveWorkspace(list.find((w) => w.id === activeWorkspaceId) ?? null);
  });
}, [api, activeWorkspaceId]);

const title =
  view === "chat" && activeSession
    ? activeSession.title || "(untitled)"
    : activeWorkspace
      ? activeWorkspace.name
      : "";

// 把 <Topbar title="" /> 改成：
<Topbar title={title} />
```

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @marginalia/desktop typecheck`

Expected: 通过。

- [ ] **Step 3: 跑全套测试**

Run: `pnpm --filter @marginalia/desktop test`

Expected: 全绿。如果 AppShell 测试因为额外的 fetch 调用失败，给 beforeEach 的 fetch mock 加上 `/sessions` 和 `/workspaces` 返回 `[]`。

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/app/AppShell.tsx
git commit -m "feat(desktop): show active session/workspace title in topbar"
```

---

## Task 16: dev 烟测

- [ ] **Step 1: 启动 dev**

Run: `pnpm --filter @marginalia/desktop dev`

操作清单（按顺序）：
1. 窗口出现，Topbar 显示，Sidebar 显示
2. 中间区域应是 NewThreadView（"What should we build?" 标题 + 输入框 + workspace chip）
3. 输入 "hi 模型" 后点 Send（或 ⌘+Enter）— 应:
   - 创建新 session
   - view 切到 chat
   - MessageStream 出现，用户消息已显示，assistant 开始流式
4. 等流结束 — 完整的 assistant 回复 markdown 渲染正常（如果回复里有代码块，应该有语法高亮）
5. 在 composer 输入 `@`，应弹出文件联想；选一个，应作为芯片出现
6. 在 composer 输入 `/cle`，应弹 SlashMenu 显示 `/clear`
7. 点 Topbar 右侧 PanelRight 按钮 — 右栏切换显示/隐藏（仍然是 "Document panel coming in PR 4" 占位）
8. 点 Sidebar 任意已存在的 session — 应跳转到 chat 视图加载该 session 的历史
9. 点 Sidebar "New chat" — 回到 NewThreadView
10. 制造一次错误：临时把 `pi-server` 杀了再发消息 — MessageStream 应显示红色错误行 + Retry 按钮

Expected: 所有交互正常；视觉风格 Codex-like；无控制台严重错误。

Ctrl+C 退出。

---

## Definition of Done

- [ ] 16 个任务完成、每步 commit
- [ ] `pnpm test` 全绿（约 30+ 用例新增）
- [ ] `pnpm typecheck` 通过
- [ ] dev 模式 NewThread → 提交 → Chat 流式响应完整工作
- [ ] @ mention 和 / slash 菜单可用
- [ ] 模型选择器可切换 provider/model
- [ ] 错误时 Retry 按钮工作

下一 PR：`docs/superpowers/plans/2026-05-26-codex-ui-04-document-panel.md`
