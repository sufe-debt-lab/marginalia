# P1-A 审批权限骨架 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 spec（`docs/superpowers/specs/2026-07-08-p1-chat-core-experience-design.md`）第 1 节的审批权限骨架：`ask` 档按副作用分级拦截 bash/edit/write，桌面端内联审批卡片（命令 + diff），审批持久化并在重开会话时按 toolCallId 还原终态。

**Architecture:** 审批网关分两层——与 pi 无关的 `ApprovalGateway`（策略判定 + pending 生命周期 + 决定回传）和 pi 对接层（`DefaultResourceLoader` 的 extensionFactory，`tool_call` 阻塞拦截）。审批事件与 pi 事件在 `AgentClient.run()` 内合流；SSE 层新增 `approval_requested` / `approval_resolved` 两类 envelope（与 `run_started`/`agent_event` 并列，**`agent_event` 保持纯 pi 透传**）。桌面端 ChatView 以 `toolCallId` 为键维护审批状态，ToolCard 内嵌审批卡片。

**Tech Stack:** pi-coding-agent 0.75.x（extension `tool_call` 阻塞 API、`DefaultResourceLoader`）、Hono SSE、better-sqlite3、`diff@8.0.4`（unified patch）、React 18 + Vitest + Testing Library。

## Global Constraints

- ESM 导入必须带 `.js` 扩展名（即使源文件是 `.ts`/`.tsx`）；desktop 跨目录导入用 `@/` 别名。
- desktop 所有用户可见文案走 `t()`，键同时加进 `src/i18n/messages.ts` 的 `en` 和 `zh`（zh 有 `satisfies` 检查）。
- **`agent_event` 必须保持纯 pi 透传**（CLAUDE.md chat 约定）；审批事件只能以新 envelope 类型并列出现，不得改写 pi 事件本体。
- 每个任务先写失败测试再实现（TDD）；提交前跑触达包的 `typecheck` + `test`，以及仓库级 `pnpm lint`、`pnpm format:check`。
- Conventional commits 带包 scope：`feat(pi-server): …` / `feat(desktop): …`。从 `main` 切分支（建议 `feat/approval-backbone`），不直接提交 `main`。
- 涉及 UI 的任务最终需 Electron 截图验证（`pnpm verify:screenshots`）+ 视觉回归门（`pnpm verify:visual`），新 UI 状态必须有 fixture 覆盖（本计划 Task 14）。
- 行为/API/边界变化需同步文档（Task 2 修 spec 附注，Task 14 修 concepts/api/guide）。

**已知偏差（相对 spec，写计划时实测发现）**：pi 的 `generateUnifiedPatch` / `applyEditsToNormalizedContent` 未从包根导出，deep import 被 exports map 拒绝（`ERR_PACKAGE_PATH_NOT_EXPORTED`）。本计划改用 pi 自身依赖的同款 `diff` 包生成 unified patch，edit 预览采用「精确匹配优先，失败则降级为 oldText→newText 近似 diff 并标注」。Task 2 会把这个偏差写回 spec。

**执行顺序**：Task 1 → Task 2 → **Task 4 → Task 3** → Task 5 → … → Task 14（Task 3 的类型 import 依赖 Task 4 在 `agent-client.ts` 定义的审批类型；Task 4 自身自足——其中给 `PiCodingAgentClient` 补的临时空实现保证 typecheck 通过，Task 6 会替换为真实现）。

**评审已核实的两个确定结论（照此执行，无需再验证）**：a) `DefaultResourceLoader` 源码中 `noExtensions` 只跳过磁盘扩展发现，`extensionFactories` 无条件加载——Task 6 的 `noExtensions: true + extensionFactories` 配置成立（Step 1 冒烟测试保留作回归护栏）；b) pi 的 `ExtensionFactory` 参数类型是重载的 `ExtensionAPI`，与本计划的简化 `PiExtensionApi` 结构兼容但名义类型不同，**传入 `extensionFactories` 时允许 `as unknown as ExtensionFactory` 转换**（或把 factory 参数直接标注为 pi 的 `ExtensionAPI` 类型）。

---

### Task 1: 审批策略纯函数（approval-policy）

**Files:**

- Create: `apps/pi-server/src/agent/approval-policy.ts`
- Test: `apps/pi-server/test/approval-policy.test.ts`

**Interfaces:**

- Consumes: `AgentPermission`（`./agent-client.js` 已有）。
- Produces:
  - `type ApprovalNeed = { kind: "command"; command: string } | { kind: "file_edit"; path: string; mode: "edit" | "write" }`
  - `evaluateToolCall(policy: PolicyInput): "allow" | ApprovalNeed`
  - `commandPrefix(command: string): string`
  - `type PolicyInput = { toolName: string; input: Record<string, unknown>; permission: AgentPermission; fileExists(path: string): boolean; isPrefixAllowed(prefix: string): boolean }`

- [ ] **Step 1: 写失败测试**

```ts
// apps/pi-server/test/approval-policy.test.ts
import { describe, expect, it } from "vitest";
import { commandPrefix, evaluateToolCall } from "../src/agent/approval-policy.js";

const base = {
  permission: "ask" as const,
  fileExists: () => true,
  isPrefixAllowed: () => false
};

describe("commandPrefix", () => {
  it("takes the first token lowercased", () => {
    expect(commandPrefix("  Git status")).toBe("git");
    expect(commandPrefix("")).toBe("");
  });
});

describe("evaluateToolCall", () => {
  it("allows everything under full and readonly", () => {
    for (const permission of ["full", "readonly"] as const) {
      expect(
        evaluateToolCall({ ...base, permission, toolName: "bash", input: { command: "rm -rf /" } })
      ).toBe("allow");
    }
  });

  it("allows read-only tools under ask", () => {
    for (const toolName of ["read", "grep", "find", "ls"]) {
      expect(evaluateToolCall({ ...base, toolName, input: {} })).toBe("allow");
    }
  });

  it("allows read-only bash commands, including compound ones", () => {
    expect(evaluateToolCall({ ...base, toolName: "bash", input: { command: "ls -la" } })).toBe(
      "allow"
    );
    expect(
      evaluateToolCall({
        ...base,
        toolName: "bash",
        input: { command: "cat a.md | grep foo && wc -l b.md" }
      })
    ).toBe("allow");
  });

  it("asks for non-readonly bash and for compound commands with any unsafe segment", () => {
    expect(
      evaluateToolCall({ ...base, toolName: "bash", input: { command: "python gen.py" } })
    ).toEqual({ kind: "command", command: "python gen.py" });
    expect(
      evaluateToolCall({ ...base, toolName: "bash", input: { command: "cat a.md && rm b.md" } })
    ).toEqual({ kind: "command", command: "cat a.md && rm b.md" });
  });

  it("asks when a read-only prefix redirects output to a file", () => {
    expect(
      evaluateToolCall({ ...base, toolName: "bash", input: { command: "echo hi > notes.md" } })
    ).toEqual({ kind: "command", command: "echo hi > notes.md" });
    expect(
      evaluateToolCall({ ...base, toolName: "bash", input: { command: "cat a.md >> b.md" } })
    ).toEqual({ kind: "command", command: "cat a.md >> b.md" });
  });

  it("honours the session prefix allowlist", () => {
    const policy = { ...base, isPrefixAllowed: (p: string) => p === "python" };
    expect(
      evaluateToolCall({ ...policy, toolName: "bash", input: { command: "python gen.py" } })
    ).toBe("allow");
  });

  it("asks for edit always, and for write only when the file exists", () => {
    expect(evaluateToolCall({ ...base, toolName: "edit", input: { path: "a.md" } })).toEqual({
      kind: "file_edit",
      path: "a.md",
      mode: "edit"
    });
    expect(evaluateToolCall({ ...base, toolName: "write", input: { path: "a.md" } })).toEqual({
      kind: "file_edit",
      path: "a.md",
      mode: "write"
    });
    expect(
      evaluateToolCall({
        ...base,
        fileExists: () => false,
        toolName: "write",
        input: { path: "new.md" }
      })
    ).toBe("allow");
  });

  it("asks conservatively for unknown tools", () => {
    const result = evaluateToolCall({ ...base, toolName: "mystery", input: { a: 1 } });
    expect(result).not.toBe("allow");
  });

  it("treats an empty bash command as needing approval", () => {
    expect(evaluateToolCall({ ...base, toolName: "bash", input: {} })).toEqual({
      kind: "command",
      command: ""
    });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @marginalia/pi-server test -- approval-policy`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
// apps/pi-server/src/agent/approval-policy.ts
import type { AgentPermission } from "./agent-client.js";

export type ApprovalNeed =
  | { kind: "command"; command: string }
  | { kind: "file_edit"; path: string; mode: "edit" | "write" };

export type PolicyInput = {
  toolName: string;
  input: Record<string, unknown>;
  permission: AgentPermission;
  fileExists(path: string): boolean;
  isPrefixAllowed(prefix: string): boolean;
};

/** Read-only builtin tools that never need approval. */
const READONLY_TOOL_NAMES = new Set(["read", "grep", "find", "ls"]);

/** Conservative allowlist of side-effect-free command prefixes. */
const READONLY_COMMAND_PREFIXES = new Set([
  "ls",
  "cat",
  "grep",
  "rg",
  "head",
  "tail",
  "wc",
  "find",
  "pwd",
  "stat",
  "file",
  "du",
  "df",
  "which",
  "echo"
]);

export function commandPrefix(command: string): string {
  return command.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
}

/** Split a compound command on newlines, pipes, `&&`, `||`, `;`. */
function commandSegments(command: string): string[] {
  return command
    .split(/\n|&&|\|\||;|\|/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function evaluateToolCall(policy: PolicyInput): "allow" | ApprovalNeed {
  if (policy.permission !== "ask") return "allow";
  const { toolName, input } = policy;
  if (READONLY_TOOL_NAMES.has(toolName)) return "allow";

  if (toolName === "bash") {
    const command = typeof input.command === "string" ? input.command : "";
    const segments = commandSegments(command);
    const allSafe =
      segments.length > 0 &&
      segments.every((segment) => {
        // Output redirection turns a read-only command into a write
        // (`echo x > file`) — always require approval.
        if (segment.includes(">")) return false;
        const prefix = commandPrefix(segment);
        return READONLY_COMMAND_PREFIXES.has(prefix) || policy.isPrefixAllowed(prefix);
      });
    return allSafe ? "allow" : { kind: "command", command };
  }

  if (toolName === "edit") {
    const path = typeof input.path === "string" ? input.path : "";
    return { kind: "file_edit", path, mode: "edit" };
  }

  if (toolName === "write") {
    const path = typeof input.path === "string" ? input.path : "";
    return policy.fileExists(path) ? { kind: "file_edit", path, mode: "write" } : "allow";
  }

  // Conservative fallback: unknown tools are shown as a command-style approval.
  return { kind: "command", command: `${toolName} ${JSON.stringify(input)}` };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @marginalia/pi-server test -- approval-policy`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
pnpm --filter @marginalia/pi-server typecheck && pnpm lint && pnpm format:check
git add apps/pi-server/src/agent/approval-policy.ts apps/pi-server/test/approval-policy.test.ts
git commit -m "feat(pi-server): side-effect approval policy for ask permission"
```

---

### Task 2: diff 预览（diff-preview）+ spec 偏差修订

**Files:**

- Modify: `apps/pi-server/package.json`（新增依赖 `diff@8.0.4`）
- Create: `apps/pi-server/src/agent/diff-preview.ts`
- Test: `apps/pi-server/test/diff-preview.test.ts`
- Modify: `docs/superpowers/specs/2026-07-08-p1-chat-core-experience-design.md`（子设计第 4 条附注）

**Interfaces:**

- Consumes: `resolveWorkspacePath(rootDir, relativePath)`（`../files/path-sandbox.js` 已有，路径越界会 throw `Path escapes workspace`）。
- Produces:
  - `type DiffPreview = { patch: string; additions: number; deletions: number; exact: boolean; error?: string }`
  - `previewWrite(workspaceRoot: string, relPath: string, newContent: string): DiffPreview`
  - `previewEdit(workspaceRoot: string, relPath: string, oldText: string, newText: string): DiffPreview`

- [ ] **Step 1: 安装依赖**

Run: `pnpm --filter @marginalia/pi-server add diff@8.0.4`
（`diff` v8 自带 TS 类型，无需 `@types/diff`。）

- [ ] **Step 2: 写失败测试**

```ts
// apps/pi-server/test/diff-preview.test.ts
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { previewEdit, previewWrite } from "../src/agent/diff-preview.js";

function tempWorkspace(): string {
  return mkdtempSync(path.join(os.tmpdir(), "diff-preview-"));
}

describe("previewWrite", () => {
  it("diffs against the existing file with Chinese content", () => {
    const root = tempWorkspace();
    writeFileSync(path.join(root, "报告.md"), "第一行\n第二行\n");
    const preview = previewWrite(root, "报告.md", "第一行\n改写的第二行\n");
    expect(preview.exact).toBe(true);
    expect(preview.additions).toBe(1);
    expect(preview.deletions).toBe(1);
    expect(preview.patch).toContain("+改写的第二行");
  });

  it("treats a missing file as new-file diff", () => {
    const root = tempWorkspace();
    const preview = previewWrite(root, "new.md", "hello\n");
    expect(preview.exact).toBe(true);
    expect(preview.additions).toBe(1);
    expect(preview.deletions).toBe(0);
  });

  it("reports an error for a path escaping the workspace", () => {
    const root = tempWorkspace();
    const preview = previewWrite(root, "../outside.md", "x");
    expect(preview.error).toBeTruthy();
    expect(preview.patch).toBe("");
  });
});

describe("previewEdit", () => {
  it("produces an exact diff when oldText matches", () => {
    const root = tempWorkspace();
    writeFileSync(path.join(root, "a.md"), "alpha\nbeta\ngamma\n");
    const preview = previewEdit(root, "a.md", "beta", "BETA");
    expect(preview.exact).toBe(true);
    expect(preview.patch).toContain("-beta");
    expect(preview.patch).toContain("+BETA");
  });

  it("falls back to oldText→newText approximate diff when no exact match", () => {
    const root = tempWorkspace();
    writeFileSync(path.join(root, "a.md"), "alpha\n");
    const preview = previewEdit(root, "a.md", "not-in-file", "replacement");
    expect(preview.exact).toBe(false);
    expect(preview.patch).toContain("-not-in-file");
    expect(preview.patch).toContain("+replacement");
  });

  it("handles an empty file", () => {
    const root = tempWorkspace();
    writeFileSync(path.join(root, "empty.md"), "");
    const preview = previewEdit(root, "empty.md", "x", "y");
    expect(preview.exact).toBe(false);
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm --filter @marginalia/pi-server test -- diff-preview`
Expected: FAIL（模块不存在）

- [ ] **Step 4: 实现**

```ts
// apps/pi-server/src/agent/diff-preview.ts
import { existsSync, readFileSync } from "node:fs";
import { createTwoFilesPatch } from "diff";
import { resolveWorkspacePath } from "../files/path-sandbox.js";

export type DiffPreview = {
  patch: string;
  additions: number;
  deletions: number;
  exact: boolean;
  error?: string;
};

function countChanges(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return { additions, deletions };
}

function buildPatch(
  relPath: string,
  oldContent: string,
  newContent: string,
  exact: boolean
): DiffPreview {
  const patch = createTwoFilesPatch(relPath, relPath, oldContent, newContent, "", "", {
    context: 3
  });
  return { patch, ...countChanges(patch), exact };
}

function failed(error: string): DiffPreview {
  return { patch: "", additions: 0, deletions: 0, exact: false, error };
}

export function previewWrite(
  workspaceRoot: string,
  relPath: string,
  newContent: string
): DiffPreview {
  try {
    const absolute = resolveWorkspacePath(workspaceRoot, relPath);
    const oldContent = existsSync(absolute) ? readFileSync(absolute, "utf8") : "";
    return buildPatch(relPath, oldContent, newContent, true);
  } catch (error) {
    return failed((error as Error).message);
  }
}

export function previewEdit(
  workspaceRoot: string,
  relPath: string,
  oldText: string,
  newText: string
): DiffPreview {
  try {
    const absolute = resolveWorkspacePath(workspaceRoot, relPath);
    const content = existsSync(absolute) ? readFileSync(absolute, "utf8") : "";
    const index = content.indexOf(oldText);
    if (oldText && index >= 0) {
      const next = content.slice(0, index) + newText + content.slice(index + oldText.length);
      return buildPatch(relPath, content, next, true);
    }
    // Approximate preview: pi's edit tool applies fuzzy matching we cannot
    // replicate (its helpers are not exported); show oldText→newText instead.
    return { ...buildPatch(relPath, oldText, newText, false), exact: false };
  } catch (error) {
    return failed((error as Error).message);
  }
}
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @marginalia/pi-server test -- diff-preview`
Expected: PASS

- [ ] **Step 6: 修订 spec 附注**

在 spec「审批数据流子设计」第 4 条末尾追加一句：

> 实测 `generateUnifiedPatch` / `applyEditsToNormalizedContent` 未从 pi 包根导出（exports map 拒绝 deep import），实现改用 pi 同款 `diff` 包生成 patch；edit 预览精确匹配优先，失败降级为 oldText→newText 近似 diff 并在卡片上标注「近似预览」。

- [ ] **Step 7: 提交**

```bash
pnpm --filter @marginalia/pi-server typecheck && pnpm lint && pnpm format:check
git add apps/pi-server/package.json pnpm-lock.yaml apps/pi-server/src/agent/diff-preview.ts \
  apps/pi-server/test/diff-preview.test.ts docs/superpowers/specs/2026-07-08-p1-chat-core-experience-design.md
git commit -m "feat(pi-server): diff preview for approval cards via diff package"
```

---

### Task 3: 审批网关（ApprovalGateway）

**Files:**

- Create: `apps/pi-server/src/agent/approval-gateway.ts`
- Test: `apps/pi-server/test/approval-gateway.test.ts`

**Interfaces:**

- Consumes: `evaluateToolCall` / `commandPrefix` / `ApprovalNeed`（Task 1）；`ApprovalDecision` / `ApprovalEvent` / `ApprovalPayload`（**来自 `./agent-client.js`，由 Task 4 定义——执行顺序为 Task 1 → Task 2 → Task 4 → Task 3，本任务开始时这些类型已存在**）。
- Produces:
  - `class ApprovalGateway`：
    - `setPolicy(sessionId: string, policy: { permission: AgentPermission; workspaceRoot: string }): void`
    - `policyFor(sessionId: string): { permission: AgentPermission; workspaceRoot: string } | null`
    - `evaluate(sessionId: string, toolName: string, input: Record<string, unknown>): "allow" | ApprovalNeed`
    - `request(sessionId: string, req: { toolCallId: string; toolName: string; payload: ApprovalPayload }): Promise<ApprovalDecision>`（注册 pending 并向监听者发 `approval_requested`；返回的 promise 在 resolve/cancel 时兑现）
    - `resolve(approvalId: string, decision: ApprovalDecision): boolean`
    - `cancelPending(sessionId: string): number`（全部按拒绝兑现并发 `approval_resolved`+`expired: true`）
    - `onEvent(sessionId: string, listener: (e: ApprovalEvent) => void): () => void`
  - 构造参数 `{ fileExists?: (absPath: string) => boolean }`（默认 `node:fs` `existsSync`，测试可注入）。

- [ ] **Step 1: 写失败测试**

```ts
// apps/pi-server/test/approval-gateway.test.ts
import { describe, expect, it } from "vitest";
import { ApprovalGateway } from "../src/agent/approval-gateway.js";
import type { ApprovalEvent } from "../src/agent/agent-client.js";

function gateway(fileExists = () => true) {
  const g = new ApprovalGateway({ fileExists });
  g.setPolicy("s1", { permission: "ask", workspaceRoot: "/ws" });
  return g;
}

describe("ApprovalGateway", () => {
  it("evaluates using the session policy and injected fileExists", () => {
    const g = gateway(() => false);
    expect(g.evaluate("s1", "write", { path: "new.md" })).toBe("allow");
    expect(g.evaluate("s1", "edit", { path: "a.md" })).toEqual({
      kind: "file_edit",
      path: "a.md",
      mode: "edit"
    });
    // Unknown session defaults to allow (no policy registered → not "ask").
    expect(g.evaluate("nope", "edit", { path: "a.md" })).toBe("allow");
  });

  it("emits approval_requested and resolves the pending promise on approve", async () => {
    const g = gateway();
    const events: ApprovalEvent[] = [];
    g.onEvent("s1", (e) => events.push(e));

    const promise = g.request("s1", {
      toolCallId: "t1",
      toolName: "bash",
      payload: { kind: "command", command: "python x.py", cwd: "/ws" }
    });
    expect(events[0]?.type).toBe("approval_requested");
    const approvalId = (events[0] as { approvalId: string }).approvalId;

    expect(g.resolve(approvalId, { approved: true })).toBe(true);
    await expect(promise).resolves.toEqual({ approved: true });
    expect(events[1]).toMatchObject({ type: "approval_resolved", approved: true });
    // Second resolve is a no-op.
    expect(g.resolve(approvalId, { approved: false })).toBe(false);
  });

  it("adds the command prefix to the session allowlist on alwaysAllowPrefix", async () => {
    const g = gateway();
    g.onEvent("s1", () => {});
    const promise = g.request("s1", {
      toolCallId: "t1",
      toolName: "bash",
      payload: { kind: "command", command: "python x.py", cwd: "/ws" }
    });
    const pendingId = g.pendingIds("s1")[0]!;
    g.resolve(pendingId, { approved: true, alwaysAllowPrefix: true });
    await promise;
    expect(g.evaluate("s1", "bash", { command: "python other.py" })).toBe("allow");
  });

  it("cancelPending denies all pending approvals with expired flag", async () => {
    const g = gateway();
    const events: ApprovalEvent[] = [];
    g.onEvent("s1", (e) => events.push(e));
    const p1 = g.request("s1", {
      toolCallId: "t1",
      toolName: "bash",
      payload: { kind: "command", command: "python x.py", cwd: "/ws" }
    });
    expect(g.cancelPending("s1")).toBe(1);
    await expect(p1).resolves.toMatchObject({ approved: false });
    const resolved = events.find((e) => e.type === "approval_resolved");
    expect(resolved).toMatchObject({ approved: false, expired: true });
  });

  it("unsubscribes listeners", () => {
    const g = gateway();
    const events: ApprovalEvent[] = [];
    const off = g.onEvent("s1", (e) => events.push(e));
    off();
    void g.request("s1", {
      toolCallId: "t1",
      toolName: "bash",
      payload: { kind: "command", command: "python x.py", cwd: "/ws" }
    });
    expect(events).toHaveLength(0);
    g.cancelPending("s1");
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @marginalia/pi-server test -- approval-gateway`
Expected: FAIL（模块/类型不存在。若报 `agent-client.js` 缺类型，先完成 Task 4 Step 3 再回来。）

- [ ] **Step 3: 实现**

```ts
// apps/pi-server/src/agent/approval-gateway.ts
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import type {
  AgentPermission,
  ApprovalDecision,
  ApprovalEvent,
  ApprovalPayload
} from "./agent-client.js";
import { commandPrefix, evaluateToolCall, type ApprovalNeed } from "./approval-policy.js";

type SessionPolicy = { permission: AgentPermission; workspaceRoot: string };

type Pending = {
  approvalId: string;
  sessionId: string;
  toolCallId: string;
  resolve(decision: ApprovalDecision): void;
  payload: ApprovalPayload;
};

export class ApprovalGateway {
  private readonly fileExists: (absPath: string) => boolean;
  private readonly policies = new Map<string, SessionPolicy>();
  private readonly allowedPrefixes = new Map<string, Set<string>>();
  private readonly pending = new Map<string, Pending>();
  private readonly listeners = new Map<string, Set<(e: ApprovalEvent) => void>>();

  constructor(deps: { fileExists?: (absPath: string) => boolean } = {}) {
    this.fileExists = deps.fileExists ?? existsSync;
  }

  setPolicy(sessionId: string, policy: SessionPolicy): void {
    this.policies.set(sessionId, policy);
  }

  policyFor(sessionId: string): SessionPolicy | null {
    return this.policies.get(sessionId) ?? null;
  }

  evaluate(
    sessionId: string,
    toolName: string,
    input: Record<string, unknown>
  ): "allow" | ApprovalNeed {
    const policy = this.policies.get(sessionId);
    if (!policy) return "allow";
    const prefixes = this.allowedPrefixes.get(sessionId);
    return evaluateToolCall({
      toolName,
      input,
      permission: policy.permission,
      fileExists: (rel) => this.fileExists(path.resolve(policy.workspaceRoot, rel)),
      isPrefixAllowed: (prefix) => prefixes?.has(prefix) ?? false
    });
  }

  request(
    sessionId: string,
    req: { toolCallId: string; toolName: string; payload: ApprovalPayload }
  ): Promise<ApprovalDecision> {
    const approvalId = randomUUID();
    return new Promise<ApprovalDecision>((resolve) => {
      this.pending.set(approvalId, {
        approvalId,
        sessionId,
        toolCallId: req.toolCallId,
        resolve,
        payload: req.payload
      });
      this.emit(sessionId, {
        type: "approval_requested",
        approvalId,
        sessionId,
        toolCallId: req.toolCallId,
        toolName: req.toolName,
        payload: req.payload
      });
    });
  }

  resolve(approvalId: string, decision: ApprovalDecision): boolean {
    const entry = this.pending.get(approvalId);
    if (!entry) return false;
    this.pending.delete(approvalId);
    if (decision.approved && decision.alwaysAllowPrefix && entry.payload.kind === "command") {
      const set = this.allowedPrefixes.get(entry.sessionId) ?? new Set<string>();
      set.add(commandPrefix(entry.payload.command));
      this.allowedPrefixes.set(entry.sessionId, set);
    }
    entry.resolve({ approved: decision.approved, reason: decision.reason });
    this.emit(entry.sessionId, {
      type: "approval_resolved",
      approvalId,
      sessionId: entry.sessionId,
      toolCallId: entry.toolCallId,
      approved: decision.approved,
      reason: decision.reason
    });
    return true;
  }

  cancelPending(sessionId: string): number {
    let count = 0;
    for (const [approvalId, entry] of [...this.pending]) {
      if (entry.sessionId !== sessionId) continue;
      this.pending.delete(approvalId);
      entry.resolve({ approved: false });
      this.emit(sessionId, {
        type: "approval_resolved",
        approvalId,
        sessionId,
        toolCallId: entry.toolCallId,
        approved: false,
        expired: true
      });
      count += 1;
    }
    return count;
  }

  /** Visible for tests. */
  pendingIds(sessionId: string): string[] {
    return [...this.pending.values()]
      .filter((p) => p.sessionId === sessionId)
      .map((p) => p.approvalId);
  }

  onEvent(sessionId: string, listener: (e: ApprovalEvent) => void): () => void {
    const set = this.listeners.get(sessionId) ?? new Set();
    set.add(listener);
    this.listeners.set(sessionId, set);
    return () => set.delete(listener);
  }

  private emit(sessionId: string, event: ApprovalEvent): void {
    for (const listener of this.listeners.get(sessionId) ?? []) listener(event);
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @marginalia/pi-server test -- approval-gateway`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
pnpm --filter @marginalia/pi-server typecheck && pnpm lint && pnpm format:check
git add apps/pi-server/src/agent/approval-gateway.ts apps/pi-server/test/approval-gateway.test.ts
git commit -m "feat(pi-server): approval gateway with pending lifecycle and session prefix allowlist"
```

---

### Task 4: AgentClient 接口扩展 + FakeAgentClient 可编程审批

**Files:**

- Modify: `apps/pi-server/src/agent/agent-client.ts`
- Modify: `apps/pi-server/src/agent/fake-agent-client.ts`
- Test: `apps/pi-server/test/fake-agent-client.test.ts`

**Interfaces:**

- Produces（后续所有任务都依赖这些确切名字）:
  - `type ApprovalDecision = { approved: boolean; reason?: string; alwaysAllowPrefix?: boolean }`
  - `type ApprovalPayload = { kind: "command"; command: string; cwd: string } | { kind: "file_edit"; path: string; mode: "edit" | "write"; patch: string; additions: number; deletions: number; exact: boolean; error?: string }`
  - `type ApprovalRequestedEvent = { type: "approval_requested"; approvalId: string; sessionId: string; toolCallId: string; toolName: string; payload: ApprovalPayload }`
  - `type ApprovalResolvedEvent = { type: "approval_resolved"; approvalId: string; sessionId: string; toolCallId: string; approved: boolean; reason?: string; expired?: boolean }`
  - `type ApprovalEvent = ApprovalRequestedEvent | ApprovalResolvedEvent`
  - `type AgentRunEvent = AgentSessionEvent | ApprovalEvent`
  - `AgentRunResult.events: AsyncIterable<AgentRunEvent>`
  - `interface AgentClient { run(...): Promise<AgentRunResult>; resolveApproval(sessionId: string, approvalId: string, decision: ApprovalDecision): boolean; cancelPending(sessionId: string): number }`

- [ ] **Step 1: 写失败测试**

```ts
// apps/pi-server/test/fake-agent-client.test.ts
import { describe, expect, it } from "vitest";
import { FakeAgentClient } from "../src/agent/fake-agent-client.js";
import type { AgentRunEvent, ApprovalRequestedEvent } from "../src/agent/agent-client.js";

const approvalEvent: ApprovalRequestedEvent = {
  type: "approval_requested",
  approvalId: "ap-1",
  sessionId: "s1",
  toolCallId: "t1",
  toolName: "bash",
  payload: { kind: "command", command: "python x.py", cwd: "/ws" }
};

const baseInput = {
  sessionId: "s1",
  workspaceRoot: "/ws",
  piProviderId: "openai",
  modelId: "gpt",
  message: "hi"
};

describe("FakeAgentClient approvals", () => {
  it("pauses the stream at approval_requested until resolveApproval, then emits approval_resolved", async () => {
    const fake = new FakeAgentClient();
    fake.enqueueEvents([
      {
        type: "message_start",
        message: { role: "assistant", content: [] }
      } as unknown as AgentRunEvent,
      approvalEvent,
      {
        type: "message_end",
        message: { role: "assistant", content: [] }
      } as unknown as AgentRunEvent
    ]);
    const result = await fake.run(baseInput);
    const iterator = result.events[Symbol.asyncIterator]();

    expect((await iterator.next()).value).toMatchObject({ type: "message_start" });
    expect((await iterator.next()).value).toMatchObject({ type: "approval_requested" });

    // The stream must not advance while pending.
    let advanced = false;
    const nextPromise = iterator.next().then((r) => {
      advanced = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(advanced).toBe(false);

    expect(fake.resolveApproval("s1", "ap-1", { approved: true })).toBe(true);
    expect((await nextPromise).value).toMatchObject({ type: "approval_resolved", approved: true });
    expect((await iterator.next()).value).toMatchObject({ type: "message_end" });
    expect((await iterator.next()).done).toBe(true);
  });

  it("cancelPending denies outstanding approvals", async () => {
    const fake = new FakeAgentClient();
    fake.enqueueEvents([approvalEvent]);
    const result = await fake.run(baseInput);
    const iterator = result.events[Symbol.asyncIterator]();
    await iterator.next(); // approval_requested
    const pending = iterator.next();
    expect(fake.cancelPending("s1")).toBe(1);
    expect((await pending).value).toMatchObject({
      type: "approval_resolved",
      approved: false,
      expired: true
    });
  });

  it("resolveApproval returns false for unknown ids", () => {
    const fake = new FakeAgentClient();
    expect(fake.resolveApproval("s1", "nope", { approved: true })).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @marginalia/pi-server test -- fake-agent-client`
Expected: FAIL（类型与方法不存在）

- [ ] **Step 3: 实现类型扩展（agent-client.ts）**

在 `apps/pi-server/src/agent/agent-client.ts` 末尾追加（并把 `AgentRunResult.events` 的元素类型从 `AgentSessionEvent` 改为 `AgentRunEvent`，接口 `AgentClient` 增加两个方法）：

```ts
/** Decision sent back from the UI for one pending approval. */
export type ApprovalDecision = { approved: boolean; reason?: string; alwaysAllowPrefix?: boolean };

export type ApprovalPayload =
  | { kind: "command"; command: string; cwd: string }
  | {
      kind: "file_edit";
      path: string;
      mode: "edit" | "write";
      patch: string;
      additions: number;
      deletions: number;
      exact: boolean;
      error?: string;
    };

export type ApprovalRequestedEvent = {
  type: "approval_requested";
  approvalId: string;
  sessionId: string;
  toolCallId: string;
  toolName: string;
  payload: ApprovalPayload;
};

export type ApprovalResolvedEvent = {
  type: "approval_resolved";
  approvalId: string;
  sessionId: string;
  toolCallId: string;
  approved: boolean;
  reason?: string;
  expired?: boolean;
};

export type ApprovalEvent = ApprovalRequestedEvent | ApprovalResolvedEvent;

/** Marginalia run-envelope event stream: raw pi events plus approval envelope events. */
export type AgentRunEvent = AgentSessionEvent | ApprovalEvent;
```

```ts
export type AgentRunResult = {
  sessionFile: string;
  events: AsyncIterable<AgentRunEvent>;
  dispose(): void;
};

export interface AgentClient {
  run(input: AgentRunInput): Promise<AgentRunResult>;
  /** Resolve one pending approval; false when the id is unknown/already resolved. */
  resolveApproval(sessionId: string, approvalId: string, decision: ApprovalDecision): boolean;
  /** Deny every pending approval for the session (disconnect/exit safety). Returns count. */
  cancelPending(sessionId: string): number;
}
```

- [ ] **Step 4: 实现 FakeAgentClient**

```ts
// apps/pi-server/src/agent/fake-agent-client.ts
import type {
  AgentClient,
  AgentRunEvent,
  AgentRunInput,
  AgentRunResult,
  ApprovalDecision,
  ApprovalRequestedEvent,
  ApprovalResolvedEvent
} from "./agent-client.js";

/**
 * Returns canned events for tests. When an enqueued event is an
 * approval_requested, the stream pauses until resolveApproval/cancelPending,
 * then emits the matching approval_resolved before continuing.
 */
export class FakeAgentClient implements AgentClient {
  private nextEvents: AgentRunEvent[] = [];
  private pending = new Map<
    string,
    {
      sessionId: string;
      toolCallId: string;
      resolve(d: ApprovalDecision & { expired?: boolean }): void;
    }
  >();

  enqueueEvents(events: AgentRunEvent[]) {
    this.nextEvents = events;
  }

  resolveApproval(_sessionId: string, approvalId: string, decision: ApprovalDecision): boolean {
    const entry = this.pending.get(approvalId);
    if (!entry) return false;
    this.pending.delete(approvalId);
    entry.resolve(decision);
    return true;
  }

  cancelPending(sessionId: string): number {
    let count = 0;
    for (const [id, entry] of [...this.pending]) {
      if (entry.sessionId !== sessionId) continue;
      this.pending.delete(id);
      entry.resolve({ approved: false, expired: true });
      count += 1;
    }
    return count;
  }

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const events = this.nextEvents.slice();
    this.nextEvents = [];
    const pending = this.pending;
    async function* iterate(): AsyncGenerator<AgentRunEvent> {
      for (const event of events) {
        yield event;
        if ((event as { type?: string }).type === "approval_requested") {
          const req = event as ApprovalRequestedEvent;
          const decision = await new Promise<ApprovalDecision & { expired?: boolean }>((resolve) =>
            pending.set(req.approvalId, {
              sessionId: req.sessionId,
              toolCallId: req.toolCallId,
              resolve
            })
          );
          const resolved: ApprovalResolvedEvent = {
            type: "approval_resolved",
            approvalId: req.approvalId,
            sessionId: req.sessionId,
            toolCallId: req.toolCallId,
            approved: decision.approved,
            reason: decision.reason,
            expired: decision.expired
          };
          yield resolved;
        }
      }
    }
    return {
      sessionFile: `/tmp/fake/${input.sessionId}.jsonl`,
      events: iterate(),
      dispose() {}
    };
  }
}
```

同时给 `PiCodingAgentClient` 补上接口新增的两个方法的**临时空实现**（Task 6 会替换为真实现），保证 typecheck 通过：`resolveApproval() { return false; }`、`cancelPending() { return 0; }`。

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @marginalia/pi-server test -- fake-agent-client` 以及 `pnpm --filter @marginalia/pi-server test`（全量，确认没破坏既有用例）
Expected: PASS

- [ ] **Step 6: 提交**

```bash
pnpm --filter @marginalia/pi-server typecheck && pnpm lint && pnpm format:check
git add apps/pi-server/src/agent/agent-client.ts apps/pi-server/src/agent/fake-agent-client.ts \
  apps/pi-server/src/agent/pi-coding-agent-client.ts apps/pi-server/test/fake-agent-client.test.ts
git commit -m "feat(pi-server): approval envelope types on AgentClient + programmable fake approvals"
```

---

### Task 5: pi 对接扩展（approval-extension）

**Files:**

- Create: `apps/pi-server/src/agent/approval-extension.ts`
- Test: `apps/pi-server/test/approval-extension.test.ts`

**Interfaces:**

- Consumes: `ApprovalGateway`（Task 3）、`previewEdit`/`previewWrite`（Task 2）、`ApprovalPayload`（Task 4）。
- Produces:
  - `createApprovalExtension(gateway: ApprovalGateway, sessionId: string): (pi: PiExtensionApi) => void`
  - `type PiExtensionApi = { on(type: "tool_call", handler: (event: { toolName: string; toolCallId: string; input: Record<string, unknown> }, ctx: unknown) => Promise<{ block: boolean; reason?: string } | undefined>): void }`

- [ ] **Step 1: 写失败测试**

```ts
// apps/pi-server/test/approval-extension.test.ts
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ApprovalGateway } from "../src/agent/approval-gateway.js";
import { createApprovalExtension, type PiExtensionApi } from "../src/agent/approval-extension.js";

type ToolCallHandler = (
  event: { toolName: string; toolCallId: string; input: Record<string, unknown> },
  ctx: unknown
) => Promise<{ block: boolean; reason?: string } | undefined>;

function register(gateway: ApprovalGateway, sessionId: string): ToolCallHandler {
  let handler: ToolCallHandler | null = null;
  const pi: PiExtensionApi = {
    on(type, h) {
      if (type === "tool_call") handler = h;
    }
  };
  createApprovalExtension(gateway, sessionId)(pi);
  if (!handler) throw new Error("tool_call handler not registered");
  return handler;
}

describe("createApprovalExtension", () => {
  it("lets safe calls through without pending approvals", async () => {
    const gateway = new ApprovalGateway({ fileExists: () => false });
    gateway.setPolicy("s1", { permission: "ask", workspaceRoot: "/ws" });
    const handler = register(gateway, "s1");
    const result = await handler(
      { toolName: "read", toolCallId: "t1", input: { path: "a.md" } },
      {}
    );
    expect(result).toBeUndefined();
    expect(gateway.pendingIds("s1")).toHaveLength(0);
  });

  it("blocks a denied command with the user reason", async () => {
    const gateway = new ApprovalGateway({ fileExists: () => true });
    gateway.setPolicy("s1", { permission: "ask", workspaceRoot: "/ws" });
    const handler = register(gateway, "s1");
    const resultPromise = handler(
      { toolName: "bash", toolCallId: "t1", input: { command: "python x.py" } },
      {}
    );
    // Wait for the pending approval to register, then deny with a reason.
    await new Promise((r) => setTimeout(r, 0));
    const id = gateway.pendingIds("s1")[0]!;
    gateway.resolve(id, { approved: false, reason: "改用只读方式" });
    const result = await resultPromise;
    expect(result).toMatchObject({ block: true });
    expect(result?.reason).toContain("改用只读方式");
  });

  it("returns undefined when approved and builds a file_edit payload with a real diff", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "approval-ext-"));
    writeFileSync(path.join(root, "a.md"), "old line\n");
    const gateway = new ApprovalGateway();
    gateway.setPolicy("s1", { permission: "ask", workspaceRoot: root });
    const events: unknown[] = [];
    gateway.onEvent("s1", (e) => events.push(e));
    const handler = register(gateway, "s1");
    const resultPromise = handler(
      {
        toolName: "edit",
        toolCallId: "t2",
        input: { path: "a.md", oldText: "old line", newText: "new line" }
      },
      {}
    );
    await new Promise((r) => setTimeout(r, 0));
    const requested = events[0] as { payload: { kind: string; patch: string } };
    expect(requested.payload.kind).toBe("file_edit");
    expect(requested.payload.patch).toContain("+new line");
    gateway.resolve(gateway.pendingIds("s1")[0]!, { approved: true });
    expect(await resultPromise).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @marginalia/pi-server test -- approval-extension`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
// apps/pi-server/src/agent/approval-extension.ts
import type { ApprovalPayload } from "./agent-client.js";
import type { ApprovalGateway } from "./approval-gateway.js";
import type { ApprovalNeed } from "./approval-policy.js";
import { previewEdit, previewWrite } from "./diff-preview.js";

export type PiExtensionApi = {
  on(
    type: "tool_call",
    handler: (
      event: { toolName: string; toolCallId: string; input: Record<string, unknown> },
      ctx: unknown
    ) => Promise<{ block: boolean; reason?: string } | undefined>
  ): void;
};

function buildPayload(
  need: ApprovalNeed,
  input: Record<string, unknown>,
  workspaceRoot: string
): ApprovalPayload {
  if (need.kind === "command") {
    return { kind: "command", command: need.command, cwd: workspaceRoot };
  }
  if (need.mode === "edit") {
    const preview = previewEdit(
      workspaceRoot,
      need.path,
      String(input.oldText ?? ""),
      String(input.newText ?? "")
    );
    return { kind: "file_edit", path: need.path, mode: "edit", ...preview };
  }
  const preview = previewWrite(workspaceRoot, need.path, String(input.content ?? ""));
  return { kind: "file_edit", path: need.path, mode: "write", ...preview };
}

/**
 * pi extension factory: blocks side-effecting tool calls until the user
 * approves. Registered per session; reads the CURRENT policy from the gateway
 * on every call, so cached sessions honour per-run permission changes.
 */
export function createApprovalExtension(gateway: ApprovalGateway, sessionId: string) {
  return (pi: PiExtensionApi) => {
    pi.on("tool_call", async (event) => {
      const need = gateway.evaluate(sessionId, event.toolName, event.input);
      if (need === "allow") return undefined;
      const workspaceRoot = gateway.policyFor(sessionId)?.workspaceRoot ?? "";
      const payload = buildPayload(need, event.input, workspaceRoot);
      const decision = await gateway.request(sessionId, {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        payload
      });
      if (decision.approved) return undefined;
      const reason = decision.reason?.trim();
      return {
        block: true,
        reason: reason ? `User declined this operation: ${reason}` : "User declined this operation."
      };
    });
  };
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @marginalia/pi-server test -- approval-extension`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
pnpm --filter @marginalia/pi-server typecheck && pnpm lint && pnpm format:check
git add apps/pi-server/src/agent/approval-extension.ts apps/pi-server/test/approval-extension.test.ts
git commit -m "feat(pi-server): blocking tool_call approval extension"
```

---

### Task 6: PiCodingAgentClient 集成（loader + 事件合流 + 决定回传）

**Files:**

- Modify: `apps/pi-server/src/agent/pi-coding-agent-client.ts`
- Modify: `apps/pi-server/src/app.ts`（仅构造函数注入 gateway 的一行接线）
- Test: `apps/pi-server/test/pi-coding-agent-client.test.ts`（扩展既有文件）
- Test: `apps/pi-server/test/resource-loader-factories.test.ts`（loader 冒烟）

**Interfaces:**

- Consumes: `ApprovalGateway`（Task 3）、`createApprovalExtension`（Task 5）、`AgentRunEvent`（Task 4）、`DefaultResourceLoader`（pi 包根导出）。
- Produces: `PiCodingAgentClient` 构造签名变为 `new PiCodingAgentClient(registry, resolveModel, gateway)`；`run()` 返回的 `events` 中会出现审批事件；`resolveApproval`/`cancelPending` 委托 gateway。

- [ ] **Step 1: 写 loader 冒烟测试（先验证 extensionFactories 在 noExtensions 下仍生效）**

```ts
// apps/pi-server/test/resource-loader-factories.test.ts
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";

describe("DefaultResourceLoader extensionFactories", () => {
  it("invokes inline extension factories with discovery disabled", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "loader-smoke-"));
    let invoked = false;
    const loader = new DefaultResourceLoader({
      cwd: dir,
      agentDir: path.join(dir, "agent"),
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: [
        (pi: { on(type: string, handler: unknown): void }) => {
          invoked = true;
          pi.on("agent_start", () => {});
        }
      ]
    });
    await loader.reload();
    expect(invoked).toBe(true);
  });
});
```

Run: `pnpm --filter @marginalia/pi-server test -- resource-loader-factories`

若 FAIL（`noExtensions: true` 连 factories 一起禁了）：去掉 `noExtensions: true`，保留指向空 temp 目录的 `agentDir` 以隔离全局 `~/.pi` 扩展，并接受 `cwd` 下 `.pi/extensions` 的项目级扩展会被加载（记录到 PR 描述里）。以测试最终通过的配置为准，并把同样配置用于 Step 3。

- [ ] **Step 2: 写集成失败测试（合流 + 回传）**

在 `apps/pi-server/test/pi-coding-agent-client.test.ts` 追加（沿用文件里既有的 fake registry/fake session 构造方式；若无，按下面自建）：

```ts
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AgentSessionRegistry } from "../src/agent/agent-session-registry.js";
import { ApprovalGateway } from "../src/agent/approval-gateway.js";
import { PiCodingAgentClient } from "../src/agent/pi-coding-agent-client.js";

function fakeSessionFactory() {
  let subscriber: ((event: unknown) => void) | null = null;
  let finishPrompt: (() => void) | null = null;
  const session = {
    sessionFile: "/tmp/fake-session.jsonl",
    subscribe(fn: (event: unknown) => void) {
      subscriber = fn;
      return () => {};
    },
    prompt() {
      return new Promise<void>((resolve) => {
        finishPrompt = resolve;
      });
    },
    dispose() {}
  };
  return {
    session,
    emit: (event: unknown) => subscriber?.(event),
    finish: () => finishPrompt?.()
  };
}

describe("PiCodingAgentClient approval merge", () => {
  it("merges gateway approval events into the run event stream and resolves via resolveApproval", async () => {
    // 真实 DefaultResourceLoader.reload() 会在 run() 内执行，workspaceRoot 必须是真实目录。
    const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "pi-client-approval-"));
    const fake = fakeSessionFactory();
    const registry = new AgentSessionRegistry({
      authStorage: {} as never,
      modelRegistry: {} as never,
      createSession: async () => ({ session: fake.session as never }),
      sessionManagerFor: () => ({}) as never
    });
    const gateway = new ApprovalGateway({ fileExists: () => true });
    const client = new PiCodingAgentClient(registry, () => ({}) as never, gateway);

    const result = await client.run({
      sessionId: "s1",
      workspaceRoot,
      piProviderId: "openai",
      modelId: "gpt",
      message: "hi",
      permission: "ask"
    });
    // Policy was registered for the session by run().
    expect(gateway.policyFor("s1")).toEqual({ permission: "ask", workspaceRoot });

    const iterator = result.events[Symbol.asyncIterator]();
    const decisionPromise = gateway.request("s1", {
      toolCallId: "t1",
      toolName: "bash",
      payload: { kind: "command", command: "python x.py", cwd: "/ws" }
    });
    expect((await iterator.next()).value).toMatchObject({ type: "approval_requested" });

    const approvalId = gateway.pendingIds("s1")[0]!;
    expect(client.resolveApproval("s1", approvalId, { approved: true })).toBe(true);
    await expect(decisionPromise).resolves.toEqual({ approved: true });
    expect((await iterator.next()).value).toMatchObject({
      type: "approval_resolved",
      approved: true
    });

    fake.emit({ type: "message_end", message: {} });
    expect((await iterator.next()).value).toMatchObject({ type: "message_end" });
    fake.finish();
    await new Promise((r) => setTimeout(r, 0));
    expect((await iterator.next()).done).toBe(true);
  });
});
```

Run: `pnpm --filter @marginalia/pi-server test -- pi-coding-agent-client`
Expected: FAIL（构造函数签名不符 / 无合流）

- [ ] **Step 3: 实现**

`pi-coding-agent-client.ts` 的改动要点（在既有实现上修改）：

```ts
import { homedir } from "node:os";
import path from "node:path";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import type {
  AgentClient,
  AgentRunEvent,
  AgentRunInput,
  AgentRunResult,
  ApprovalDecision
} from "./agent-client.js";
import type { AgentSessionRegistry } from "./agent-session-registry.js";
import type { ApprovalGateway } from "./approval-gateway.js";
import { createApprovalExtension } from "./approval-extension.js";

const READONLY_TOOLS = ["read", "grep", "find", "ls"];

export class PiCodingAgentClient implements AgentClient {
  constructor(
    private readonly registry: AgentSessionRegistry,
    private readonly resolveModel: ResolveModelFn,
    private readonly gateway: ApprovalGateway
  ) {}

  resolveApproval(_sessionId: string, approvalId: string, decision: ApprovalDecision): boolean {
    return this.gateway.resolve(approvalId, decision);
  }

  cancelPending(sessionId: string): number {
    return this.gateway.cancelPending(sessionId);
  }

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    // ...既有 model 解析不变...

    // Approval policy is per-run: cached sessions read the current value.
    this.gateway.setPolicy(input.sessionId, {
      permission: input.permission ?? "full",
      workspaceRoot: input.workspaceRoot
    });

    const loader = new DefaultResourceLoader({
      cwd: input.workspaceRoot,
      agentDir: path.join(homedir(), ".marginalia", "pi-agent"),
      noExtensions: true, // ← 以 Task 6 Step 1 冒烟测试通过的配置为准
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: [createApprovalExtension(this.gateway, input.sessionId)]
    });
    await loader.reload();

    const config: Record<string, unknown> = { model, resourceLoader: loader };
    // ...readonly tools 与 thinkingLevel 逻辑不变...

    const queue: AgentRunEvent[] = [];
    const waiters: Array<(value: IteratorResult<AgentRunEvent>) => void> = [];
    // pushEvent 抽出为共用函数：session.subscribe 与 gateway.onEvent 都推同一队列
    const pushEvent = (event: AgentRunEvent) => {
      const waiter = waiters.shift();
      if (waiter) waiter({ value: event, done: false });
      else queue.push(event);
    };
    const offApproval = this.gateway.onEvent(input.sessionId, pushEvent);
    const unsubscribe = handle.session.subscribe(pushEvent);

    handle.session
      .prompt(input.message, input.promptOptions)
      .catch((err) => {
        error = err;
      })
      .finally(() => {
        finished = true;
        input.abortSignal?.removeEventListener("abort", abort);
        offApproval();
        unsubscribe?.();
        for (const waiter of waiters.splice(0)) {
          waiter({ value: undefined as unknown as AgentRunEvent, done: true });
        }
      });

    // events 迭代器结构不变（元素类型换成 AgentRunEvent）
    // dispose 里同时调用 offApproval() 与 unsubscribe?.()
  }
}
```

`app.ts` 接线（构造处）：

```ts
import { ApprovalGateway } from "./agent/approval-gateway.js";
// createApp 内：
const approvalGateway = new ApprovalGateway();
const agentClient =
  options.agentClient ??
  new PiCodingAgentClient(
    registry,
    (provider, modelId) => {
      /* 不变 */
    },
    approvalGateway
  );
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @marginalia/pi-server test`（全量）
Expected: PASS（含既有用例）

- [ ] **Step 5: 提交**

```bash
pnpm --filter @marginalia/pi-server typecheck && pnpm lint && pnpm format:check
git add apps/pi-server/src/agent/pi-coding-agent-client.ts apps/pi-server/src/app.ts \
  apps/pi-server/test/pi-coding-agent-client.test.ts apps/pi-server/test/resource-loader-factories.test.ts
git commit -m "feat(pi-server): wire approval gateway into pi client with merged event stream"
```

---

### Task 7: approvals 表与仓储

**Files:**

- Modify: `apps/pi-server/src/db/migrations.ts`
- Modify: `apps/pi-server/src/db/repositories.ts`
- Test: `apps/pi-server/test/approvals-repo.test.ts`

**Interfaces:**

- Produces:
  - `type ApprovalRow = { id: string; sessionId: string; runId: string; toolCallId: string; toolName: string; kind: "command" | "file_edit"; payload: ApprovalPayload; status: "pending" | "approved" | "denied" | "expired"; reason: string | null; createdAt: number; decidedAt: number | null }`
  - `createApproval(db, input: { id; sessionId; runId; toolCallId; toolName; kind; payload }): ApprovalRow`
  - `decideApproval(db, id: string, status: "approved" | "denied" | "expired", reason?: string): ApprovalRow | null`
  - `listApprovals(db, sessionId: string): ApprovalRow[]`
  - `expirePendingApprovals(db, runId: string): number`

- [ ] **Step 1: 写失败测试**

```ts
// apps/pi-server/test/approvals-repo.test.ts
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { migrate } from "../src/db/migrations.js";
import {
  createApproval,
  createRun,
  createSession,
  createWorkspace,
  createProvider,
  decideApproval,
  expirePendingApprovals,
  listApprovals
} from "../src/db/repositories.js";

const dbs: Database.Database[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

function seeded() {
  const db = new Database(":memory:");
  dbs.push(db);
  migrate(db);
  const ws = createWorkspace(db, { name: "W", rootDir: "/tmp/w" });
  const session = createSession(db, { workspaceId: ws.id, title: "S", origin: "desktop" });
  const provider = createProvider(db, { name: "openai", apiKey: "k", defaultModel: "gpt" });
  const run = createRun(db, { sessionId: session.id, providerId: provider.id, model: "gpt" });
  return { db, session, run };
}

describe("approvals repository", () => {
  it("creates, decides and lists approvals with parsed payload", () => {
    const { db, session, run } = seeded();
    createApproval(db, {
      id: "ap-1",
      sessionId: session.id,
      runId: run.id,
      toolCallId: "t1",
      toolName: "bash",
      kind: "command",
      payload: { kind: "command", command: "python x.py", cwd: "/tmp/w" }
    });
    const decided = decideApproval(db, "ap-1", "denied", "改用只读");
    expect(decided?.status).toBe("denied");
    const rows = listApprovals(db, session.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toEqual({ kind: "command", command: "python x.py", cwd: "/tmp/w" });
    expect(rows[0]?.reason).toBe("改用只读");
  });

  it("expires only pending approvals of the given run", () => {
    const { db, session, run } = seeded();
    createApproval(db, {
      id: "a",
      sessionId: session.id,
      runId: run.id,
      toolCallId: "t1",
      toolName: "bash",
      kind: "command",
      payload: { kind: "command", command: "x", cwd: "/" }
    });
    createApproval(db, {
      id: "b",
      sessionId: session.id,
      runId: run.id,
      toolCallId: "t2",
      toolName: "bash",
      kind: "command",
      payload: { kind: "command", command: "y", cwd: "/" }
    });
    decideApproval(db, "a", "approved");
    expect(expirePendingApprovals(db, run.id)).toBe(1);
    const byId = Object.fromEntries(listApprovals(db, session.id).map((r) => [r.id, r.status]));
    expect(byId).toEqual({ a: "approved", b: "expired" });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @marginalia/pi-server test -- approvals-repo`
Expected: FAIL（表/函数不存在）

- [ ] **Step 3: 实现**

`migrations.ts` 的 `db.exec` 里追加（与既有 `CREATE TABLE IF NOT EXISTS` 模式一致）：

```sql
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  tool_call_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reason TEXT,
  created_at INTEGER NOT NULL,
  decided_at INTEGER,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
```

`repositories.ts` 追加（沿用文件里既有的行映射风格；`payload` 存 JSON 字符串，读出时 `JSON.parse`）：

```ts
import type { ApprovalPayload } from "../agent/agent-client.js";

export type ApprovalRow = {
  id: string;
  sessionId: string;
  runId: string;
  toolCallId: string;
  toolName: string;
  kind: "command" | "file_edit";
  payload: ApprovalPayload;
  status: "pending" | "approved" | "denied" | "expired";
  reason: string | null;
  createdAt: number;
  decidedAt: number | null;
};

function mapApproval(row: Record<string, unknown>): ApprovalRow {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    runId: row.run_id as string,
    toolCallId: row.tool_call_id as string,
    toolName: row.tool_name as string,
    kind: row.kind as ApprovalRow["kind"],
    payload: JSON.parse(row.payload as string) as ApprovalPayload,
    status: row.status as ApprovalRow["status"],
    reason: (row.reason as string | null) ?? null,
    createdAt: row.created_at as number,
    decidedAt: (row.decided_at as number | null) ?? null
  };
}

export function createApproval(
  db: Database.Database,
  input: {
    id: string;
    sessionId: string;
    runId: string;
    toolCallId: string;
    toolName: string;
    kind: ApprovalRow["kind"];
    payload: ApprovalPayload;
  }
): ApprovalRow {
  const now = Date.now();
  db.prepare(
    `insert into approvals (id, session_id, run_id, tool_call_id, tool_name, kind, payload, status, created_at)
     values (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
  ).run(
    input.id,
    input.sessionId,
    input.runId,
    input.toolCallId,
    input.toolName,
    input.kind,
    JSON.stringify(input.payload),
    now
  );
  return getApproval(db, input.id)!;
}

export function getApproval(db: Database.Database, id: string): ApprovalRow | null {
  const row = db.prepare("select * from approvals where id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapApproval(row) : null;
}

export function decideApproval(
  db: Database.Database,
  id: string,
  status: "approved" | "denied" | "expired",
  reason?: string
): ApprovalRow | null {
  db.prepare(
    "update approvals set status = ?, reason = coalesce(?, reason), decided_at = ? where id = ?"
  ).run(status, reason ?? null, Date.now(), id);
  return getApproval(db, id);
}

export function listApprovals(db: Database.Database, sessionId: string): ApprovalRow[] {
  return (
    db
      .prepare("select * from approvals where session_id = ? order by created_at asc")
      .all(sessionId) as Record<string, unknown>[]
  ).map(mapApproval);
}

export function expirePendingApprovals(db: Database.Database, runId: string): number {
  const result = db
    .prepare(
      "update approvals set status = 'expired', decided_at = ? where run_id = ? and status = 'pending'"
    )
    .run(Date.now(), runId);
  return result.changes;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @marginalia/pi-server test -- approvals-repo`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
pnpm --filter @marginalia/pi-server typecheck && pnpm lint && pnpm format:check
git add apps/pi-server/src/db/migrations.ts apps/pi-server/src/db/repositories.ts apps/pi-server/test/approvals-repo.test.ts
git commit -m "feat(pi-server): approvals table and repository"
```

---

### Task 8: 审批路由 + SSE envelope + 断开即拒绝

**Files:**

- Modify: `apps/pi-server/src/app.ts`
- Test: `apps/pi-server/test/approval-flow.test.ts`

**Interfaces:**

- Consumes: Task 4 的事件类型、Task 7 的仓储、`FakeAgentClient`。
- Produces（桌面端依赖的 HTTP/SSE 契约）:
  - SSE envelope 新类型：`{ type: "approval_requested", payload: { approval: ApprovalRequestedEvent } }` 与 `{ type: "approval_resolved", payload: { approval: ApprovalResolvedEvent } }`（`run_id`/`session_id`/`created_at` 字段同既有 envelope）。
  - `POST /sessions/:sessionId/approvals/:approvalId`，body `{ approved: boolean; reason?: string; alwaysAllowPrefix?: boolean }` → `{ ok: true }` 或 404。
  - `GET /sessions/:sessionId/approvals` → `ApprovalRow[]`。

- [ ] **Step 1: 写失败测试**

```ts
// apps/pi-server/test/approval-flow.test.ts
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { migrate } from "../src/db/migrations.js";
import {
  createProvider,
  createSession,
  createWorkspace,
  listApprovals
} from "../src/db/repositories.js";
import { FakeAgentClient } from "../src/agent/fake-agent-client.js";
import type { AgentRunEvent, ApprovalRequestedEvent } from "../src/agent/agent-client.js";

const dbs: Database.Database[] = [];
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

function setup() {
  const db = new Database(":memory:");
  dbs.push(db);
  migrate(db);
  const ws = createWorkspace(db, { name: "W", rootDir: "/tmp/w" });
  const session = createSession(db, { workspaceId: ws.id, title: "S", origin: "desktop" });
  const provider = createProvider(db, { name: "openai", apiKey: "k", defaultModel: "gpt" });
  const fake = new FakeAgentClient();
  const app = createApp({ db, agentClient: fake });
  return { db, session, provider, fake, app };
}

function approvalEvent(sessionId: string): ApprovalRequestedEvent {
  return {
    type: "approval_requested",
    approvalId: "ap-1",
    sessionId,
    toolCallId: "t1",
    toolName: "bash",
    payload: { kind: "command", command: "python x.py", cwd: "/tmp/w" }
  };
}

async function* readSse(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index;
    while ((index = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (line)
        yield JSON.parse(line.slice("data: ".length)) as {
          type: string;
          payload?: Record<string, unknown>;
        };
    }
  }
}

describe("approval flow over SSE", () => {
  it("emits approval envelopes, persists rows, and resumes after the decision", async () => {
    const { db, session, provider, fake, app } = setup();
    fake.enqueueEvents([approvalEvent(session.id) as AgentRunEvent]);

    const response = await app.request(`/sessions/${session.id}/runs`, {
      method: "POST",
      body: JSON.stringify({ providerId: provider.id, message: "hi", permission: "ask" }),
      headers: { "content-type": "application/json" }
    });
    expect(response.status).toBe(200);
    const events = readSse(response.body!);

    const seen: string[] = [];
    for await (const event of events) {
      seen.push(event.type);
      if (event.type === "approval_requested") {
        expect(listApprovals(db, session.id)[0]?.status).toBe("pending");
        const decide = await app.request(`/sessions/${session.id}/approvals/ap-1`, {
          method: "POST",
          body: JSON.stringify({ approved: true }),
          headers: { "content-type": "application/json" }
        });
        expect(decide.status).toBe(200);
      }
      if (event.type === "run_completed") break;
    }
    expect(seen).toEqual([
      "run_started",
      "approval_requested",
      "approval_resolved",
      "run_completed"
    ]);
    expect(listApprovals(db, session.id)[0]?.status).toBe("approved");
  });

  it("returns 404 for unknown approval ids", async () => {
    const { session, app } = setup();
    const res = await app.request(`/sessions/${session.id}/approvals/nope`, {
      method: "POST",
      body: JSON.stringify({ approved: true }),
      headers: { "content-type": "application/json" }
    });
    expect(res.status).toBe(404);
  });

  it("denies pending approvals when the client disconnects", async () => {
    const { db, session, provider, fake, app } = setup();
    fake.enqueueEvents([approvalEvent(session.id) as AgentRunEvent]);
    const controller = new AbortController();
    const response = await app.request(`/sessions/${session.id}/runs`, {
      method: "POST",
      body: JSON.stringify({ providerId: provider.id, message: "hi", permission: "ask" }),
      headers: { "content-type": "application/json" },
      signal: controller.signal
    });
    const events = readSse(response.body!);
    for await (const event of events) {
      if (event.type === "approval_requested") {
        controller.abort();
        break;
      }
    }
    // Give the abort handler a tick to run.
    await new Promise((r) => setTimeout(r, 20));
    expect(listApprovals(db, session.id)[0]?.status).toBe("expired");
  });

  it("lists persisted approvals for reopen", async () => {
    const { db, session, app } = setup();
    const { createApproval, decideApproval } = await import("../src/db/repositories.js");
    createApproval(db, {
      id: "x",
      sessionId: session.id,
      runId: "r",
      toolCallId: "t",
      toolName: "bash",
      kind: "command",
      payload: { kind: "command", command: "x", cwd: "/" }
    });
    decideApproval(db, "x", "denied", "no");
    const res = await app.request(`/sessions/${session.id}/approvals`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject([{ id: "x", status: "denied", reason: "no" }]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @marginalia/pi-server test -- approval-flow`
Expected: FAIL（路由不存在 / envelope 未分流）

- [ ] **Step 3: 实现（app.ts）**

1. 新路由（放在既有 `/sessions/:sessionId/messages` 附近）：

```ts
app.post("/sessions/:sessionId/approvals/:approvalId", async (c) => {
  const body = await c.req.json<{
    approved: boolean;
    reason?: string;
    alwaysAllowPrefix?: boolean;
  }>();
  const approvalId = c.req.param("approvalId");
  const ok = agentClient.resolveApproval(c.req.param("sessionId"), approvalId, body);
  if (!ok) return c.json({ error: "approval not found or already resolved" }, 404);
  decideApproval(db, approvalId, body.approved ? "approved" : "denied", body.reason);
  return c.json({ ok: true });
});

app.get("/sessions/:sessionId/approvals", (c) =>
  c.json(listApprovals(db, c.req.param("sessionId")))
);
```

2. runs 路由 SSE 循环分流（替换现有 `for await` 循环体的开头；`agent_event` 分支保持原样不动）：

```ts
// 断开即拒绝：abort 时主动取消挂起审批，避免被阻塞的扩展死等。
const onAbort = () => {
  agentClient.cancelPending(sessionId);
};
c.req.raw.signal.addEventListener("abort", onAbort, { once: true });

try {
  for await (const event of result.events) {
    const type = (event as { type?: string }).type;
    if (type === "approval_requested") {
      const approval = event as ApprovalRequestedEvent;
      createApproval(db, {
        id: approval.approvalId,
        sessionId,
        runId: run.id,
        toolCallId: approval.toolCallId,
        toolName: approval.toolName,
        kind: approval.payload.kind,
        payload: approval.payload
      });
      await emit("approval_requested", { approval });
      continue;
    }
    if (type === "approval_resolved") {
      const approval = event as ApprovalResolvedEvent;
      if (approval.expired) decideApproval(db, approval.approvalId, "expired");
      await emit("approval_resolved", { approval });
      continue;
    }
    await emit("agent_event", { event });
    // ...既有 message_end / stopReason === "error" 检查保持不变...
  }
} finally {
  c.req.raw.signal.removeEventListener("abort", onAbort);
  agentClient.cancelPending(sessionId);
  expirePendingApprovals(db, run.id);
}
```

repositories 的新增 import：`createApproval, decideApproval, listApprovals, expirePendingApprovals`；类型 import：`ApprovalRequestedEvent, ApprovalResolvedEvent`（来自 `./agent/agent-client.js`）。

注意兼容点：`options.agentClient`（tests 注入 Fake）与真实客户端都已实现 `resolveApproval`/`cancelPending`（Task 4/6）。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @marginalia/pi-server test`
Expected: PASS（全量）

- [ ] **Step 5: 提交**

```bash
pnpm --filter @marginalia/pi-server typecheck && pnpm lint && pnpm format:check
git add apps/pi-server/src/app.ts apps/pi-server/test/approval-flow.test.ts
git commit -m "feat(pi-server): approval SSE envelopes, decision route, disconnect-deny"
```

---

### Task 9: 桌面端 API client

**Files:**

- Modify: `apps/desktop/src/api/client.ts`
- Test: `apps/desktop/src/api/client.approvals.test.ts`

**Interfaces:**

- Produces（桌面端全链路共用）:
  - `type ApprovalPayload`（与服务端同构：command / file_edit 两支，字段名一致）
  - `type Approval = { id: string; toolCallId: string; toolName: string; kind: "command" | "file_edit"; payload: ApprovalPayload; status: "pending" | "approved" | "denied" | "expired"; reason?: string | null }`
  - `ApiClient.listApprovals(sessionId: string): Promise<Approval[]>`
  - `ApiClient.resolveApproval(sessionId: string, approvalId: string, input: { approved: boolean; reason?: string; alwaysAllowPrefix?: boolean }): Promise<{ ok: boolean }>`

- [ ] **Step 1: 写失败测试**

```ts
// apps/desktop/src/api/client.approvals.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "./client.js";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(payload: unknown, status = 200) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("ApiClient approvals", () => {
  it("lists approvals", async () => {
    const fetchMock = stubFetch([{ id: "a", toolCallId: "t", status: "pending" }]);
    const api = new ApiClient("http://x");
    const list = await api.listApprovals("s1");
    expect(fetchMock).toHaveBeenCalledWith("http://x/sessions/s1/approvals", expect.anything());
    expect(list[0]?.id).toBe("a");
  });

  it("posts a decision", async () => {
    const fetchMock = stubFetch({ ok: true });
    const api = new ApiClient("http://x");
    await api.resolveApproval("s1", "ap-1", { approved: false, reason: "换个方式" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://x/sessions/s1/approvals/ap-1");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      approved: false,
      reason: "换个方式"
    });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @marginalia/desktop test -- client.approvals`
Expected: FAIL（方法不存在）

- [ ] **Step 3: 实现（client.ts 追加）**

```ts
export type ApprovalPayload =
  | { kind: "command"; command: string; cwd: string }
  | {
      kind: "file_edit";
      path: string;
      mode: "edit" | "write";
      patch: string;
      additions: number;
      deletions: number;
      exact: boolean;
      error?: string;
    };

export type Approval = {
  id: string;
  toolCallId: string;
  toolName: string;
  kind: "command" | "file_edit";
  payload: ApprovalPayload;
  status: "pending" | "approved" | "denied" | "expired";
  reason?: string | null;
};
```

`ApiClient` 内追加：

```ts
listApprovals(sessionId: string) {
  return this.request<Approval[]>(`/sessions/${sessionId}/approvals`);
}

resolveApproval(
  sessionId: string,
  approvalId: string,
  input: { approved: boolean; reason?: string; alwaysAllowPrefix?: boolean }
) {
  return this.request<{ ok: boolean }>(`/sessions/${sessionId}/approvals/${approvalId}`, {
    method: "POST",
    body: JSON.stringify(input)
  });
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @marginalia/desktop test -- client.approvals`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
pnpm --filter @marginalia/desktop typecheck && pnpm lint && pnpm format:check
git add apps/desktop/src/api/client.ts apps/desktop/src/api/client.approvals.test.ts
git commit -m "feat(desktop): approvals api client"
```

---

### Task 10: useStreamingChat 消费审批 envelope

**Files:**

- Modify: `apps/desktop/src/hooks/useStreamingChat.ts`
- Test: `apps/desktop/src/hooks/useStreamingChat.approvals.test.ts`

**Interfaces:**

- Consumes: `Approval`/`ApprovalPayload`（Task 9）。
- Produces（ChatView 依赖）:
  - `Options.onApprovalRequested?: (approval: { approvalId: string; toolCallId: string; toolName: string; payload: ApprovalPayload }) => void`
  - `Options.onApprovalResolved?: (update: { approvalId: string; toolCallId: string; approved: boolean; reason?: string; expired?: boolean }) => void`

- [ ] **Step 1: 写失败测试**

```ts
// apps/desktop/src/hooks/useStreamingChat.approvals.test.ts
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

describe("useStreamingChat approvals", () => {
  it("forwards approval envelopes to the callbacks", async () => {
    const requested = vi.fn();
    const resolved = vi.fn();
    const api = apiWithEvents([
      { type: "run_started", payload: {} },
      {
        type: "approval_requested",
        payload: {
          approval: {
            approvalId: "ap-1",
            toolCallId: "t1",
            toolName: "bash",
            payload: { kind: "command", command: "x", cwd: "/" }
          }
        }
      },
      {
        type: "approval_resolved",
        payload: {
          approval: {
            approvalId: "ap-1",
            toolCallId: "t1",
            approved: false,
            reason: "不要",
            expired: false
          }
        }
      },
      { type: "run_completed", payload: {} }
    ]);
    const { result } = renderHook(() =>
      useStreamingChat({
        ...baseOpts,
        api,
        onApprovalRequested: requested,
        onApprovalResolved: resolved
      })
    );
    await act(() => result.current.send("hi", []));
    expect(requested).toHaveBeenCalledWith(
      expect.objectContaining({ approvalId: "ap-1", toolCallId: "t1", toolName: "bash" })
    );
    expect(resolved).toHaveBeenCalledWith(
      expect.objectContaining({ approvalId: "ap-1", approved: false, reason: "不要" })
    );
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @marginalia/desktop test -- useStreamingChat.approvals`
Expected: FAIL（回调未触发）

- [ ] **Step 3: 实现**

`Options` 接口追加两个可选回调（签名见上）。事件循环中，在 `if (event.type !== "agent_event") continue;` **之前**插入：

```ts
if (event.type === "approval_requested") {
  const approval = (
    event.payload as
      | {
          approval?: {
            approvalId: string;
            toolCallId: string;
            toolName: string;
            payload: import("@/api/client.js").ApprovalPayload;
          };
        }
      | undefined
  )?.approval;
  if (approval) opts.onApprovalRequested?.(approval);
  continue;
}
if (event.type === "approval_resolved") {
  const approval = (
    event.payload as
      | {
          approval?: {
            approvalId: string;
            toolCallId: string;
            approved: boolean;
            reason?: string;
            expired?: boolean;
          };
        }
      | undefined
  )?.approval;
  if (approval) opts.onApprovalResolved?.(approval);
  continue;
}
```

（实现时把内联 import 类型改为文件顶部的 `import type { ApprovalPayload } from "@/api/client.js";`。）

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @marginalia/desktop test -- useStreamingChat`
Expected: PASS（含既有用例）

- [ ] **Step 5: 提交**

```bash
pnpm --filter @marginalia/desktop typecheck && pnpm lint && pnpm format:check
git add apps/desktop/src/hooks/useStreamingChat.ts apps/desktop/src/hooks/useStreamingChat.approvals.test.ts
git commit -m "feat(desktop): consume approval envelopes in streaming chat hook"
```

---

### Task 11: DiffView 组件

**Files:**

- Create: `apps/desktop/src/chat/DiffView.tsx`
- Test: `apps/desktop/src/chat/DiffView.test.tsx`
- Modify: `apps/desktop/src/i18n/messages.ts`（新增 `approval.expandDiff`，en+zh）

**Interfaces:**

- Produces: `DiffView({ patch }: { patch: string })` — 渲染 unified patch：`+` 行 `bg-brand/10 text-brand`、`-` 行 `bg-danger-soft text-danger`、`@@`/文件头行 `text-text-faint`；超过 120 行折叠，按钮展开（文案 `t("approval.expandDiff")`）。

- [ ] **Step 1: 写失败测试**

```tsx
// apps/desktop/src/chat/DiffView.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DiffView } from "./DiffView.js";

const patch = ["--- a/a.md", "+++ b/a.md", "@@ -1,2 +1,2 @@", " context", "-old", "+new"].join(
  "\n"
);

describe("DiffView", () => {
  it("colors additions and deletions", () => {
    render(<DiffView patch={patch} />);
    expect(screen.getByText("+new")).toBeInTheDocument();
    expect(screen.getByText("-old")).toBeInTheDocument();
  });

  it("folds long patches behind an expand button", async () => {
    const longPatch = ["@@ -1 +1 @@", ...Array.from({ length: 200 }, (_, i) => `+line ${i}`)].join(
      "\n"
    );
    render(<DiffView patch={longPatch} />);
    expect(screen.queryByText("+line 199")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByText("+line 199")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @marginalia/desktop test -- DiffView`
Expected: FAIL（组件不存在）

- [ ] **Step 3: 实现**

```tsx
// apps/desktop/src/chat/DiffView.tsx
import { useState } from "react";
import { cn } from "@/lib/cn.js";
import { useTranslation } from "@/i18n/useTranslation.js";

const FOLD_THRESHOLD = 120;

function lineClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) {
    return "text-text-faint";
  }
  if (line.startsWith("+")) return "bg-brand/10 text-brand";
  if (line.startsWith("-")) return "bg-danger-soft text-danger";
  return "text-text-muted";
}

export function DiffView({ patch }: { patch: string }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const lines = patch.replace(/\n$/, "").split("\n");
  const folded = !expanded && lines.length > FOLD_THRESHOLD;
  const visible = folded ? lines.slice(0, FOLD_THRESHOLD) : lines;
  return (
    <div className="mono max-h-96 overflow-auto rounded-md border border-soft bg-surface text-[12px] leading-relaxed">
      <pre className="min-w-0">
        {visible.map((line, index) => (
          <div key={index} className={cn("whitespace-pre-wrap break-all px-2", lineClass(line))}>
            {line}
          </div>
        ))}
      </pre>
      {folded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="w-full border-t border-soft px-2 py-1 text-left text-[11.5px] text-text-muted hover:bg-surface-3"
        >
          {t("approval.expandDiff")}
        </button>
      )}
    </div>
  );
}
```

i18n（`messages.ts` en/zh 各加。注意：`useTranslation` 的 `t(key)` 是单参签名、**不支持插值**，所以文案固定不带数字）：

```ts
// en
approval: {
  expandDiff: "Show full diff";
}
// zh
approval: {
  expandDiff: "展开完整 diff";
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @marginalia/desktop test -- DiffView`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
pnpm --filter @marginalia/desktop typecheck && pnpm lint && pnpm format:check
git add apps/desktop/src/chat/DiffView.tsx apps/desktop/src/chat/DiffView.test.tsx apps/desktop/src/i18n/messages.ts
git commit -m "feat(desktop): unified diff view component"
```

---

### Task 12: ApprovalCard 组件

**Files:**

- Create: `apps/desktop/src/chat/ApprovalCard.tsx`
- Test: `apps/desktop/src/chat/ApprovalCard.test.tsx`
- Modify: `apps/desktop/src/i18n/messages.ts`（本任务全部审批文案，en+zh）

**Interfaces:**

- Consumes: `Approval`（Task 9）、`DiffView`（Task 11）。
- Produces: `ApprovalCard({ approval, onDecide }: { approval: Approval; onDecide(decision: { approved: boolean; reason?: string; alwaysAllowPrefix?: boolean }): void })` — 仅渲染 `status === "pending"` 的交互态；终态徽标由 ToolCard 负责（Task 13）。

- [ ] **Step 1: 写失败测试**

```tsx
// apps/desktop/src/chat/ApprovalCard.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApprovalCard } from "./ApprovalCard.js";
import type { Approval } from "@/api/client.js";

const commandApproval: Approval = {
  id: "ap-1",
  toolCallId: "t1",
  toolName: "bash",
  kind: "command",
  status: "pending",
  payload: { kind: "command", command: "python gen.py", cwd: "/ws" }
};

const editApproval: Approval = {
  id: "ap-2",
  toolCallId: "t2",
  toolName: "edit",
  kind: "file_edit",
  status: "pending",
  payload: {
    kind: "file_edit",
    path: "a.md",
    mode: "edit",
    patch: "@@ -1 +1 @@\n-old\n+new",
    additions: 1,
    deletions: 1,
    exact: false
  }
};

describe("ApprovalCard", () => {
  it("approves a command, forwarding the prefix checkbox", async () => {
    const onDecide = vi.fn();
    render(<ApprovalCard approval={commandApproval} onDecide={onDecide} />);
    expect(screen.getByText("python gen.py")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: /allow|允许/i }));
    expect(onDecide).toHaveBeenCalledWith({ approved: true, alwaysAllowPrefix: true });
  });

  it("denies with an optional reason after a two-step flow", async () => {
    const onDecide = vi.fn();
    render(<ApprovalCard approval={commandApproval} onDecide={onDecide} />);
    await userEvent.click(screen.getByRole("button", { name: /deny|拒绝/i }));
    await userEvent.type(screen.getByRole("textbox"), "改用只读方式");
    await userEvent.click(screen.getByRole("button", { name: /confirm|确认/i }));
    expect(onDecide).toHaveBeenCalledWith({ approved: false, reason: "改用只读方式" });
  });

  it("renders the diff and the approximate badge for file edits", () => {
    render(<ApprovalCard approval={editApproval} onDecide={() => {}} />);
    expect(screen.getByText("+new")).toBeInTheDocument();
    expect(screen.getByText(/approximate|近似/i)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @marginalia/desktop test -- ApprovalCard`
Expected: FAIL

- [ ] **Step 3: 实现**

```tsx
// apps/desktop/src/chat/ApprovalCard.tsx
import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import type { Approval } from "@/api/client.js";
import { Button } from "@/components/ui/button.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { DiffView } from "./DiffView.js";

type Decision = { approved: boolean; reason?: string; alwaysAllowPrefix?: boolean };

export function ApprovalCard({
  approval,
  onDecide
}: {
  approval: Approval;
  onDecide(decision: Decision): void;
}) {
  const { t } = useTranslation();
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState("");
  const [allowPrefix, setAllowPrefix] = useState(false);
  const payload = approval.payload;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-warn bg-warn-soft px-3 py-2.5 text-sm">
      <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-warn">
        <ShieldAlert className="h-3.5 w-3.5" />
        {t("approval.title")}
      </span>

      {payload.kind === "command" ? (
        <>
          <code className="mono block overflow-x-auto rounded bg-surface px-2 py-1.5 text-[12.5px]">
            {payload.command}
          </code>
          <span className="text-[11.5px] text-text-muted">
            {t("approval.workingDir")}: <span className="mono">{payload.cwd}</span>
          </span>
          <label className="flex items-center gap-2 text-[12px] text-text-muted">
            <input
              type="checkbox"
              checked={allowPrefix}
              onChange={(e) => setAllowPrefix(e.target.checked)}
            />
            {t("approval.alwaysAllowPrefix")}
          </label>
        </>
      ) : (
        <>
          <span className="mono text-[12.5px]">
            {payload.path}
            <span className="ml-2 text-brand">+{payload.additions}</span>
            <span className="ml-1 text-danger">-{payload.deletions}</span>
            {!payload.exact && (
              <span className="ml-2 rounded bg-surface px-1.5 py-0.5 text-[11px] text-text-muted">
                {t("approval.approxPreview")}
              </span>
            )}
          </span>
          {payload.error ? (
            <span className="text-[12px] text-danger">{payload.error}</span>
          ) : (
            <DiffView patch={payload.patch} />
          )}
        </>
      )}

      {denying ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("approval.denyReasonPlaceholder")}
            rows={2}
            className="rounded-md border border-soft bg-surface px-2 py-1.5 text-[12.5px]"
          />
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onDecide({ approved: false, reason: reason.trim() || undefined })}
            >
              {t("approval.confirmDeny")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDenying(false)}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() =>
              onDecide({
                approved: true,
                ...(payload.kind === "command" ? { alwaysAllowPrefix: allowPrefix } : {})
              })
            }
          >
            {t("approval.allow")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setDenying(true)}>
            {t("approval.deny")}
          </Button>
        </div>
      )}
    </div>
  );
}
```

设计令牌注意：`warn` / `warn-soft`（琥珀）令牌**已存在**于 `tailwind.config.ts`，直接使用即可，不要用 ad-hoc `amber-*` 类；`common.cancel` 键已存在于 `messages.ts`，无需新增。

i18n 键（en / zh）：

```ts
approval: {
  title: "Approval required" / "需要审批",
  workingDir: "Working directory" / "工作目录",
  approxPreview: "Approximate preview" / "近似预览",
  allow: "Allow" / "允许",
  deny: "Deny" / "拒绝",
  confirmDeny: "Confirm deny" / "确认拒绝",
  denyReasonPlaceholder: "Tell the model what to do instead (optional)" / "告诉模型该怎么改（可选）",
  alwaysAllowPrefix: "Always allow this command prefix in this session" / "本次会话总是允许此命令前缀",
  approved: "Approved" / "已批准",
  denied: "Denied" / "已拒绝",
  expired: "Approval expired" / "审批已过期",
  expandDiff: "Show full diff" / "展开完整 diff"
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @marginalia/desktop test -- ApprovalCard`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
pnpm --filter @marginalia/desktop typecheck && pnpm lint && pnpm format:check
git add apps/desktop/src/chat/ApprovalCard.tsx apps/desktop/src/chat/ApprovalCard.test.tsx \
  apps/desktop/src/i18n/messages.ts apps/desktop/src/styles.css apps/desktop/tailwind.config.ts
git commit -m "feat(desktop): approval card with command and diff variants"
```

---

### Task 13: ChatView / MessageStream / ToolCard 接线 + 重开还原

**Files:**

- Modify: `apps/desktop/src/chat/ChatView.tsx`
- Modify: `apps/desktop/src/chat/MessageStream.tsx`
- Modify: `apps/desktop/src/chat/MessageItem.tsx`
- Modify: `apps/desktop/src/chat/ToolCard.tsx`
- Test: `apps/desktop/src/chat/ToolCard.approval.test.tsx`、`apps/desktop/src/chat/ChatView.approvals.test.tsx`

**Interfaces:**

- Consumes: Task 9-12 的全部产物。
- Produces:
  - `ToolCard` props 变为 `{ call, result, approval?: Approval, onDecideApproval?: (approvalId: string, decision: { approved: boolean; reason?: string; alwaysAllowPrefix?: boolean }) => void }`
  - `MessageStream`/`MessageItem` 透传 `approvalsByToolCallId?: ReadonlyMap<string, Approval>` 与 `onDecideApproval`。

- [ ] **Step 1: 写失败测试**

```tsx
// apps/desktop/src/chat/ToolCard.approval.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToolCard } from "./ToolCard.js";
import type { Approval } from "@/api/client.js";

const call = {
  type: "toolCall" as const,
  id: "t1",
  name: "bash",
  arguments: { command: "python x.py" }
};

function approval(status: Approval["status"], reason?: string): Approval {
  return {
    id: "ap-1",
    toolCallId: "t1",
    toolName: "bash",
    kind: "command",
    status,
    reason,
    payload: { kind: "command", command: "python x.py", cwd: "/ws" }
  };
}

describe("ToolCard approvals", () => {
  it("embeds the pending approval card", () => {
    render(<ToolCard call={call} approval={approval("pending")} onDecideApproval={vi.fn()} />);
    expect(screen.getByRole("button", { name: /allow|允许/i })).toBeInTheDocument();
  });

  it("shows a denied badge with the reason", () => {
    render(<ToolCard call={call} approval={approval("denied", "改用只读")} />);
    expect(screen.getByText(/denied|已拒绝/i)).toBeInTheDocument();
    expect(screen.getByText(/改用只读/)).toBeInTheDocument();
  });

  it("shows an expired badge", () => {
    render(<ToolCard call={call} approval={approval("expired")} />);
    expect(screen.getByText(/expired|已过期/i)).toBeInTheDocument();
  });
});
```

```tsx
// apps/desktop/src/chat/ChatView.approvals.test.tsx
// 关键断言：打开会话时 listApprovals 的持久化结果按 toolCallId 附着到工具卡（重开还原）。
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ChatView } from "./ChatView.js";
import type { ApiClient } from "@/api/client.js";

function fakeApi(): ApiClient {
  return {
    listMessages: vi.fn(async () => [
      {
        id: "m1",
        message: {
          role: "assistant",
          content: [
            { type: "toolCall", id: "t1", name: "bash", arguments: { command: "python x.py" } }
          ],
          api: "x",
          provider: "p",
          model: "m",
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
          },
          stopReason: "stop",
          timestamp: 1
        }
      }
    ]),
    listApprovals: vi.fn(async () => [
      {
        id: "ap-1",
        toolCallId: "t1",
        toolName: "bash",
        kind: "command",
        status: "denied",
        reason: "不安全",
        payload: { kind: "command", command: "python x.py", cwd: "/ws" }
      }
    ]),
    listProviders: vi.fn(async () => []),
    searchFiles: vi.fn(async () => []),
    createMessage: vi.fn(),
    runChat: vi.fn()
  } as unknown as ApiClient;
}

describe("ChatView approval restore", () => {
  it("attaches persisted approvals to tool cards on reopen", async () => {
    render(<ChatView api={fakeApi()} sessionId="s1" />);
    expect(await screen.findByText(/denied|已拒绝/i)).toBeInTheDocument();
    expect(screen.getByText(/不安全/)).toBeInTheDocument();
  });
});
```

（`usage` 字段形态以 `@marginalia/chat-core` 的 `emptyUsage()` 为准——测试里直接 `import { emptyUsage } from "@marginalia/chat-core"` 使用，别手写。`useMessages`/`useProviders` 若有额外 api 依赖，按既有 `ChatView.test.tsx` 的 mock 方式补齐。）

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @marginalia/desktop test -- ToolCard.approval ChatView.approvals`
Expected: FAIL

- [ ] **Step 3: 实现**

1. `ToolCard.tsx`：props 增加 `approval?: Approval`、`onDecideApproval?`；状态点：`approval?.status === "pending"` 时 `dot warn`；`denied`/`expired` 时 `dot err`。行下方：
   - pending → `<ApprovalCard approval={approval} onDecide={(d) => onDecideApproval?.(approval.id, d)} />`
   - denied → 徽标行 `t("approval.denied")` + `approval.reason`（若有）
   - expired → `t("approval.expired")`
2. `MessageItem.tsx` / `MessageStream.tsx`：新增可选 props `approvalsByToolCallId`、`onDecideApproval`，在渲染 `ToolCard` 处传 `approval={approvalsByToolCallId?.get(part.id)}`。
3. `ChatView.tsx`：

```tsx
const [approvals, setApprovals] = useState<Map<string, Approval>>(new Map());

useEffect(() => {
  let cancelled = false;
  setApprovals(new Map());
  void api
    .listApprovals(sessionId)
    .then((list) => {
      if (cancelled) return;
      setApprovals(new Map(list.map((a) => [a.toolCallId, a])));
    })
    .catch(() => {});
  return () => {
    cancelled = true;
  };
}, [api, sessionId]);

function upsertApproval(a: Approval) {
  setApprovals((prev) => new Map(prev).set(a.toolCallId, a));
}
```

streaming 回调接线（`useStreamingChat` 参数追加）：

```tsx
onApprovalRequested: (a) =>
  upsertApproval({ id: a.approvalId, toolCallId: a.toolCallId, toolName: a.toolName, kind: a.payload.kind, payload: a.payload, status: "pending" }),
onApprovalResolved: (u) =>
  setApprovals((prev) => {
    const existing = prev.get(u.toolCallId);
    if (!existing) return prev;
    const status = u.expired ? "expired" : u.approved ? "approved" : "denied";
    return new Map(prev).set(u.toolCallId, { ...existing, status, reason: u.reason ?? null });
  }),
```

决定处理器（乐观更新 + 失败回滚为 pending 不必做，保持简单：失败 toast）：

```tsx
async function decideApproval(
  approvalId: string,
  decision: { approved: boolean; reason?: string; alwaysAllowPrefix?: boolean }
) {
  try {
    await api.resolveApproval(sessionId, approvalId, decision);
  } catch (err) {
    setError((err as Error).message);
  }
}
```

`MessageStream` 传参：`approvalsByToolCallId={approvals} onDecideApproval={decideApproval}`。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @marginalia/desktop test`
Expected: PASS（全量，含既有 ToolCard/ChatView 用例）

- [ ] **Step 5: 提交**

```bash
pnpm --filter @marginalia/desktop typecheck && pnpm lint && pnpm format:check
git add apps/desktop/src/chat apps/desktop/src/i18n/messages.ts
git commit -m "feat(desktop): inline approval cards in tool flow with reopen restore"
```

---

### Task 14: 脚本化 fake agent + 截图场景 + 文档同步

**Files:**

- Create: `apps/pi-server/src/agent/scripted-fake-agent.ts`
- Modify: `apps/pi-server/src/index.ts`（env 开关接线）
- Modify: `apps/desktop/scripts/verify-screenshots.mjs`（新场景 `approval-flow`）
- Modify: `docs/user/concepts.md`、`docs/developer/api.md`、`docs/user/guide.md`、`README.md`
- Test: `apps/pi-server/test/scripted-fake-agent.test.ts`

**Interfaces:**

- Produces: `ScriptedFakeAgentClient implements AgentClient` — 按用户消息关键字回放脚本：
  - 消息含 `approval-bash` → assistant 消息 + bash 工具调用 + 命令审批（批准后出 tool 结果与结尾文本）；
  - 消息含 `approval-edit` → edit 工具调用 + file_edit 审批（含示例 patch）；
  - 其余 → 简单流式文本回复。
  - 环境变量 `MARGINALIA_FAKE_AGENT=1` 时 `index.ts` 用它替换真实客户端（仅开发/截图用途，文档注明）。

- [ ] **Step 1: 写失败测试**

```ts
// apps/pi-server/test/scripted-fake-agent.test.ts
import { describe, expect, it } from "vitest";
import { ScriptedFakeAgentClient } from "../src/agent/scripted-fake-agent.js";

const baseInput = {
  sessionId: "s1",
  workspaceRoot: "/ws",
  piProviderId: "openai",
  modelId: "gpt",
  message: ""
};

describe("ScriptedFakeAgentClient", () => {
  it("emits a command approval script for approval-bash prompts", async () => {
    const client = new ScriptedFakeAgentClient();
    const result = await client.run({ ...baseInput, message: "please approval-bash" });
    const types: string[] = [];
    for await (const event of result.events) {
      const type = (event as { type?: string }).type ?? "";
      types.push(type);
      if (type === "approval_requested") {
        const id = (event as { approvalId: string }).approvalId;
        client.resolveApproval("s1", id, { approved: true });
      }
    }
    expect(types).toContain("approval_requested");
    expect(types).toContain("approval_resolved");
    expect(types.at(-1)).toBe("message_end");
  });

  it("replies with plain text otherwise", async () => {
    const client = new ScriptedFakeAgentClient();
    const result = await client.run({ ...baseInput, message: "hello" });
    const types: string[] = [];
    for await (const event of result.events) types.push((event as { type?: string }).type ?? "");
    expect(types).not.toContain("approval_requested");
    expect(types).toContain("message_end");
  });
});
```

- [ ] **Step 2: 运行确认失败 → 实现**

Run: `pnpm --filter @marginalia/pi-server test -- scripted-fake-agent`（FAIL 后实现）

```ts
// apps/pi-server/src/agent/scripted-fake-agent.ts
import { FakeAgentClient } from "./fake-agent-client.js";
import type {
  AgentClient,
  AgentRunEvent,
  AgentRunInput,
  AgentRunResult,
  ApprovalDecision
} from "./agent-client.js";

function assistantMessage(content: unknown[]): Record<string, unknown> {
  return {
    role: "assistant",
    content,
    api: "scripted",
    provider: "fake",
    model: "fake",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: "stop",
    timestamp: Date.now()
  };
}

function bashApprovalScript(sessionId: string): AgentRunEvent[] {
  const toolCall = {
    type: "toolCall",
    id: "fake-t1",
    name: "bash",
    arguments: { command: "python analyze.py 债务数据/汇总.csv" }
  };
  return [
    { type: "message_start", message: assistantMessage([toolCall]) },
    {
      type: "tool_execution_start",
      toolCallId: "fake-t1",
      toolName: "bash",
      args: toolCall.arguments
    },
    {
      type: "approval_requested",
      approvalId: "fake-ap-1",
      sessionId,
      toolCallId: "fake-t1",
      toolName: "bash",
      payload: {
        kind: "command",
        command: "python analyze.py 债务数据/汇总.csv",
        cwd: "/tmp/fake-ws"
      }
    },
    {
      type: "tool_execution_end",
      toolCallId: "fake-t1",
      toolName: "bash",
      result: "rows: 251",
      isError: false
    },
    {
      type: "message_end",
      message: assistantMessage([{ type: "text", text: "分析完成：共 251 份文档。" }])
    }
  ] as unknown as AgentRunEvent[];
}

function editApprovalScript(sessionId: string): AgentRunEvent[] {
  const patch = [
    "--- a/摘要.md",
    "+++ b/摘要.md",
    "@@ -1,2 +1,2 @@",
    " # 摘要",
    "-旧结论",
    "+新结论：专项债覆盖率提升"
  ].join("\n");
  const toolCall = {
    type: "toolCall",
    id: "fake-t2",
    name: "edit",
    arguments: { path: "摘要.md" }
  };
  return [
    { type: "message_start", message: assistantMessage([toolCall]) },
    {
      type: "tool_execution_start",
      toolCallId: "fake-t2",
      toolName: "edit",
      args: toolCall.arguments
    },
    {
      type: "approval_requested",
      approvalId: "fake-ap-2",
      sessionId,
      toolCallId: "fake-t2",
      toolName: "edit",
      payload: {
        kind: "file_edit",
        path: "摘要.md",
        mode: "edit",
        patch,
        additions: 1,
        deletions: 1,
        exact: true
      }
    },
    {
      type: "tool_execution_end",
      toolCallId: "fake-t2",
      toolName: "edit",
      result: "ok",
      isError: false
    },
    { type: "message_end", message: assistantMessage([{ type: "text", text: "已更新摘要。" }]) }
  ] as unknown as AgentRunEvent[];
}

function plainScript(): AgentRunEvent[] {
  return [
    { type: "message_start", message: assistantMessage([]) },
    {
      type: "message_update",
      message: assistantMessage([]),
      assistantMessageEvent: { type: "text_delta", delta: "好的，这是一段示例回复。" }
    },
    {
      type: "message_end",
      message: assistantMessage([{ type: "text", text: "好的，这是一段示例回复。" }])
    }
  ] as unknown as AgentRunEvent[];
}

/** Deterministic scripted agent for screenshots/dev (MARGINALIA_FAKE_AGENT=1). */
export class ScriptedFakeAgentClient implements AgentClient {
  private readonly fake = new FakeAgentClient();

  resolveApproval(sessionId: string, approvalId: string, decision: ApprovalDecision): boolean {
    return this.fake.resolveApproval(sessionId, approvalId, decision);
  }

  cancelPending(sessionId: string): number {
    return this.fake.cancelPending(sessionId);
  }

  run(input: AgentRunInput): Promise<AgentRunResult> {
    const script = input.message.includes("approval-bash")
      ? bashApprovalScript(input.sessionId)
      : input.message.includes("approval-edit")
        ? editApprovalScript(input.sessionId)
        : plainScript();
    this.fake.enqueueEvents(script);
    return this.fake.run(input);
  }
}
```

`index.ts` 接线（先读该文件，在 `createApp(...)` 调用处按其现有结构插入）：

```ts
import { ScriptedFakeAgentClient } from "./agent/scripted-fake-agent.js";
const agentClient =
  process.env.MARGINALIA_FAKE_AGENT === "1" ? new ScriptedFakeAgentClient() : undefined;
// createApp({ ...既有参数, agentClient })
```

Run: `pnpm --filter @marginalia/pi-server test -- scripted-fake-agent`
Expected: PASS

- [ ] **Step 3: 新增截图场景 approval-flow**

**架构前提（评审已核实）**：`verify-screenshots.mjs` 是**单 harness 架构**——`withHarness`→`startHarness()` 整轮只启动一次 Electron（约 875-885 行），主循环所有场景共享同一 ctx，env 在约 289 行一次性烘焙；pi-server 由 `utilityProcess.fork` 继承 Electron 主进程 env。因此**不能**用"场景级 env 字段被共享循环消费"的做法，也不能全局设 `MARGINALIA_FAKE_AGENT=1`（会污染 seeded-workspace / minimax-live 等真 agent 场景）。

正确做法（生命周期改动）：

1. `startHarness()` 增加可选参数 `extraEnv`，合并进约 289 行构造的 env 对象；`withHarness` 透传。
2. 主循环把场景按 `scenario.env` 分组：无 env 的场景走现有共享 harness pass；声明了 `env` 的场景（目前只有 approval-flow）在共享 pass 结束后**各自独立跑一个 `withHarness(scenario.env, …)` pass**。
3. `SCENARIOS` 注册（`env` 字段由上述分组逻辑消费）：

```js
"approval-flow": {
  description: "Approval cards: command pending/approved, edit diff pending, denied with reason.",
  default: true,
  env: { MARGINALIA_FAKE_AGENT: "1" },
  expected: [
    "approval-command-pending",
    "approval-command-approved",
    "approval-edit-pending",
    "approval-denied"
  ],
  run: scenarioApprovalFlow
}
```

场景函数（沿用 `scenarioSeededWorkspace` 的辅助函数风格；选择器以实际 i18n 文案为准）：

```js
async function scenarioApprovalFlow(ctx) {
  await ensureSeededWorkspace(ctx);
  await resetUiState(ctx.page);
  await reloadApp(ctx.page);
  await goNewChat(ctx.page);

  // 1) 命令审批：pending → approved
  await typeAndSend(ctx.page, "approval-bash demo");
  await ctx.page.getByText(/需要审批|Approval required/).waitFor({ timeout: 10000 });
  await capture(ctx, "approval-flow", "approval-command-pending");
  await ctx.page.getByRole("button", { name: /允许|Allow/ }).click();
  await ctx.page.getByText(/已批准|Approved|分析完成/).waitFor({ timeout: 10000 });
  await capture(ctx, "approval-flow", "approval-command-approved");

  // 2) 编辑审批：diff pending
  await typeAndSend(ctx.page, "approval-edit demo");
  await ctx.page
    .getByText(/近似预览|摘要\.md/)
    .first()
    .waitFor({ timeout: 10000 });
  await capture(ctx, "approval-flow", "approval-edit-pending");

  // 3) 拒绝 + 理由
  await ctx.page.getByRole("button", { name: /拒绝|Deny/ }).click();
  await ctx.page.getByRole("textbox").last().fill("先给我看结论");
  await ctx.page.getByRole("button", { name: /确认拒绝|Confirm deny/ }).click();
  await ctx.page.getByText(/已拒绝|Denied/).waitFor({ timeout: 10000 });
  await capture(ctx, "approval-flow", "approval-denied");
}
```

（`typeAndSend` 若不存在，参照既有场景里向 composer 输入并提交的写法内联实现。）

Run: `pnpm --filter @marginalia/desktop run verify:screenshots -- --scenario approval-flow`
Expected: 4 张截图生成且与预期 UI 一致（人工过目每一张）。

- [ ] **Step 4: 文档同步**

- `docs/user/concepts.md`：非目标列表删除「不内置 bash、终端、PTY 或系统命令执行」，改为「命令执行采用副作用分级审批（见使用指南）；不做完整终端/PTY 体验」；术语表加一行 `Approval`（含义：ask 档下对副作用操作的逐条批准记录；状态：✅ 已实现）。
- `docs/developer/api.md`：新增 `POST /sessions/:sessionId/approvals/:approvalId`、`GET /sessions/:sessionId/approvals` 与两类新 SSE envelope 的 schema 说明。
- `docs/user/guide.md`：新增「审批」小节——三档权限语义表（readonly/ask/full）、命令卡与 diff 卡的操作说明、拒绝附理由的行为。
- `README.md`：核心特性列表加一条「🛡️ **副作用审批**：ask 档下命令与文件变更逐条批准，diff 预览后落盘」。
- `docs/developer/development.md`：注明 `MARGINALIA_FAKE_AGENT=1` 仅用于截图/开发调试。

- [ ] **Step 5: 视觉回归门 + 提交**

```bash
pnpm --filter @marginalia/desktop typecheck && pnpm --filter @marginalia/pi-server typecheck
pnpm test && pnpm lint && pnpm format:check
pnpm verify:visual   # 每张 changed 逐一判断；新场景基线用 --update-baseline --reason "P1-A approval UI baseline"
git add apps/pi-server/src/agent/scripted-fake-agent.ts apps/pi-server/src/index.ts \
  apps/pi-server/test/scripted-fake-agent.test.ts apps/desktop/scripts/verify-screenshots.mjs \
  docs/user/concepts.md docs/developer/api.md docs/user/guide.md README.md docs/developer/development.md
git commit -m "feat(desktop): approval screenshot scenario + scripted fake agent + docs"
```

---

## 完成定义（Plan A 收口）

1. `pnpm test`、`pnpm typecheck`、`pnpm lint`、`pnpm format:check` 全绿。
2. `ask` 档真实运行（非 fake）验证一次：在测试 workspace 让 agent 写一个已存在文件 → 审批卡出现 → 拒绝附理由 → 模型收到理由继续；批准路径文件落盘。
3. `pnpm verify:visual` 通过，approval-flow 四张截图 blessed。
4. 重开会话后审批终态可见（denied 理由保留）。
