---
type: plan
record_id: PLAN-P1-MESSAGE-STREAM-001
status: archived
source_spec_id: SPEC-P1-CHAT-CORE-001
created: 2026-07-10
updated: 2026-07-11
target_milestone: M0-trustworthy-local-alpha
owner: repository-maintainers
docs_impact:
  user:
    - docs/user/guide.md
  developer:
    - docs/developer/api.md
    - docs/developer/architecture.md
    - docs/developer/development.md
  product_status: true
archived_at: 2026-07-11
outcome: cancelled
implementation_refs:
  - 7d34b8b
  - 1eef5ec
  - 23a98a0
  - 8691f72
  - 16783ad
  - 90d982c
  - ffadd29
  - 0cca020
  - 2f23bf3
  - de018bc
  - 85a6d8b
  - adacac2
  - 1199645
---

# P1-B 消息流渲染 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 spec（`docs/superpowers/specs/2026-07-08-p1-chat-core-experience-design.md`）第 2 节：工具卡可展开与实时输出、thinking 折叠化、长文阅读排版与锚点目录、消息级导出（复制/导出 .md/存入 workspace）、Markdown 代码块打磨、滚动跟随重做、回合级文件变更摘要。

**Architecture:** 全部在既有事件模型上做增量：`useStreamingChat` 新增 tool 进度回调（消费此前被丢弃的 `tool_execution_update.partialResult`）；ToolCard 从单行改为可展开卡片；thinking 从顶部 transient 区搬进所属助手消息并折叠；导出走 Electron IPC（save dialog）与新的 pi-server 写文件端点；回合摘要复用审批链路——extension 对直通的 edit/write 也生成 diff，以 `file_changed` envelope 下发并以 `auto` 状态持久化进 approvals 表，重开可还原。`agent_event` 纯透传红线不变。

**Tech Stack:** React 18 + Tailwind（既有 mono/serif/emerald 令牌）、highlight.js（既有）、Hono、better-sqlite3、Electron ipcMain/contextBridge、Vitest + Testing Library。

## Global Constraints

- ESM 导入必须带 `.js` 扩展名；desktop 跨目录导入用 `@/` 别名。
- 所有用户可见文案走 `t()`，键同时加进 `src/i18n/messages.ts` 的 `en` 和 `zh`（zh 有 `satisfies` 检查）。
- **`agent_event` 保持纯 pi 透传**；新增 SSE envelope 只能作为 run 级信封新类型（本计划新增 `file_changed`）。
- chat-core 只放薄类型桥与小渲染辅助，不引入 UI 依赖。
- 每任务 TDD；提交前跑触达包 typecheck + test、仓库级 `pnpm lint`、`pnpm format:check`。
- Conventional commits 带包 scope。工作分支：从 `feat/approval-backbone` 切 `feat/message-stream`（P1-A 尚未合并；若已合并则从主干切）。
- UI 改动最终需 Electron 截图 + `pnpm verify:visual`（Task 15 统一覆盖，新状态必须有 fixture）。
- live 流式与重开会话渲染必须一致；重开无法还原的瞬态（thinking 秒数、实时输出）按任务内标注的降级形态渲染。

**设计取舍（相对 spec 的两处明确偏离，已在任务内落实）**：

1. 代码高亮**保留 highlight.js**（spec"倾向 shiki"）：`lib/highlight.js` 已集成且样式可控，换 shiki 是重依赖迁移收益低；本计划补齐的是复制按钮、语言标签与块级 chrome。
2. 回合摘要的数据来源（spec 说"复用第 1 节合成的 diff"）：ask 档已有 approvals；**直通路径（full 档、新建文件）新增 `file_changed` envelope + `auto` 状态持久化**，否则 full 档与新建文件在摘要和重开还原里会是盲区。
3. 摘要的展示粒度：spec 字面是"每回合末尾一条"；本计划实现为**消息流末尾一条会话级聚合**（Task 14）。理由：重开会话时无法可靠切分历史回合边界，聚合条是 live 与重开唯一能保持一致的形态；代价是多回合会话看不到每回合独立统计（后续若要按回合，需要给 approvals 行补 run 边界渲染，留待 P2 再议）。

**执行顺序**：1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15（线性依赖，无倒置）。

---

### Task 1: chat-core 分工具摘要辅助

**Files:**

- Modify: `packages/chat-core/src/tool-format.ts`
- Test: `packages/chat-core/src/tool-format.test.ts`（追加）

**Interfaces:**

- Produces:
  - `type ToolSummary = { title: string; detail?: string }`
  - `toolSummary(call: ChatToolCall): ToolSummary` — 按工具名定制：`read`/`edit`/`write` → detail=path；`bash` → detail=command；`grep`/`find` → detail=pattern/query；其余回退 `toolSubtitle`。
  - `fullResultText(result: ChatToolResult | ChatToolExecutionResult | string | undefined): string | undefined` — 与 `resultText` 同源但**不截断**（展开面板用）。

- [ ] **Step 1: 写失败测试**（追加到既有 describe 之后）

```ts
import { fullResultText, toolSummary } from "./tool-format.js";

describe("toolSummary", () => {
  it("summarises per tool name", () => {
    expect(
      toolSummary({
        type: "toolCall",
        id: "1",
        name: "bash",
        arguments: { command: "python x.py" }
      })
    ).toEqual({ title: "bash", detail: "python x.py" });
    expect(
      toolSummary({ type: "toolCall", id: "2", name: "read", arguments: { path: "a.md" } })
    ).toEqual({ title: "read", detail: "a.md" });
    expect(
      toolSummary({ type: "toolCall", id: "3", name: "grep", arguments: { pattern: "foo" } })
    ).toEqual({ title: "grep", detail: "foo" });
  });

  it("falls back to toolSubtitle for unknown tools", () => {
    expect(
      toolSummary({ type: "toolCall", id: "4", name: "mystery", arguments: { query: "q" } })
    ).toEqual({ title: "mystery", detail: "q" });
    expect(toolSummary({ type: "toolCall", id: "5", name: "mystery", arguments: {} })).toEqual({
      title: "mystery",
      detail: undefined
    });
  });
});

describe("fullResultText", () => {
  it("does not truncate long outputs", () => {
    const long = "x".repeat(1000);
    expect(fullResultText(long)).toHaveLength(1000);
    expect(
      fullResultText({
        role: "toolResult",
        toolCallId: "t",
        toolName: "bash",
        content: [{ type: "text", text: long }],
        isError: false,
        timestamp: 1
      })
    ).toHaveLength(1000);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @marginalia/chat-core test`
Expected: FAIL（导出不存在）

- [ ] **Step 3: 实现**（tool-format.ts 追加）

```ts
export type ToolSummary = { title: string; detail?: string };

const DETAIL_KEY_BY_TOOL: Record<string, string> = {
  read: "path",
  edit: "path",
  write: "path",
  bash: "command",
  grep: "pattern",
  find: "query"
};

/** Per-tool one-line summary for collapsed tool cards. */
export function toolSummary(call: ChatToolCall): ToolSummary {
  const key = DETAIL_KEY_BY_TOOL[call.name];
  const candidate = key ? call.arguments[key] : undefined;
  const detail = typeof candidate === "string" ? candidate : toolSubtitle(call.arguments);
  return { title: call.name, detail };
}

/** Like resultText but untruncated, for expanded tool panels. */
export function fullResultText(result: ToolResultTextSource): string | undefined {
  if (result === undefined) return undefined;
  if (typeof result === "string") return result;
  const text = stringifyContent(result.content);
  return text || undefined;
}
```

同时在 `packages/chat-core/src/index.ts` 的导出列表加上 `toolSummary`、`fullResultText`、`ToolSummary`。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @marginalia/chat-core test && pnpm --filter @marginalia/chat-core typecheck`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
pnpm lint && pnpm format:check
git add packages/chat-core/src/tool-format.ts packages/chat-core/src/tool-format.test.ts packages/chat-core/src/index.ts
git commit -m "feat(chat-core): per-tool summary and untruncated result helpers"
```

---

### Task 2: useStreamingChat 消费工具进度（partialResult）

**Files:**

- Modify: `apps/desktop/src/hooks/useStreamingChat.ts`
- Test: `apps/desktop/src/hooks/useStreamingChat.progress.test.ts`

**Interfaces:**

- Consumes: pi `tool_execution_update` 事件——`partialResult` 是**累计**输出（整体替换式），形如 `{ content: [{ type:"text", text }] }` 或字符串。
- Produces: `Options.onToolProgress?: (toolCallId: string, output: string) => void` — 每次 update 携带累计文本；`tool_execution_end` 后由消费方自行清理（hook 不发终止信号，end 事件已有 onToolResultUpsert）。

- [ ] **Step 1: 写失败测试**

```ts
// apps/desktop/src/hooks/useStreamingChat.progress.test.ts
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useStreamingChat } from "./useStreamingChat.js";
import type { ApiClient } from "@/api/client.js";

function apiWithEvents(events: Array<Record<string, unknown>>): ApiClient {
  return {
    runChat: vi.fn(async () =>
      (async function* () {
        for (const e of events) yield e;
      })()
    )
  } as unknown as ApiClient;
}

const noop = () => {};
const baseOpts = {
  sessionId: "s1",
  providerId: "p",
  model: "m",
  onUserAppend: noop,
  onAssistantStart: noop,
  onAssistantReplace: noop,
  onAssistantDelta: noop,
  onComplete: noop
};

describe("useStreamingChat tool progress", () => {
  it("forwards accumulated partialResult text per update", async () => {
    const onToolProgress = vi.fn();
    const api = apiWithEvents([
      { type: "run_started", payload: {} },
      {
        type: "agent_event",
        payload: {
          event: {
            type: "tool_execution_start",
            toolCallId: "t1",
            toolName: "bash",
            args: { command: "x" }
          }
        }
      },
      {
        type: "agent_event",
        payload: {
          event: {
            type: "tool_execution_update",
            toolCallId: "t1",
            toolName: "bash",
            args: { command: "x" },
            partialResult: { content: [{ type: "text", text: "line1\n" }] }
          }
        }
      },
      {
        type: "agent_event",
        payload: {
          event: {
            type: "tool_execution_update",
            toolCallId: "t1",
            toolName: "bash",
            args: { command: "x" },
            partialResult: { content: [{ type: "text", text: "line1\nline2\n" }] }
          }
        }
      },
      { type: "run_completed", payload: {} }
    ]);
    const { result } = renderHook(() => useStreamingChat({ ...baseOpts, api, onToolProgress }));
    await act(() => result.current.send("hi", []));
    expect(onToolProgress).toHaveBeenNthCalledWith(1, "t1", "line1\n");
    expect(onToolProgress).toHaveBeenNthCalledWith(2, "t1", "line1\nline2\n");
  });

  it("ignores updates without textual partialResult", async () => {
    const onToolProgress = vi.fn();
    const api = apiWithEvents([
      { type: "run_started", payload: {} },
      {
        type: "agent_event",
        payload: {
          event: { type: "tool_execution_update", toolCallId: "t1", toolName: "bash", args: {} }
        }
      },
      { type: "run_completed", payload: {} }
    ]);
    const { result } = renderHook(() => useStreamingChat({ ...baseOpts, api, onToolProgress }));
    await act(() => result.current.send("hi", []));
    expect(onToolProgress).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @marginalia/desktop test -- useStreamingChat.progress`
Expected: FAIL

- [ ] **Step 3: 实现**

1. `Options` 追加 `onToolProgress?: (toolCallId: string, output: string) => void;`
2. `handlePiEvent` 里把现在合并处理的分支拆开（现状 `case "tool_execution_start": case "tool_execution_update":` 共用一支）：

```ts
case "tool_execution_start": {
  const tool = toolCallFromEvent(pi);
  if (tool) {
    ensureAssistant();
    opts.onToolCallUpsert?.(tool);
  }
  break;
}
case "tool_execution_update": {
  const tool = toolCallFromEvent(pi);
  if (tool) {
    ensureAssistant();
    opts.onToolCallUpsert?.(tool);
  }
  if (pi.toolCallId) {
    const output = resultText(pi.partialResult as never) !== undefined
      ? fullProgressText(pi.partialResult)
      : undefined;
    if (output) opts.onToolProgress?.(pi.toolCallId, output);
  }
  break;
}
```

其中 `fullProgressText` 为文件内小函数（不截断，形状与 `fullResultText` 一致；直接 `import { fullResultText } from "@marginalia/chat-core"` 并复用即可，无需自写——上面伪代码实现时替换为 `const output = fullResultText(pi.partialResult as never);`）。`PiEvent` 类型的 `partialResult` 字段已存在。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @marginalia/desktop test -- useStreamingChat`
Expected: PASS（含既有 15 个用例零回归）

- [ ] **Step 5: 提交**

```bash
pnpm --filter @marginalia/desktop typecheck && pnpm lint && pnpm format:check
git add apps/desktop/src/hooks/useStreamingChat.ts apps/desktop/src/hooks/useStreamingChat.progress.test.ts
git commit -m "feat(desktop): surface tool execution progress from streaming events"
```

---

### Task 3: ToolCard 重做——可展开 + 分工具摘要

**Files:**

- Modify: `apps/desktop/src/chat/ToolCard.tsx`
- Test: `apps/desktop/src/chat/ToolCard.test.tsx`（改造既有 3 用例 + 新增）
- Modify: `apps/desktop/src/i18n/messages.ts`（`tool.*` 键，en+zh）

**Interfaces:**

- Consumes: `toolSummary`/`fullResultText`（Task 1）、既有 props（`call/result/approval/onDecideApproval`，Plan A）。
- Produces: props 不变，新增内部展开态；`ToolCard` 结构变为：
  - 折叠行：状态点（既有优先级不变）+ 分工具图标 + `toolSummary().title` + mono detail + 简短结果尾巴 + Chevron（展开时旋转 90°，`aria-expanded`）。图标映射（lucide）：`read`→`FileText`、`edit`/`write`→`FilePen`、`bash`→`Terminal`、`grep`/`find`→`Search`、默认→`Wrench`。
  - **edit/write 的 diff 统计**（spec：文件名 + `+12 -3`）：`approval?.payload.kind === "file_edit"` 时（含 pending/approved/auto 任意状态），折叠行 detail 右侧追加 `<span className="ml-1"><span className="text-brand">+{additions}</span> <span className="text-danger">-{deletions}</span></span>`；无 approval 数据（如 readonly 档不可能出现 edit）则不显示。测试补一条：带 file_edit approval 的 edit 卡折叠行可见 `+1`/`-1`。
  - 点击整行切换展开（`role="button"`；审批卡/徽标区域不受影响，始终显示）。
  - 展开面板：参数（`JSON.stringify(call.arguments, null, 2)` mono 块）；完整输出（`fullResultText(result)`，`max-h-64 overflow-auto` mono，右上角复制按钮 `t("common.copy")`）；`edit`/`write` 且有 `approval.payload.kind === "file_edit"` 时渲染 `<DiffView patch={approval.payload.patch} />` 替代参数块。

- [ ] **Step 1: 写失败测试**（重写测试文件；保留既有 3 个断言意图）

```tsx
// apps/desktop/src/chat/ToolCard.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ChatToolResult } from "@marginalia/chat-core";
import { ToolCard } from "./ToolCard.js";

const call = {
  type: "toolCall" as const,
  id: "t1",
  name: "bash",
  arguments: { command: "python analyze.py" }
};

function result(text: string, isError = false): ChatToolResult {
  return {
    role: "toolResult",
    toolCallId: "t1",
    toolName: "bash",
    content: [{ type: "text", text }],
    isError,
    timestamp: 1
  };
}

describe("ToolCard", () => {
  it("shows the per-tool summary collapsed", () => {
    render(<ToolCard call={call} />);
    expect(screen.getByText("bash")).toBeInTheDocument();
    expect(screen.getByText("python analyze.py")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /bash/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("expands to full arguments and untruncated output with a copy button", async () => {
    const long = "output ".repeat(100).trim();
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => {}) } });
    render(<ToolCard call={call} result={result(long)} />);
    await userEvent.click(screen.getByRole("button", { name: /bash/ }));
    expect(screen.getByRole("button", { name: /bash/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/"command": "python analyze\.py"/)).toBeInTheDocument();
    expect(screen.getByText(long)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /copy|复制/i }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(long);
    vi.unstubAllGlobals();
  });

  it("keeps running state (no result) with a pulse dot and no output panel", async () => {
    render(<ToolCard call={call} />);
    await userEvent.click(screen.getByRole("button", { name: /bash/ }));
    expect(screen.queryByRole("button", { name: /copy|复制/i })).not.toBeInTheDocument();
  });

  it("shows denied badge together with an error result", () => {
    render(
      <ToolCard
        call={call}
        result={result("blocked", true)}
        approval={{
          id: "ap-1",
          toolCallId: "t1",
          toolName: "bash",
          kind: "command",
          status: "denied",
          reason: "不安全",
          payload: { kind: "command", command: "python analyze.py", cwd: "/ws" }
        }}
      />
    );
    expect(screen.getByText(/denied|已拒绝/i)).toBeInTheDocument();
    expect(screen.getByText(/不安全/)).toBeInTheDocument();
  });
});
```

（既有 `ToolCard.approval.test.tsx` 的 3 个用例保持原样必须继续通过。）

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @marginalia/desktop test -- ToolCard`
Expected: FAIL（无展开行为）

- [ ] **Step 3: 实现**

要点（保持 Plan A 的审批渲染分支原样）：

```tsx
const [expanded, setExpanded] = useState(false);
const summary = toolSummary(call);
const full = fullResultText(result);
const Icon = TOOL_ICONS[call.name] ?? Wrench;
const fileEditPatch =
  approval?.payload.kind === "file_edit" && approval.payload.patch ? approval.payload : null;
```

折叠行改为 `<button type="button" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)} className="flex w-full items-center gap-2.5 …">`（沿用现有行内元素与 dot 逻辑；Chevron 加 `cn("h-3 w-3 text-text-faint transition-transform", expanded && "rotate-90")`）。展开面板：

```tsx
{
  expanded && (
    <div className="flex flex-col gap-2 rounded-lg border border-soft bg-surface px-3 py-2">
      {fileEditPatch ? (
        <DiffView patch={fileEditPatch.patch} />
      ) : (
        <pre className="mono max-h-40 overflow-auto whitespace-pre-wrap break-all text-[11.5px] text-text-muted">
          {JSON.stringify(call.arguments, null, 2)}
        </pre>
      )}
      {full && (
        <div className="relative">
          <button
            type="button"
            onClick={() => void navigator.clipboard.writeText(full)}
            className="absolute right-1 top-1 rounded border border-soft bg-surface px-1.5 py-0.5 text-[11px] text-text-muted hover:bg-surface-3"
          >
            {t("common.copy")}
          </button>
          <pre className="mono max-h-64 overflow-auto whitespace-pre-wrap break-all text-[12px]">
            {full}
          </pre>
        </div>
      )}
    </div>
  );
}
```

i18n：`common.copy`（en "Copy" / zh "复制"）若不存在则新增（`common.cancel` 的教训：**先读 messages.ts 确认**）。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @marginalia/desktop test -- ToolCard`
Expected: PASS（新 4 + 既有 approval 3）

- [ ] **Step 5: 提交**

```bash
pnpm --filter @marginalia/desktop typecheck && pnpm lint && pnpm format:check
git add apps/desktop/src/chat/ToolCard.tsx apps/desktop/src/chat/ToolCard.test.tsx apps/desktop/src/i18n/messages.ts
git commit -m "feat(desktop): expandable tool cards with per-tool summaries"
```

---

### Task 4: bash 实时输出区（进度贯通）

**Files:**

- Modify: `apps/desktop/src/chat/ChatView.tsx`、`apps/desktop/src/chat/MessageStream.tsx`、`apps/desktop/src/chat/MessageItem.tsx`、`apps/desktop/src/chat/ToolCard.tsx`
- Test: `apps/desktop/src/chat/ToolCard.progress.test.tsx`

**Interfaces:**

- Consumes: Task 2 的 `onToolProgress`、Task 3 的展开结构。
- Produces:
  - `ToolCard` props 追加 `progress?: string` — 运行中（无 result）且有 progress 时，**折叠态也显示**输出尾部区（最后 8 行，`mono`，自动贴底）；出现 result 后该区隐藏（回到一行摘要）。
  - `MessageStream`/`MessageItem` 透传 `toolProgressByCallId?: ReadonlyMap<string, string>`（模式同 `approvalsByToolCallId`）。
  - `ChatView`：`const [toolProgress, setToolProgress] = useState<Map<string, string>>(new Map())`；`onToolProgress` upsert；`onToolResultUpsert` 时删除对应 key（结果到了，进度区退场）；发送新消息（`onUserAppend`）时清空。

- [ ] **Step 1: 写失败测试**

```tsx
// apps/desktop/src/chat/ToolCard.progress.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ChatToolResult } from "@marginalia/chat-core";
import { ToolCard } from "./ToolCard.js";

const call = { type: "toolCall" as const, id: "t1", name: "bash", arguments: { command: "x" } };

describe("ToolCard live progress", () => {
  it("shows the tail of live output while running", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    render(<ToolCard call={call} progress={lines} />);
    expect(screen.getByText("line 19")).toBeInTheDocument();
    // Only the tail is rendered collapsed (last 8 lines).
    expect(screen.queryByText("line 0")).not.toBeInTheDocument();
  });

  it("hides the live area once a result arrives", () => {
    const result: ChatToolResult = {
      role: "toolResult",
      toolCallId: "t1",
      toolName: "bash",
      content: [{ type: "text", text: "done" }],
      isError: false,
      timestamp: 1
    };
    render(<ToolCard call={call} result={result} progress={"stale output"} />);
    expect(screen.queryByText("stale output")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败** → Run: `pnpm --filter @marginalia/desktop test -- ToolCard.progress`

- [ ] **Step 3: 实现**

ToolCard 折叠行下（审批区之前）：

```tsx
{
  !result && progress && (
    <pre className="mono max-h-32 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-soft bg-surface px-3 py-2 text-[11.5px] text-text-muted">
      {progress.split("\n").slice(-8).join("\n")}
    </pre>
  );
}
```

MessageItem 渲染 ToolCard 处：`progress={toolProgressByCallId?.get(part.id)}`。MessageStream 的滚动 tail 串追加 `:${进度总长度}`——用 `toolProgressByCallId` 的 values 长度和（`[...map.values()].reduce((n, s) => n + s.length, 0)`）计入 `useMemo`，让实时输出增长也带动跟随。ChatView 接线按 Interfaces 描述（`onToolResultUpsert` 包装：先删 progress 再调 `messages.upsertToolResult`）。

- [ ] **Step 4: 运行确认通过** → `pnpm --filter @marginalia/desktop test`（全量零回归）

- [ ] **Step 5: 提交**

```bash
pnpm --filter @marginalia/desktop typecheck && pnpm lint && pnpm format:check
git add apps/desktop/src/chat apps/desktop/src/hooks
git commit -m "feat(desktop): live tool output tail while commands run"
```

---

### Task 5: ThinkingBlock 折叠化（废除顶部 transient 区）

**Files:**

- Create: `apps/desktop/src/chat/ThinkingBlock.tsx`
- Test: `apps/desktop/src/chat/ThinkingBlock.test.tsx`
- Modify: `apps/desktop/src/chat/MessageItem.tsx`（thinking part → ThinkingBlock）
- Modify: `apps/desktop/src/chat/MessageStream.tsx`、`apps/desktop/src/chat/ChatView.tsx`、`apps/desktop/src/hooks/useStreamingChat.ts`（移除 transient `reasoning` 链路）
- Modify: `apps/desktop/src/hooks/useStreamingChat.test.ts`（**删除**两个断言 `result.current.reasoning` 的既有用例："accumulates reasoning text from thinking deltas" 与 "clears reasoning once the answer starts streaming"——thinking 渲染改由新增的 `ThinkingBlock.test.tsx` 覆盖，无需迁移等价断言）
- Modify: `apps/desktop/src/chat/MessageStream.test.tsx`（**删除**既有用例 "shows a thinking indicator while reasoning streams"，它传 `reasoning` prop 且断言 `chat.thinking` 旧文案，本任务已删该 prop 与渲染块）
- Modify: `apps/desktop/src/i18n/messages.ts`（新增 `chat.thinkingLive`/`chat.thoughtFor`/`chat.thought`，en+zh；删除不再引用的 `chat.thinking` 键——zh `satisfies` 会强制两侧同步删）

**Interfaces:**

- Produces: `ThinkingBlock({ text, streaming }: { text: string; streaming: boolean })`
  - `streaming=true`：显示「思考中…」标签（`chat.thinkingLive`）+ 实时文本（`max-h-32 overflow-auto`，斜体沿用现有样式），组件内部用 `useRef` 记录首次挂载时间，text 停止增长且 `streaming` 变 false 时冻结秒数；
  - `streaming=false`：折叠为一行 `chat.thoughtFor`（"Thought for N s" / "已思考 · N 秒"；**无秒数时**——重开会话场景——用 `chat.thought`（"Thought" / "已思考")），点击展开/收起完整思考文本。
  - 秒数只在 live 会话内可得（组件 state），重开渲染必然走无秒数分支——这是 Global Constraints 里"瞬态降级"的既定形态。
- 事件模型依据（评审已用 pi 源码确证）：pi `message_update` 携带完整 message（含累计的 thinking part），`ensureAssistant(pi.message)` 已在每次 update 用它整体替换气泡内容，因此 **thinking 文本在流式期间就存在于消息 content 里**，无需 transient 通道。移除链路：`useStreamingChat` 删掉 `reasoning` state、`setReasoning` 调用与返回值；`MessageStream` 删掉 `reasoning` prop 与底部 transient 块（tail 串同步去掉 reasoning 长度项）；`ChatView` 删掉透传。**不要保留任何"message_update 只带 thinking_delta 不带 message"的降级分支**——真实 pi 与仓库的 scripted fake agent 的 `message_update` 必然带 `message`（`pi-agent-core` agent-loop 对 text/thinking/toolcall delta 走同一 `emit({message:{...partialMessage}})` 分支），该降级只会迁就旧 fixture 的失真事件，属死代码，随两个旧用例一并删除。

- [ ] **Step 1: 写失败测试**

```tsx
// apps/desktop/src/chat/ThinkingBlock.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ThinkingBlock } from "./ThinkingBlock.js";

describe("ThinkingBlock", () => {
  it("shows live label and text while streaming", () => {
    render(<ThinkingBlock text="pondering deeply" streaming />);
    expect(screen.getByText(/thinking|思考中/i)).toBeInTheDocument();
    expect(screen.getByText("pondering deeply")).toBeInTheDocument();
  });

  it("collapses when done and expands on click", async () => {
    render(<ThinkingBlock text="hidden reasoning" streaming={false} />);
    expect(screen.queryByText("hidden reasoning")).not.toBeInTheDocument();
    expect(screen.getByText(/thought|已思考/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByText("hidden reasoning")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败** → `pnpm --filter @marginalia/desktop test -- ThinkingBlock`

- [ ] **Step 3: 实现**

```tsx
// apps/desktop/src/chat/ThinkingBlock.tsx
import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn.js";
import { useTranslation } from "@/i18n/useTranslation.js";

export function ThinkingBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const startedAtRef = useRef<number>(Date.now());
  const [seconds, setSeconds] = useState<number | null>(null);

  useEffect(() => {
    if (!streaming && seconds === null && startedAtRef.current) {
      // Freeze the live duration once thinking finishes. Reopened sessions
      // mount with streaming=false on the first render and show no seconds.
      const elapsed = Math.round((Date.now() - startedAtRef.current) / 1000);
      setSeconds(elapsed > 0 ? elapsed : null);
    }
  }, [streaming, seconds]);

  if (streaming) {
    return (
      <div className="flex flex-col gap-1 border-l border-border pl-3">
        <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-text-faint">
          <span className="dot ok pulse" />
          {t("chat.thinkingLive")}
        </span>
        <div className="max-h-32 overflow-auto whitespace-pre-wrap text-[12.5px] italic text-text-muted">
          {text}
        </div>
      </div>
    );
  }

  return (
    <div className="border-l border-border pl-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 text-[11.5px] text-text-faint hover:text-text-muted"
      >
        <ChevronRight className={cn("h-3 w-3 transition-transform", expanded && "rotate-90")} />
        {seconds ? t("chat.thoughtFor").replace("{s}", String(seconds)) : t("chat.thought")}
      </button>
      {expanded && (
        <div className="mt-1 whitespace-pre-wrap text-[12.5px] italic text-text-muted">{text}</div>
      )}
    </div>
  );
}
```

注意：`useTranslation` 的 `t(key)` 单参不支持插值——`chat.thoughtFor` 的文案含占位 `{s}`（en "Thought for {s}s" / zh "已思考 · {s} 秒"），由组件 `.replace("{s}", …)` 填充（现有代码库无插值先例，此处组件内替换即可，不给 t 加参数）。首个 `streaming=false` 挂载（重开）时 `seconds` 计算出的是 0 → `null` → 显示无秒数分支，行为正确。

MessageItem：thinking part 分支改为 `<ThinkingBlock key={…} text={part.thinking} streaming={Boolean(streaming) && index === message.content.length - 1} />`（仅当 thinking 是当前正在生成的最后一个 part 时视为 streaming；简单判定：`streaming && !hasTextAfter`，实现时以"该 part 之后是否已有 text part"判断）。同任务内删除 MessageStream 的 reasoning 块与 `chat.thinking` 旧键引用（键保留给 zh/en 或删除——若删除，`satisfies` 会强制两侧同步删）。

- [ ] **Step 4: 运行确认通过** → `pnpm --filter @marginalia/desktop test`（全量）。前置：已按上面 Files 清单删除 `useStreamingChat.test.ts` 的 2 个 reasoning 用例与 `MessageStream.test.tsx` 的 1 个 thinking-indicator 用例（thinking 渲染的新断言由 `ThinkingBlock.test.tsx` 承担）。全量绿的判据 = 无 `reasoning` 相关红灯、ThinkingBlock 用例通过、其余零回归。

- [ ] **Step 5: 提交**

```bash
pnpm --filter @marginalia/desktop typecheck && pnpm lint && pnpm format:check
git add apps/desktop/src/chat apps/desktop/src/hooks apps/desktop/src/i18n/messages.ts
git commit -m "feat(desktop): collapsible thinking inline in assistant bubbles"
```

---

### Task 6: 代码块 chrome（复制按钮 + 语言标签）与 Markdown 元素补齐

**Files:**

- Create: `apps/desktop/src/chat/CodeBlock.tsx`
- Test: `apps/desktop/src/chat/CodeBlock.test.tsx`
- Modify: `apps/desktop/src/lib/markdown.tsx`（`code` 组件换用 CodeBlock；补 `table`/`blockquote`/`h1-h4` 渲染）
- Modify: `apps/desktop/src/i18n/messages.ts`（`common.copied`，en+zh；`common.copy` Task 3 已加）

**Interfaces:**

- Produces: `CodeBlock({ code, language }: { code: string; language: string })` — 顶部条：语言标签（mono 小字）+ 复制按钮（点击后 1.5s 内显示 `common.copied`）；主体沿用既有 `highlightCode` 输出。`markdownComponents.code` 有语言时渲染 CodeBlock，无语言保持现状内联样式。
- 外链系统浏览器打开已存在（保持）；`table` 加边框/斑马纹（`border-soft`、`bg-surface`）、`blockquote` 加 `border-l-2 border-brand/40 pl-3 text-text-muted`。

- [ ] **Step 1: 写失败测试**

```tsx
// apps/desktop/src/chat/CodeBlock.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CodeBlock } from "./CodeBlock.js";

describe("CodeBlock", () => {
  it("shows the language label and copies the raw code", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<CodeBlock code={'print("hi")'} language="python" />);
    expect(screen.getByText("python")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /copy|复制/i }));
    expect(writeText).toHaveBeenCalledWith('print("hi")');
    expect(await screen.findByText(/copied|已复制/i)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: 运行确认失败** → `pnpm --filter @marginalia/desktop test -- CodeBlock`

- [ ] **Step 3: 实现**

```tsx
// apps/desktop/src/chat/CodeBlock.tsx
import { useState } from "react";
import { highlightCode } from "@/lib/highlight.js";
import { useTranslation } from "@/i18n/useTranslation.js";

export function CodeBlock({ code, language }: { code: string; language: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="my-2 overflow-hidden rounded-md border border-border">
      <div className="flex items-center justify-between border-b border-soft bg-surface px-3 py-1">
        <span className="mono text-[11px] text-text-faint">{language}</span>
        <button
          type="button"
          onClick={() => void copy()}
          className="rounded px-1.5 py-0.5 text-[11px] text-text-muted hover:bg-surface-3"
        >
          {copied ? t("common.copied") : t("common.copy")}
        </button>
      </div>
      <pre className="overflow-x-auto bg-muted/50 p-3">
        <code
          className="hljs mono text-xs"
          dangerouslySetInnerHTML={{ __html: highlightCode(code, language) }}
        />
      </pre>
    </div>
  );
}
```

`markdown.tsx` 的 `code` 分支有 `match` 时 `return <CodeBlock code={raw} language={match[1]} />;`（原 pre/code 分支删除）；追加：

```tsx
table: (props) => (
  <div className="my-2 overflow-x-auto">
    <table className="w-full border-collapse text-[13px] [&_td]:border [&_td]:border-soft [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-soft [&_th]:bg-surface [&_th]:px-2 [&_th]:py-1 [&_th]:text-left" {...props} />
  </div>
),
blockquote: (props) => (
  <blockquote className="my-2 border-l-2 border-brand/40 pl-3 text-text-muted" {...props} />
)
```

- [ ] **Step 4: 运行确认通过** → `pnpm --filter @marginalia/desktop test -- CodeBlock MessageItem`

- [ ] **Step 5: 提交**

```bash
pnpm --filter @marginalia/desktop typecheck && pnpm lint && pnpm format:check
git add apps/desktop/src/chat/CodeBlock.tsx apps/desktop/src/chat/CodeBlock.test.tsx apps/desktop/src/lib/markdown.tsx apps/desktop/src/i18n/messages.ts
git commit -m "feat(desktop): code block chrome with copy and language label"
```

---

### Task 7: 长文排版（阅读宽度、标题层级、行距）

**Files:**

- Modify: `apps/desktop/src/lib/markdown.tsx`（`h1`-`h4`、`p`、`ul`/`ol` 渲染类）
- Modify: `apps/desktop/src/chat/MessageItem.tsx`（助手正文容器排版类）
- Test: `apps/desktop/src/lib/markdown.test.tsx`（新建：断言标题/段落类名与层级）

**Interfaces:**

- Produces（排版规格，Task 15 截图验收的依据）：
  - 助手正文容器：`max-w-[72ch]`（约 65–75 字符行长）+ `leading-7`；serif 用于正文（容器加 `font-serif`——确认 `styles.css`/`tailwind.config.ts` 的 serif token 名，若是 `font-display`/自定义类则用之；**先读再用，不新造字体栈**）；代码/路径保持 mono。
  - 标题：`h1` → `mt-4 mb-2 text-[1.25em] font-semibold`；`h2` → `mt-3 mb-1.5 text-[1.15em] font-semibold`；`h3` → `mt-2.5 mb-1 text-[1.05em] font-semibold`；`h4` → `mt-2 mb-1 font-semibold`；全部带 `id`（Task 8 锚点用，规则：`heading-<messageIndex 由 props 传入前缀>-<序号>`——本任务先输出 `id` 占位由 Task 8 完成串接，此处 heading 渲染函数从 `markdownComponents` 抽为 `createMarkdownComponents(prefix?: string)` 工厂，默认无前缀行为与现状兼容）。
  - `p` → `my-1.5`；`ul/ol` → `my-1.5 pl-5 list-disc / list-decimal`。

- [ ] **Step 1: 写失败测试**

```tsx
// apps/desktop/src/lib/markdown.test.tsx
import { render, screen } from "@testing-library/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vitest";
import { createMarkdownComponents } from "./markdown.js";

function md(text: string, prefix?: string) {
  return render(
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={createMarkdownComponents(prefix)}>
      {text}
    </ReactMarkdown>
  );
}

describe("createMarkdownComponents", () => {
  it("renders heading hierarchy with line-based ids when a prefix is given", () => {
    // ids come from the markdown source line (react-markdown node.position),
    // so "# One" is line 1 and "## Two" is line 3 (blank line between).
    md("# One\n\n## Two", "m1");
    expect(screen.getByText("One").id).toBe("m1-h-1");
    expect(screen.getByText("Two").id).toBe("m1-h-3");
    expect(screen.getByText("One").className).toMatch(/font-semibold/);
  });

  it("keeps headings id-less without a prefix", () => {
    md("# Solo");
    expect(screen.getByText("Solo").id).toBe("");
  });
});
```

- [ ] **Step 2: 运行确认失败** → `pnpm --filter @marginalia/desktop test -- markdown`

- [ ] **Step 3: 实现**

`markdown.tsx` 重构为工厂（保留既有 `markdownComponents` 导出 = `createMarkdownComponents()` 以免动全部调用点）：

**无状态、稳定的 heading id 用 react-markdown 的 `node.position`**（不要用渲染期计数器——会跨重渲染漂移）。`node` 与 `node.position` 在类型上都是 optional（`react-markdown@9` + `@types/hast`/`@types/unist`，仓库 `strict: true`），**必须可选链**，无 position 时回退到不带行号的稳定兜底（如 `${prefix}-h`）：

```tsx
import type { Components } from "react-markdown";
import type { Element } from "hast";

export function createMarkdownComponents(prefix?: string): Components {
  const headingId = (node: Element | undefined): string | undefined => {
    if (!prefix) return undefined;
    const line = node?.position?.start.line;
    return line ? `${prefix}-h-${line}` : `${prefix}-h`;
  };
  const heading =
    (Tag: "h1" | "h2" | "h3" | "h4", className: string) =>
    ({ node, children }: { node?: Element; children?: React.ReactNode }) => (
      <Tag id={headingId(node)} className={className}>
        {children}
      </Tag>
    );
  return {
    code({ className, children, ...props }) {
      /* Task 6 的实现原样搬入 */
    },
    a({ children, href, ...rest }) {
      /* 既有实现原样搬入 */
    },
    table: /* Task 6 */, blockquote: /* Task 6 */,
    h1: heading("h1", "mt-4 mb-2 text-[1.25em] font-semibold"),
    h2: heading("h2", "mt-3 mb-1.5 text-[1.15em] font-semibold"),
    h3: heading("h3", "mt-2.5 mb-1 text-[1.05em] font-semibold"),
    h4: heading("h4", "mt-2 mb-1 font-semibold"),
    p: (props) => <p className="my-1.5" {...props} />,
    ul: (props) => <ul className="my-1.5 list-disc pl-5" {...props} />,
    ol: (props) => <ol className="my-1.5 list-decimal pl-5" {...props} />
  };
}

export const markdownComponents: Components = createMarkdownComponents();
```

id 用 markdown 源行号（`node.position.start.line`，1-based），与 Task 8 `extractHeadings` 的行号同源一致。MessageItem 助手正文容器加排版类并传 `prefix={entry.id}`。因为 id 无状态（纯 `node` 派生），`createMarkdownComponents(entry.id)` 可安全 `useMemo`（依赖 `[entry.id]`），不会有计数器漂移——Task 7 的性能顾虑不再适用。

- [ ] **Step 4: 运行确认通过** → `pnpm --filter @marginalia/desktop test`（全量）

- [ ] **Step 5: 提交**

```bash
pnpm --filter @marginalia/desktop typecheck && pnpm lint && pnpm format:check
git add apps/desktop/src/lib/markdown.tsx apps/desktop/src/lib/markdown.test.tsx apps/desktop/src/chat/MessageItem.tsx
git commit -m "feat(desktop): long-form typography for assistant prose"
```

---

### Task 8: 长回答锚点目录（MessageToc）

**Files:**

- Create: `apps/desktop/src/chat/MessageToc.tsx`
- Test: `apps/desktop/src/chat/MessageToc.test.tsx`
- Modify: `apps/desktop/src/chat/MessageItem.tsx`（助手消息含 ≥3 个标题时在气泡顶部渲染）
- Modify: `apps/desktop/src/i18n/messages.ts`（`chat.outline`，en+zh："Outline" / "目录"）

**Interfaces:**

- Consumes: Task 7 的稳定 heading id（`<prefix>-h-<line>`）。
- Produces:
  - `type TocItem = { level: number; text: string; line: number }`
  - `extractHeadings(markdown: string): TocItem[]` — 纯函数（同文件导出）：逐行匹配 `/^(#{1,4})\s+(.+)$/`，跳过 fenced code block 内的行（遇 ``` 翻转 inCode 标志）。
  - `MessageToc({ items, prefix }: { items: TocItem[]; prefix: string })` — 紧凑列表（`text-[12px] text-text-muted`，按 level 缩进 `pl-[level*8px]`），点击 `document.getElementById(`${prefix}-h-${line}`)?.scrollIntoView({ block: "start", behavior: "smooth" })`。
  - MessageItem：对每个 text part 求 `extractHeadings`，全消息合计 ≥3 时在正文前渲染 `<MessageToc …/>`（items 合并，line 以各 part 内行号 + part 偏移不可行——**约定：只对第一个 text part 生成目录**，多 text part 的助手消息极少且目录仍指向主体；在代码注释里写明该取舍）。

- [ ] **Step 1: 写失败测试**

````tsx
// apps/desktop/src/chat/MessageToc.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { extractHeadings, MessageToc } from "./MessageToc.js";

describe("extractHeadings", () => {
  it("collects heading levels, text and line numbers, skipping code fences", () => {
    const md = ["# A", "", "```", "# not a heading", "```", "## B", "text", "### C"].join("\n");
    expect(extractHeadings(md)).toEqual([
      { level: 1, text: "A", line: 1 },
      { level: 2, text: "B", line: 6 },
      { level: 3, text: "C", line: 8 }
    ]);
  });
});

describe("MessageToc", () => {
  it("scrolls to the heading anchor on click", async () => {
    const target = document.createElement("h2");
    target.id = "m1-h-6";
    target.scrollIntoView = vi.fn();
    document.body.appendChild(target);
    render(<MessageToc prefix="m1" items={[{ level: 2, text: "B", line: 6 }]} />);
    await userEvent.click(screen.getByRole("button", { name: "B" }));
    expect(target.scrollIntoView).toHaveBeenCalled();
    target.remove();
  });
});
````

- [ ] **Step 2: 运行确认失败** → `pnpm --filter @marginalia/desktop test -- MessageToc`

- [ ] **Step 3: 实现**

````tsx
// apps/desktop/src/chat/MessageToc.tsx
import { List } from "lucide-react";
import { useTranslation } from "@/i18n/useTranslation.js";

export type TocItem = { level: number; text: string; line: number };

export function extractHeadings(markdown: string): TocItem[] {
  const items: TocItem[] = [];
  let inCode = false;
  markdown.split("\n").forEach((raw, index) => {
    if (raw.trimStart().startsWith("```")) {
      inCode = !inCode;
      return;
    }
    if (inCode) return;
    const match = /^(#{1,4})\s+(.+)$/.exec(raw);
    if (match) items.push({ level: match[1].length, text: match[2].trim(), line: index + 1 });
  });
  return items;
}

export function MessageToc({ items, prefix }: { items: TocItem[]; prefix: string }) {
  const { t } = useTranslation();
  return (
    <nav className="mb-2 rounded-lg border border-soft bg-surface px-3 py-2">
      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-faint">
        <List className="h-3 w-3" />
        {t("chat.outline")}
      </span>
      <ul className="mt-1 flex flex-col gap-0.5">
        {items.map((item) => (
          <li key={`${item.line}`} style={{ paddingLeft: (item.level - 1) * 8 }}>
            <button
              type="button"
              className="text-left text-[12px] text-text-muted hover:text-brand"
              onClick={() =>
                document
                  .getElementById(`${prefix}-h-${item.line}`)
                  ?.scrollIntoView({ block: "start", behavior: "smooth" })
              }
            >
              {item.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
````

MessageItem：第一个 text part 渲染前求 headings，`headings.length >= 3` 时插入 `<MessageToc items={headings} prefix={entry.id} />`（注意 Task 7 的 heading id 用的是 react-markdown `node.position.start.line`，与 extractHeadings 的行号同源一致——两者都是该 markdown 文本内的 1-based 行号）。

- [ ] **Step 4: 运行确认通过** → `pnpm --filter @marginalia/desktop test -- MessageToc MessageItem`

- [ ] **Step 5: 提交**

```bash
pnpm --filter @marginalia/desktop typecheck && pnpm lint && pnpm format:check
git add apps/desktop/src/chat/MessageToc.tsx apps/desktop/src/chat/MessageToc.test.tsx apps/desktop/src/chat/MessageItem.tsx apps/desktop/src/i18n/messages.ts
git commit -m "feat(desktop): anchor outline for long assistant answers"
```

---

### Task 9: 消息操作条——复制全文 + 导出 .md（Electron IPC）

**Files:**

- Modify: `apps/desktop/electron/main.ts`（`ipcMain.handle("marginalia:save-text-file", …)`）
- Modify: `apps/desktop/electron/preload.cts`（桥接 `saveTextFile`）
- Create: `apps/desktop/src/lib/save-file.ts`（renderer 侧封装 + 类型守卫）
- Create: `apps/desktop/src/chat/MessageActions.tsx`
- Test: `apps/desktop/src/chat/MessageActions.test.tsx`、`apps/desktop/src/lib/save-file.test.ts`
- Modify: `apps/desktop/src/chat/MessageItem.tsx`（助手消息 hover 显示操作条）
- Modify: `apps/desktop/src/i18n/messages.ts`（`message.copyAll`/`message.exportMd`/`message.saveToWorkspace`，en+zh）

**Interfaces:**

- Produces:
  - main：`ipcMain.handle("marginalia:save-text-file", async (_e, input: { defaultName: string; content: string })) ` → `dialog.showSaveDialog({ defaultPath: defaultName, filters: [{ name: "Markdown", extensions: ["md"] }] })`，确认后 `writeFile`，返回 `{ saved: boolean; path?: string }`（取消 → `{ saved: false }`）。窗口引用与既有 `workspace:pick-directory` 同模式。
  - preload：`saveTextFile(input) => ipcRenderer.invoke("marginalia:save-text-file", input)`（沿用 preload.cts 现有 contextBridge 结构，**先读该文件**按同样风格追加）。
  - renderer：`saveTextFile(defaultName: string, content: string): Promise<{ saved: boolean; path?: string }>` —— `window.marginalia?.saveTextFile` 不存在（纯浏览器/测试环境）时返回 `{ saved: false }`。
  - `MessageActions({ markdown, onSaveToWorkspace }: { markdown: string; onSaveToWorkspace?: () => void })` — 三个 icon 按钮（Copy / Download / FolderDown，lucide），`aria-label` 走 i18n；复制用 `navigator.clipboard.writeText(markdown)`；导出用 `saveTextFile("answer.md", markdown)`（默认名由调用方传，MessageItem 用 `marginalia-<entry.id 前 6 位>.md`）；`onSaveToWorkspace` 未传时第三个按钮不渲染（Task 11 接线）。
  - MessageItem：助手气泡容器 `group relative`，操作条 `absolute -top-2 right-0 opacity-0 group-hover:opacity-100 transition-opacity`；`markdown` 取全部 text part 拼接（`stringifyContent`）。

- [ ] **Step 1: 写失败测试**

```tsx
// apps/desktop/src/chat/MessageActions.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MessageActions } from "./MessageActions.js";

describe("MessageActions", () => {
  it("copies the full markdown", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<MessageActions markdown="# 结论\n正文" />);
    await userEvent.click(screen.getByRole("button", { name: /copy|复制全文/i }));
    expect(writeText).toHaveBeenCalledWith("# 结论\n正文");
    vi.unstubAllGlobals();
  });

  it("exports via the electron bridge when present", async () => {
    const saveTextFile = vi.fn(async () => ({ saved: true, path: "/tmp/a.md" }));
    vi.stubGlobal("window", Object.assign(window, { marginalia: { saveTextFile } }));
    render(<MessageActions markdown="body" defaultName="report.md" />);
    await userEvent.click(screen.getByRole("button", { name: /export|导出/i }));
    expect(saveTextFile).toHaveBeenCalledWith({ defaultName: "report.md", content: "body" });
  });

  it("omits the workspace button without a handler", () => {
    render(<MessageActions markdown="x" />);
    expect(screen.queryByRole("button", { name: /workspace|存入/i })).not.toBeInTheDocument();
  });
});
```

```ts
// apps/desktop/src/lib/save-file.test.ts
import { describe, expect, it, vi } from "vitest";
import { saveTextFile } from "./save-file.js";

describe("saveTextFile", () => {
  it("returns saved:false when the bridge is unavailable", async () => {
    expect(await saveTextFile("a.md", "x")).toEqual({ saved: false });
  });

  it("delegates to window.marginalia.saveTextFile", async () => {
    const bridge = vi.fn(async () => ({ saved: true, path: "/p/a.md" }));
    (window as unknown as { marginalia?: unknown }).marginalia = { saveTextFile: bridge };
    expect(await saveTextFile("a.md", "x")).toEqual({ saved: true, path: "/p/a.md" });
    expect(bridge).toHaveBeenCalledWith({ defaultName: "a.md", content: "x" });
    delete (window as unknown as { marginalia?: unknown }).marginalia;
  });
});
```

- [ ] **Step 2: 运行确认失败** → `pnpm --filter @marginalia/desktop test -- MessageActions save-file`

- [ ] **Step 3: 实现**

`save-file.ts`：

```ts
type SaveResult = { saved: boolean; path?: string };
type MarginaliaBridge = {
  saveTextFile?: (input: { defaultName: string; content: string }) => Promise<SaveResult>;
};

export async function saveTextFile(defaultName: string, content: string): Promise<SaveResult> {
  const bridge = (window as { marginalia?: MarginaliaBridge }).marginalia;
  if (!bridge?.saveTextFile) return { saved: false };
  return bridge.saveTextFile({ defaultName, content });
}
```

main.ts（在既有 handle 簇后追加）。**复用模块级 `windowRef`**（`main.ts:16` 声明、`createWindow()` 赋值），与既有 `workspace:pick-directory`（`main.ts:110-118`）一致——**不要**新建局部 `const windowRef = BrowserWindow.getFocusedWindow()`，那会遮蔽模块级变量且在原生对话框抢焦点时可能返回 null，语义与既有 handler 不一致：

```ts
ipcMain.handle("marginalia:save-text-file", async (_event, input: unknown) => {
  const { defaultName, content } = input as { defaultName: string; content: string };
  const options = {
    defaultPath: defaultName,
    filters: [{ name: "Markdown", extensions: ["md"] }]
  };
  // windowRef is the module-level ref (same as workspace:pick-directory).
  const result = windowRef
    ? await dialog.showSaveDialog(windowRef, options)
    : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return { saved: false };
  await writeFile(result.filePath, content, "utf8");
  return { saved: true, path: result.filePath };
});
```

（`writeFile` 从 `node:fs/promises` 引入；main.ts 现有 import 风格保持。）preload.cts 按现有桥对象追加 `saveTextFile`。`MessageActions` 组件按 Interfaces 描述实现（`defaultName?: string` prop，默认 `"marginalia.md"`）。MessageItem 接线：仅 assistant 且有非空 text 时渲染。

- [ ] **Step 4: 运行确认通过** → `pnpm --filter @marginalia/desktop test`（全量；electron 侧逻辑由 `dev-script.test.ts` 同级的源码断言测试覆盖不到 dialog——main.ts 的 handler 以"包含 handle 注册与 showSaveDialog 调用"的源码断言加进 `apps/desktop/electron/external-url.test.ts` 旁新建的 `save-file-ipc.test.ts`：`readFileSync(main.ts)` 断言含 `"marginalia:save-text-file"` 与 `showSaveDialog`——与仓库既有 `verify-screenshots.test.ts` 源码断言先例同模式）

- [ ] **Step 5: 提交**

```bash
pnpm --filter @marginalia/desktop typecheck && pnpm lint && pnpm format:check
git add apps/desktop/electron apps/desktop/src/lib/save-file.ts apps/desktop/src/lib/save-file.test.ts \
  apps/desktop/src/chat/MessageActions.tsx apps/desktop/src/chat/MessageActions.test.tsx \
  apps/desktop/src/chat/MessageItem.tsx apps/desktop/src/i18n/messages.ts
git commit -m "feat(desktop): assistant message actions with copy and export"
```

---

### Task 10: pi-server 写文件端点 + api client

**Files:**

- Modify: `apps/pi-server/src/app.ts`（`PUT /workspaces/:id/files/content`）
- Test: `apps/pi-server/test/files-write.test.ts`
- Modify: `apps/desktop/src/api/client.ts`（`writeWorkspaceFile`）
- Test: `apps/desktop/src/api/client.approvals.test.ts` 旁新建 `client.files-write.test.ts`

**Interfaces:**

- Produces:
  - `PUT /workspaces/:id/files/content`，body `{ path: string; content: string; overwrite?: boolean }`：
    - workspace 不存在 → 404；path 越界（`resolveWorkspacePath` 抛错）→ 403；
    - 目标已存在且 `!overwrite` → **409** `{ error: "file exists" }`；
    - 成功写入（`mkdir -p` 父目录）→ 已存在时 200、新建时 201，返回 `{ path }`。
  - `ApiClient.writeWorkspaceFile(workspaceId: string, input: { path: string; content: string; overwrite?: boolean }): Promise<{ path: string }>` — 409 时 `request` 既有错误路径抛 `Error("file exists")`，调用方以 message 判定。

- [ ] **Step 1: 写失败测试（server）**

```ts
// apps/pi-server/test/files-write.test.ts
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/migrations.js";
import { createWorkspace } from "../src/db/repositories.js";

const dbs: Database.Database[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

function setup() {
  const db = new Database(":memory:");
  dbs.push(db);
  migrate(db);
  const root = mkdtempSync(path.join(os.tmpdir(), "files-write-"));
  const ws = createWorkspace(db, { name: "W", rootDir: root });
  return { app: createApp({ db }), ws, root };
}

function put(app: ReturnType<typeof createApp>, wsId: string, body: unknown) {
  return app.request(`/workspaces/${wsId}/files/content`, {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" }
  });
}

describe("PUT /workspaces/:id/files/content", () => {
  it("creates a new file with parent dirs (201)", async () => {
    const { app, ws, root } = setup();
    const res = await put(app, ws.id, { path: "notes/结论.md", content: "# 结论\n" });
    expect(res.status).toBe(201);
    expect(readFileSync(path.join(root, "notes/结论.md"), "utf8")).toBe("# 结论\n");
  });

  it("rejects an existing target without overwrite (409), overwrites with the flag (200)", async () => {
    const { app, ws, root } = setup();
    writeFileSync(path.join(root, "a.md"), "old");
    expect((await put(app, ws.id, { path: "a.md", content: "new" })).status).toBe(409);
    expect(readFileSync(path.join(root, "a.md"), "utf8")).toBe("old");
    const ok = await put(app, ws.id, { path: "a.md", content: "new", overwrite: true });
    expect(ok.status).toBe(200);
    expect(readFileSync(path.join(root, "a.md"), "utf8")).toBe("new");
  });

  it("blocks path escapes (403) and unknown workspaces (404)", async () => {
    const { app, ws } = setup();
    expect((await put(app, ws.id, { path: "../out.md", content: "x" })).status).toBe(403);
    expect((await put(app, "nope", { path: "a.md", content: "x" })).status).toBe(404);
  });
});
```

- [ ] **Step 2: 运行确认失败** → `pnpm --filter @marginalia/pi-server test -- files-write`

- [ ] **Step 3: 实现（app.ts，放在既有 files 路由簇内）**

```ts
app.put("/workspaces/:id/files/content", async (c) => {
  const workspace = getWorkspace(db, c.req.param("id"));
  if (!workspace) return c.json({ error: "workspace not found" }, 404);
  const body = await c.req.json<{ path: string; content: string; overwrite?: boolean }>();
  try {
    const absolute = resolveWorkspacePath(workspace.rootDir, body.path ?? "");
    const exists = existsSync(absolute);
    if (exists && !body.overwrite) return c.json({ error: "file exists" }, 409);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, body.content ?? "", "utf8");
    return c.json({ path: body.path }, exists ? 200 : 201);
  } catch (error) {
    if ((error as Error).message === "Path escapes workspace")
      return c.json({ error: "Path escapes workspace" }, 403);
    return c.json({ error: (error as Error).message }, 500);
  }
});
```

（`existsSync` 已在 app.ts 顶部 import 组里？**先查**——现有 import 是 `createReadStream, statSync`；追加 `existsSync`；`mkdir/writeFile` 从 `node:fs/promises` 新增 import。）desktop `writeWorkspaceFile` 走既有 `request<T>` 模式 + PUT；client 测试按 Task 9 的 stub fetch 模式断言 URL/method/body 与 409 抛错。

- [ ] **Step 4: 运行确认通过** → 两包 focused + `pnpm --filter @marginalia/pi-server test`

- [ ] **Step 5: 提交**

```bash
pnpm --filter @marginalia/pi-server typecheck && pnpm --filter @marginalia/desktop typecheck && pnpm lint && pnpm format:check
git add apps/pi-server/src/app.ts apps/pi-server/test/files-write.test.ts apps/desktop/src/api/client.ts apps/desktop/src/api/client.files-write.test.ts
git commit -m "feat(pi-server): workspace file write endpoint with overwrite guard"
```

---

### Task 11: 存入 workspace UI（文件名 + 覆盖确认）

**Files:**

- Create: `apps/desktop/src/chat/SaveToWorkspaceDialog.tsx`
- Test: `apps/desktop/src/chat/SaveToWorkspaceDialog.test.tsx`
- Modify: `apps/desktop/src/chat/MessageItem.tsx` / `MessageStream.tsx` / `ChatView.tsx`（把 `onSaveToWorkspace` 从 ChatView 一路传到 MessageActions；ChatView 持有 dialog 状态与 `activeWorkspaceId`）
- Modify: `apps/desktop/src/i18n/messages.ts`（`saveDialog.*` 键，en+zh）

**Interfaces:**

- Produces: `SaveToWorkspaceDialog({ open, defaultName, onCancel, onSave }: { open: boolean; defaultName: string; onCancel(): void; onSave(fileName: string, overwrite: boolean): Promise<"saved" | "exists"> })`
  - 文件名输入（默认值 `defaultName`）+ 保存/取消；
  - `onSave(name, false)` 返回 `"exists"` 时切换到覆盖确认态（`saveDialog.overwriteHint`：显示"文件已存在，覆盖？"+「覆盖」按钮 → `onSave(name, true)`）；返回 `"saved"` 关闭。
  - ChatView 提供 onSave 实现：`api.writeWorkspaceFile(activeWorkspaceId, { path: name, content, overwrite })`，catch `error.message === "file exists"` → 返回 `"exists"`，其余 setError 并关闭；成功后关闭。`defaultName`：消息首个标题 slug 或 `marginalia-笔记.md`。
  - 用户主动写入**不走 agent 审批流**（spec 修订明确），只有这个覆盖确认。

- [ ] **Step 1: 写失败测试**

```tsx
// apps/desktop/src/chat/SaveToWorkspaceDialog.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SaveToWorkspaceDialog } from "./SaveToWorkspaceDialog.js";

describe("SaveToWorkspaceDialog", () => {
  it("saves under the edited file name", async () => {
    const onSave = vi.fn(async () => "saved" as const);
    render(<SaveToWorkspaceDialog open defaultName="a.md" onCancel={() => {}} onSave={onSave} />);
    const input = screen.getByRole("textbox");
    await userEvent.clear(input);
    await userEvent.type(input, "notes/b.md");
    await userEvent.click(screen.getByRole("button", { name: /save|保存/i }));
    expect(onSave).toHaveBeenCalledWith("notes/b.md", false);
  });

  it("asks before overwriting an existing file", async () => {
    const onSave = vi.fn(
      async (_n: string, overwrite: boolean) => (overwrite ? "saved" : "exists") as const
    );
    render(<SaveToWorkspaceDialog open defaultName="a.md" onCancel={() => {}} onSave={onSave} />);
    await userEvent.click(screen.getByRole("button", { name: /save|保存/i }));
    expect(await screen.findByText(/exists|已存在/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /overwrite|覆盖/i }));
    expect(onSave).toHaveBeenLastCalledWith("a.md", true);
  });
});
```

- [ ] **Step 2: 运行确认失败** → `pnpm --filter @marginalia/desktop test -- SaveToWorkspaceDialog`

- [ ] **Step 3: 实现**

对话框样式沿用仓库既有 dialog（参照 `sidebar/ConfirmDeleteDialog.tsx` 的结构与类名——**先读它**，保持同一视觉习惯：遮罩 + 居中卡片 + 按钮排布）。状态机：`"input" | "confirm-overwrite" | "saving"`；`open` 变化时重置。ChatView 接线：`const [saveTarget, setSaveTarget] = useState<{ markdown: string; defaultName: string } | null>(null)`；MessageActions 的 `onSaveToWorkspace` = `() => setSaveTarget({ markdown, defaultName })`（经 MessageStream/MessageItem 以 `onSaveMessage?: (markdown: string, defaultName: string) => void` 透传）；无 `activeWorkspaceId` 时不传该回调（按钮自然不显示）。

- [ ] **Step 4: 运行确认通过** → `pnpm --filter @marginalia/desktop test`（全量）

- [ ] **Step 5: 提交**

```bash
pnpm --filter @marginalia/desktop typecheck && pnpm lint && pnpm format:check
git add apps/desktop/src/chat apps/desktop/src/i18n/messages.ts
git commit -m "feat(desktop): save assistant answers into the workspace"
```

---

### Task 12: 滚动跟随重做（暂停 + 回到底部胶囊）

**Files:**

- Modify: `apps/desktop/src/chat/MessageStream.tsx`（自持滚动容器 + 跟随状态机）
- Modify: `apps/desktop/src/chat/ChatView.tsx`（外层 `overflow-auto` 容器移除，改 `flex-1 min-h-0`）
- Test: `apps/desktop/src/chat/MessageStream.scroll.test.tsx`
- Modify: `apps/desktop/src/i18n/messages.ts`（`chat.backToBottom`，en+zh："Back to bottom" / "回到底部"）

**Interfaces:**

- Produces（行为规格）：
  - MessageStream 根元素变为 `relative h-full overflow-auto`（滚动权收进组件）；
  - 跟随状态：默认 follow；`onScroll` 时若 `scrollHeight - scrollTop - clientHeight > 48` 判定用户离底 → `paused`；回到底部（≤48）→ 恢复 follow；
  - `tail` 变化时：follow → 滚到底（既有逻辑）；paused → 不滚，仅置 `hasNews=true`；
  - 胶囊：`paused && hasNews` 时显示（`absolute bottom-4 right-4` 圆角按钮，ArrowDown 图标 + `t("chat.backToBottom")`），点击 → 滚到底 + 恢复 follow + 清 hasNews；
  - `streaming` 从 true 变 false（流式结束）→ 恢复 follow 并滚底（spec：流式结束恢复）。

- [ ] **Step 1: 写失败测试**

```tsx
// apps/desktop/src/chat/MessageStream.scroll.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ChatEntry } from "@marginalia/chat-core";
import { MessageStream } from "./MessageStream.js";

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
};
const assistant = (id: string, text: string): ChatEntry => ({
  id,
  message: {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "a",
    provider: "p",
    model: "m",
    usage,
    stopReason: "stop",
    timestamp: 2
  }
});

function scrolledUp(container: HTMLElement) {
  const scroller = container.firstElementChild as HTMLElement;
  Object.defineProperty(scroller, "scrollHeight", { value: 1000, configurable: true });
  Object.defineProperty(scroller, "clientHeight", { value: 400, configurable: true });
  Object.defineProperty(scroller, "scrollTop", { value: 100, writable: true, configurable: true });
  fireEvent.scroll(scroller);
  return scroller;
}

describe("MessageStream follow state", () => {
  it("pauses following and shows the pill when the user scrolls up and news arrives", () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    const { container, rerender } = render(
      <MessageStream messages={[assistant("1", "a")]} error={null} onRetry={() => {}} streaming />
    );
    scrolledUp(container);
    const before = scrollSpy.mock.calls.length;
    rerender(
      <MessageStream
        messages={[assistant("1", "ab more")]}
        error={null}
        onRetry={() => {}}
        streaming
      />
    );
    expect(scrollSpy.mock.calls.length).toBe(before); // no auto-scroll while paused
    expect(screen.getByRole("button", { name: /back to bottom|回到底部/i })).toBeInTheDocument();
  });

  it("resumes on pill click", async () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    const { container, rerender } = render(
      <MessageStream messages={[assistant("1", "a")]} error={null} onRetry={() => {}} streaming />
    );
    scrolledUp(container);
    rerender(
      <MessageStream messages={[assistant("1", "ab")]} error={null} onRetry={() => {}} streaming />
    );
    const before = scrollSpy.mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: /back to bottom|回到底部/i }));
    expect(scrollSpy.mock.calls.length).toBeGreaterThan(before);
  });
});
```

- [ ] **Step 2: 运行确认失败** → `pnpm --filter @marginalia/desktop test -- MessageStream.scroll`

- [ ] **Step 3: 实现**

```tsx
const scrollerRef = useRef<HTMLDivElement | null>(null);
const [paused, setPaused] = useState(false);
const [hasNews, setHasNews] = useState(false);

function handleScroll() {
  const el = scrollerRef.current;
  if (!el) return;
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 48;
  setPaused(!nearBottom);
  if (nearBottom) setHasNews(false);
}

function scrollToBottom() {
  bottomRef.current?.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "end" });
  setPaused(false);
  setHasNews(false);
}

useEffect(() => {
  if (paused) {
    setHasNews(true);
    return;
  }
  // …既有 scrollIntoView 逻辑…
}, [tail]);

useEffect(() => {
  if (!streaming) scrollToBottom(); // 流式结束恢复跟随
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [streaming]);
```

根结构：`<div ref={scrollerRef} onScroll={handleScroll} className="relative h-full overflow-auto"> …列表… <div ref={bottomRef}/> {paused && hasNews && <胶囊/>} </div>`（胶囊 `sticky bottom-4 float-right`？——`absolute` 相对滚动容器会随内容滚走，**用 `sticky bottom-4 ml-auto flex w-fit`** 贴在视口内）。ChatView 外层 div 改 `flex-1 min-h-0`。注意保留空态分支与既有类名（`mx-auto max-w-3xl` 移到内层列表 div）。

- [ ] **Step 4: 运行确认通过** → `pnpm --filter @marginalia/desktop test -- MessageStream`（全部滚动用例含 Task 前的 approval-scroll 用例）

- [ ] **Step 5: 提交**

```bash
pnpm --filter @marginalia/desktop typecheck && pnpm lint && pnpm format:check
git add apps/desktop/src/chat/MessageStream.tsx apps/desktop/src/chat/MessageStream.scroll.test.tsx apps/desktop/src/chat/ChatView.tsx apps/desktop/src/i18n/messages.ts
git commit -m "feat(desktop): pausable follow scroll with back-to-bottom pill"
```

---

### Task 13: 回合级文件变更摘要——服务端（file_changed envelope + auto 持久化）

**Files:**

- Modify: `apps/pi-server/src/agent/agent-client.ts`（`FileChangedEvent` 类型并入 `AgentRunEvent`）
- Modify: `apps/pi-server/src/agent/approval-gateway.ts`（`notifyFileChange`）
- Modify: `apps/pi-server/src/agent/approval-extension.ts`（直通 edit/write 也产 diff 并通知）
- Modify: `apps/pi-server/src/db/repositories.ts`（`createApproval` 支持 `status` 入参，默认 "pending"；`ApprovalRow.status` 加 `"auto"`）
- Modify: `apps/pi-server/src/app.ts`（分流 `file_changed` envelope + 以 `auto` 状态持久化）
- Test: `apps/pi-server/test/file-changed.test.ts`

**Interfaces:**

- Produces:
  - `type FileChangedEvent = { type: "file_changed"; sessionId: string; toolCallId: string; toolName: string; payload: ApprovalPayload }`（payload 复用 file_edit 分支）；`AgentRunEvent` 并入。
  - gateway：`notifyFileChange(sessionId, event: Omit<FileChangedEvent, "type" | "sessionId">): void` — 仅向 onEvent 监听者广播，无 pending。
  - extension：`evaluate` 返回 "allow" 且 `toolName === "edit" || "write"` 时，仍 `buildPayload` 并 `gateway.notifyFileChange(...)`，随后放行（不阻塞）。`bash` 直通不通知（命令的文件副作用无法静态得知——记为已知边界，写入 api.md）。
  - app.ts：`file_changed` → `createApproval(db, { …, status: "auto" })` 后 `emit("file_changed", { change: event })`；SSE envelope 第四类。
  - `GET /sessions/:id/approvals` 自然含 `auto` 行（重开摘要还原的数据源）。
  - desktop 类型联动最小化：`Approval["status"]` 加 `"auto"`（Task 14 消费）。

- [ ] **Step 1: 写失败测试**

```ts
// apps/pi-server/test/file-changed.test.ts
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ApprovalGateway } from "../src/agent/approval-gateway.js";
import { createApprovalExtension, type PiExtensionApi } from "../src/agent/approval-extension.js";

type Handler = (
  event: { toolName: string; toolCallId: string; input: Record<string, unknown> },
  ctx: unknown
) => Promise<{ block: boolean; reason?: string } | undefined>;

function register(gateway: ApprovalGateway, sessionId: string): Handler {
  let handler: Handler | null = null;
  const pi: PiExtensionApi = {
    on: (type, h) => {
      if (type === "tool_call") handler = h;
    }
  };
  createApprovalExtension(gateway, sessionId)(pi);
  return handler!;
}

describe("file_changed notifications", () => {
  it("notifies with a diff for allowed new-file writes without blocking", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "file-changed-"));
    const gateway = new ApprovalGateway();
    gateway.setPolicy("s1", { permission: "ask", workspaceRoot: root });
    const events: Array<{ type: string; payload?: { kind?: string } }> = [];
    gateway.onEvent("s1", (e) => events.push(e as never));
    const handler = register(gateway, "s1");
    const result = await handler(
      { toolName: "write", toolCallId: "t1", input: { path: "new.md", content: "hello\n" } },
      {}
    );
    expect(result).toBeUndefined();
    expect(gateway.pendingIds("s1")).toHaveLength(0);
    const change = events.find((e) => e.type === "file_changed");
    expect(change?.payload?.kind).toBe("file_edit");
  });

  it("notifies with a real diff for full-permission edits using the edits-array shape", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "file-changed-full-"));
    writeFileSync(path.join(root, "a.md"), "# 旧标题\n");
    const gateway = new ApprovalGateway();
    gateway.setPolicy("s1", { permission: "full", workspaceRoot: root });
    const events: Array<{ type: string; payload?: { patch?: string; exact?: boolean } }> = [];
    gateway.onEvent("s1", (e) => events.push(e as never));
    const handler = register(gateway, "s1");
    await handler(
      {
        toolName: "edit",
        toolCallId: "t2",
        // pi's current edit tool uses this array shape — the diff must NOT be empty.
        input: { path: "a.md", edits: [{ oldText: "# 旧标题", newText: "# 新标题" }] }
      },
      {}
    );
    const change = events.find((e) => e.type === "file_changed");
    expect(change).toBeTruthy();
    expect(change?.payload?.exact).toBe(true);
    expect(change?.payload?.patch).toContain("+# 新标题");
  });

  it("does not notify for bash or read", async () => {
    const gateway = new ApprovalGateway();
    gateway.setPolicy("s1", { permission: "full", workspaceRoot: "/tmp" });
    const events: unknown[] = [];
    gateway.onEvent("s1", (e) => events.push(e));
    const handler = register(gateway, "s1");
    await handler({ toolName: "bash", toolCallId: "t3", input: { command: "ls" } }, {});
    await handler({ toolName: "read", toolCallId: "t4", input: { path: "a.md" } }, {});
    expect(events).toHaveLength(0);
  });
});
```

另在 `approval-flow.test.ts` 风格上补一个 app 层用例（同文件追加）：enqueue 一个 `file_changed` 事件到 FakeAgentClient → SSE 出现 `file_changed` envelope 且 `listApprovals` 出现 `status: "auto"` 行。

- [ ] **Step 2: 运行确认失败** → `pnpm --filter @marginalia/pi-server test -- file-changed`

- [ ] **Step 3: 实现**

按 Interfaces 逐条落：gateway 的 `notifyFileChange` 直接 `this.emit(sessionId, { type: "file_changed", sessionId, ...event })`（`emit` 的参数类型从 `ApprovalEvent` 放宽为 `ApprovalEvent | FileChangedEvent`——或把 `FileChangedEvent` 并进 `ApprovalEvent` 联合的兄弟类型，onEvent 监听器签名同步放宽）；extension 在 `if (need === "allow")` 分支内：

```ts
if (need === "allow") {
  if (event.toolName === "edit" || event.toolName === "write") {
    const workspaceRoot = gateway.policyFor(sessionId)?.workspaceRoot ?? "";
    const input = event.input;
    const relPath = typeof input.path === "string" ? input.path : "";
    if (relPath) {
      // MUST reuse buildFileEditPayload → previewEdits(parseEdits(input)), NOT
      // previewEdit(oldText,newText). pi's edit tool uses the {edits:[...]}
      // array shape; the legacy single-pair path yields an empty diff (this is
      // the exact bug commit 96bf76e fixed for the ask path — do not reintroduce it).
      const payload = buildFileEditPayload(
        event.toolName as "edit" | "write",
        relPath,
        input,
        workspaceRoot
      );
      gateway.notifyFileChange(sessionId, {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        payload
      });
    }
  }
  return undefined;
}
```

**重构（必做，消除重复且防止字段名回归）**：把 `approval-extension.ts` 里 `buildPayload` 的 file_edit 分支抽成共用函数，`buildPayload` 与上面的直通分支都调用它：

```ts
function buildFileEditPayload(
  mode: "edit" | "write",
  relPath: string,
  input: Record<string, unknown>,
  workspaceRoot: string
): ApprovalPayload {
  const preview =
    mode === "edit"
      ? previewEdits(workspaceRoot, relPath, parseEdits(input))
      : previewWrite(workspaceRoot, relPath, String(input.content ?? ""));
  return { kind: "file_edit", path: relPath, mode, ...preview };
}
```

（`parseEdits` 与 `previewEdits` 已存在于 `approval-extension.ts` / `diff-preview.ts`，P1-A commit 96bf76e 引入；直接复用，勿新写单形态解析。）`createApproval` 加可选 `status`（insert 语句的 `'pending'` 字面量改绑参数，默认 `"pending"`）；app.ts 在审批分流旁加：

```ts
if (type === "file_changed") {
  const change = event as FileChangedEvent;
  createApproval(db, {
    id: randomUUID(),
    sessionId,
    runId: run.id,
    toolCallId: change.toolCallId,
    toolName: change.toolName,
    kind: "file_edit",
    payload: change.payload,
    status: "auto"
  });
  await emit("file_changed", { change });
  continue;
}
```

（`randomUUID` 从 `node:crypto` import。）desktop `Approval["status"]` 联合加 `"auto"`；ToolCard 对 `auto` 不渲染任何审批 UI（现有分支只匹配 pending/denied/expired，天然满足——加一行注释说明 auto 供摘要/展开 diff 用）。

- [ ] **Step 4: 运行确认通过** → `pnpm --filter @marginalia/pi-server test` + `pnpm --filter @marginalia/desktop typecheck`

- [ ] **Step 5: 提交**

```bash
pnpm lint && pnpm format:check
git add apps/pi-server/src apps/pi-server/test apps/desktop/src/api/client.ts
git commit -m "feat(pi-server): file_changed envelope with auto-persisted diffs"
```

---

### Task 14: 回合级文件变更摘要——桌面端（TurnSummary）

**Files:**

- Create: `apps/desktop/src/chat/TurnSummary.tsx`
- Test: `apps/desktop/src/chat/TurnSummary.test.tsx`
- Modify: `apps/desktop/src/hooks/useStreamingChat.ts`（`file_changed` envelope → `onFileChanged` 回调）
- Modify: `apps/desktop/src/chat/ChatView.tsx` / `MessageStream.tsx`（收集本回合变更 → run 完成后在流末尾渲染 TurnSummary；重开时由 `listApprovals` 的 `auto`/`approved` file_edit 行还原）
- Modify: `apps/desktop/src/i18n/messages.ts`（`turnSummary.changed`（含 `{n}`/`{a}`/`{d}` 占位，组件替换）等，en+zh）

**Interfaces:**

- Produces:
  - `useStreamingChat` `Options.onFileChanged?: (change: { toolCallId: string; toolName: string; payload: ApprovalPayload }) => void`（解析 `event.payload.change`，缺失静默跳过）。
  - `type TurnChange = { toolCallId: string; path: string; additions: number; deletions: number; patch: string }`
  - `TurnSummary({ changes }: { changes: TurnChange[] })` — 一行汇总「修改了 N 个文件 +a -b」（i18n 占位替换），点击展开逐文件 `DiffView`（文件路径 + ±统计小标题）。
  - ChatView：`changes` 来源二合一——live：`onFileChanged` + `onApprovalResolved(approved)` 时从 approvals map 取 file_edit payload 追加；reopen：`listApprovals` 里 `kind === "file_edit"` 且 `status ∈ {"approved","auto"}` 的行映射为 TurnChange（**全会话聚合为一个汇总条**，渲染在消息流末尾；live 时每次 run 完成后重算并保留——与重开一致的近似形态，注释注明）。去重键 `toolCallId`。
  - MessageStream 在列表末尾（error 块之前）渲染 `changes.length > 0 && <TurnSummary changes={changes} />`。

- [ ] **Step 1: 写失败测试**

```tsx
// apps/desktop/src/chat/TurnSummary.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { TurnSummary } from "./TurnSummary.js";

const changes = [
  { toolCallId: "t1", path: "摘要.md", additions: 3, deletions: 1, patch: "@@ -1 +1 @@\n-旧\n+新" },
  { toolCallId: "t2", path: "notes/b.md", additions: 10, deletions: 0, patch: "@@ -0,0 +1 @@\n+x" }
];

describe("TurnSummary", () => {
  it("aggregates files and line stats", () => {
    render(<TurnSummary changes={changes} />);
    expect(screen.getByText(/2/)).toBeInTheDocument();
    expect(screen.getByText(/\+13/)).toBeInTheDocument();
    expect(screen.getByText(/-1/)).toBeInTheDocument();
  });

  it("expands to per-file diffs", async () => {
    render(<TurnSummary changes={changes} />);
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByText("摘要.md")).toBeInTheDocument();
    expect(screen.getByText("+新")).toBeInTheDocument();
    expect(screen.getByText("notes/b.md")).toBeInTheDocument();
  });
});
```

useStreamingChat 侧在 `useStreamingChat.approvals.test.ts` 风格上补一用例：`file_changed` envelope → `onFileChanged` 收到 `{ toolCallId, toolName, payload }`。

- [ ] **Step 2: 运行确认失败** → `pnpm --filter @marginalia/desktop test -- TurnSummary`

- [ ] **Step 3: 实现**

`TurnSummary`：`FileDiff` 图标 + 汇总行按钮（`aria-expanded`）+ 展开列表（每项：mono 路径 + `+a`/`-d` + `<DiffView patch/>`），容器 `rounded-lg border border-soft bg-surface px-3 py-2`。i18n `turnSummary.changed`: en "Changed {n} files +{a} -{d}" / zh "修改了 {n} 个文件 +{a} -{d}"（组件 `.replace` 填充；`n===1` 不做单复数分支，保持简单）。hook 分流代码与 approval envelope 同模式。ChatView：`const [turnChanges, setTurnChanges] = useState<Map<string, TurnChange>>(new Map())`；`onFileChanged`/`onApprovalResolved(approved && payload.kind==="file_edit")` upsert；`onUserAppend` **不**清空（全会话聚合语义）；reopen effect 在 listApprovals 回调里同步初始化。传 `changes={[...turnChanges.values()]}` 给 MessageStream。

- [ ] **Step 4: 运行确认通过** → `pnpm --filter @marginalia/desktop test`（全量）

- [ ] **Step 5: 提交**

```bash
pnpm --filter @marginalia/desktop typecheck && pnpm lint && pnpm format:check
git add apps/desktop/src/chat apps/desktop/src/hooks apps/desktop/src/i18n/messages.ts
git commit -m "feat(desktop): session file-change summary with per-file diffs"
```

---

### Task 15: 截图场景 + 文档同步 + 视觉门

**Files:**

- Modify: `apps/pi-server/src/agent/scripted-fake-agent.ts`（新增脚本关键字）
- Modify: `apps/pi-server/test/scripted-fake-agent.test.ts`（新关键字用例）
- Modify: `apps/desktop/scripts/verify-screenshots.mjs`（`approval-flow` 场景改名扩容或新增 `message-stream` 场景——**新增独立场景**，同样 `env: { MARGINALIA_FAKE_AGENT: "1" }`，走既有 isolated pass 机制）
- Modify: `apps/desktop/scripts/verify-screenshots.test.ts`（场景表断言）
- Modify: `docs/user/guide.md`（消息操作/导出/目录/回合摘要小节）、`docs/developer/api.md`（`PUT files/content`、`file_changed` envelope、`auto` 状态、bash 文件副作用不产摘要的已知边界）、`docs/developer/development.md`（fake 关键字表更新）、`README.md`（特性行微调：导出与变更摘要）
- Test: 视觉门

**Interfaces:**

- scripted fake 新关键字：
  - `long-markdown` → 纯文本脚本改为长 Markdown 回复（含 4 个标题层级、python 代码块、表格、引用），驱动 TOC/代码块/排版截图；
  - `live-progress` → bash 工具：`tool_execution_start` → 3 个 `tool_execution_update`（累计输出 5/10/15 行）→ **不发 end**，直接 `message_end`（工具卡停留在 running+输出尾部态，稳定可截）；
  - `file-changes` → 两个直通 write/edit：各发 `file_changed` envelope（payload 含小 patch）+ 正常 end + 收尾文本（驱动 TurnSummary 截图；FakeAgentClient 对 `file_changed` 事件按普通事件直接 yield，无需暂停语义——确认 `AgentRunEvent` 联合已含它）。
- `message-stream` 场景 expected：`["long-answer-toc", "code-block-copy", "tool-expanded", "live-output", "thinking-collapsed", "turn-changes-summary", "scroll-pill"]`。
  - `scroll-pill` 拍法：`long-markdown` 回复完成后 `page.mouse.wheel(0, -600)` 向上滚，再发一条消息触发新内容 → 胶囊出现 → capture。
  - `thinking-collapsed`：`long-markdown` 脚本的 message 序列中加一个 thinking part 先行（`message_update` 携带含 thinking part 的 message）→ 完成后自然折叠。
- 文档要点（每处一段即可，风格随既有）：guide 加「消息操作」（复制/导出/存入+覆盖确认）与「变更摘要」小节；api.md 增 `PUT /workspaces/:id/files/content`（409 语义）与 `file_changed`/`auto`；development.md fake 关键字表加三行。

- [ ] **Step 1: scripted fake 扩展（TDD）**

新用例（追加到 scripted-fake-agent.test.ts）：

```ts
it("emits live progress updates without a tool end for live-progress prompts", async () => {
  const client = new ScriptedFakeAgentClient();
  const result = await client.run({ ...baseInput, message: "live-progress demo" });
  const types: string[] = [];
  for await (const event of result.events) types.push((event as { type?: string }).type ?? "");
  expect(types.filter((t) => t === "tool_execution_update").length).toBeGreaterThanOrEqual(3);
  expect(types).not.toContain("tool_execution_end");
});

it("emits file_changed envelopes for file-changes prompts", async () => {
  const client = new ScriptedFakeAgentClient();
  const result = await client.run({ ...baseInput, message: "file-changes demo" });
  const types: string[] = [];
  for await (const event of result.events) types.push((event as { type?: string }).type ?? "");
  expect(types.filter((t) => t === "file_changed").length).toBe(2);
});
```

Run FAIL → 实现三个脚本函数（事件形状对齐 Task 13 的 `FileChangedEvent` 与 pi update 事件：`partialResult: { content: [{ type: "text", text }] }` 累计式）→ Run PASS。

- [ ] **Step 2: 场景与截图**

`message-stream` 场景注册（`default: true`、`env`、`run: scenarioMessageStream`）+ 场景函数（模式照 `scenarioApprovalFlow`：ensureSeededWorkspace → 自建 provider → 逐关键字发消息、等待标志文本、capture；`tool-expanded` 通过点击工具卡行展开后截）。`verify-screenshots.test.ts` 场景表与 env 断言同步。

Run: `pnpm --filter @marginalia/desktop run verify:screenshots -- --scenario message-stream`
Expected: 7 张截图生成，人工逐张核对与 spec 第 2 节意图一致。

- [ ] **Step 3: 文档同步**（按 Interfaces 列表逐处修改）

- [ ] **Step 4: 全门禁 + 视觉门**

```bash
pnpm --filter @marginalia/desktop typecheck && pnpm --filter @marginalia/pi-server typecheck
pnpm test && pnpm lint && pnpm format:check
pnpm verify:visual   # 新基线 --update-baseline --reason "P1-B message stream baseline"；每张 changed 逐一判断
```

注意：Task 3/5/6/7 会改动既有截图（工具卡样式、thinking 区消失、排版），`approval-flow` 与 `seeded-workspace` 的旧基线**预期出现 changed**——逐张核对后按意图 bless，不得盲批。

- [ ] **Step 5: 提交**

```bash
git add apps/pi-server/src/agent/scripted-fake-agent.ts apps/pi-server/test/scripted-fake-agent.test.ts \
  apps/desktop/scripts docs README.md apps/desktop/screenshots-baseline
git commit -m "feat(desktop): message-stream screenshot scenario + docs"
```

---

## 完成定义（Plan B 收口）

1. `pnpm test` / `typecheck` / `lint` / `format:check` 全绿；`pnpm verify:visual` 通过且新旧基线逐张人工判定。
2. 工具卡：折叠摘要分工具、点击展开完整参数/输出、bash 运行中实时输出尾部可见、审批/拒绝/过期与展开态共存。
3. thinking：流式在气泡内实时显示，结束折叠为一行；重开会话显示无秒数折叠态；顶部 transient 区不复存在。
4. 长文：≥3 标题的回答有目录且锚点可跳；排版行长受限、标题层级分明；代码块有语言标签与复制。
5. 导出闭环：复制全文、导出 .md（系统保存框）、存入 workspace（同名 409 → 覆盖确认）三路可用。
6. 滚动：向上滚动暂停跟随并出胶囊，点击或流式结束恢复。
7. 变更摘要：ask 批准、full 直通、新建文件三种路径的 edit/write 都进汇总条，展开见逐文件 diff；重开会话摘要仍在。
8. live 与重开渲染一致（thinking 降级形态、摘要聚合形态按任务内注明的规格）。

## Implementation Outcome

### 实际完成

本计划完成了 Task 1–11，并保留这些已交付能力：

- 工具摘要和完整结果辅助、`partialResult` 消费、可展开 ToolCard 与 bash 实时输出尾部。
- thinking 移入助手气泡并支持完成后折叠。
- 代码块语言标签与复制、长文排版、三项以上标题时的消息目录和锚点跳转。
- 助手消息复制全文、通过 Electron 保存 `.md`、写入 workspace，以及同名文件 409 后的覆盖确认。
- 保存对话框两张截图基线已加入 seeded-workspace 场景。

对应实现提交为 `7d34b8b`、`1eef5ec`、`23a98a0`、`8691f72`、`16783ad`、`90d982c`、`ffadd29`、`0cca020`、`2f23bf3`、`de018bc`、`85a6d8b`、`adacac2` 和 `1199645`。

### 未完成和取消内容

- Task 12 未实施：消息流仍在尾部内容变化时强制跟随，没有“用户上滚后暂停”和“回到底部”胶囊。
- Task 13 未实施：没有 `file_changed` envelope、`auto` 状态持久化或相应 server 测试。
- Task 14 未实施：没有 TurnSummary、逐文件 diff 汇总或重开还原。
- Task 15 未实施：没有 message-stream scripted scenario、七张目标截图、视觉基线裁决和完整正式文档同步。

这些工作转入 product readiness audit 的 `P1-MESSAGE-001`；本次 `outcome: cancelled` 表示原计划在部分交付后关闭，不撤销 Task 1–11 的实现，也不把 Task 12–15 伪记为完成。

### 与 source spec 的偏差

- 代码高亮保留现有 highlight.js，没有采用 spec 中倾向的 Shiki；这是计划开始前已记录的依赖取舍。
- 目录只解析助手消息的第一个 text part，多 text part 回答不会生成完整目录。
- 计划标题沿用了“P1-B”，但 source spec 已把 P1-B 用于并行会话 run-state 重构。历史标题保留，稳定 `record_id` 才是后续引用依据。
- source spec 预期的回合文件变更摘要没有落地。

### 验证证据

- 已完成部分由 tool-format、stream progress、ToolCard、ThinkingBlock、CodeBlock、Markdown、MessageToc、MessageActions、save-file IPC、files-write 和 SaveToWorkspaceDialog 测试覆盖。
- 2026-07-11 在提交 `1199645` 上复核：`pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm format:check` 和 `pnpm build` 通过；测试共 423 项，另有 1 项真实 MiniMax 测试跳过。
- 当前没有 message-stream 专用截图场景，不能声称完成本计划要求的视觉验收。

### 正式文档与遗留工作

- `de018bc` 已同步 `docs/developer/architecture.md` 的保存文件 IPC。
- `PUT /workspaces/:id/files/content` 已实现，但本计划要求的 API 文档、用户消息操作说明和开发 fake 关键字说明未同步。
- 可暂停滚动、文件变更事件、TurnSummary、API/用户文档和视觉场景必须作为新的当前 issue 继续跟踪。
