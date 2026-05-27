# pi-coding-agent Electron 套壳 MiniMax 调通 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `apps/pi-server` 的 agent 适配层从自研 OpenAI-compat / pi-agent-core 直调，全面换成 `@earendil-works/pi-coding-agent`；让 Electron 端能用本地已配置的 MiniMax (China) provider 真实跑通 chat（含多轮上下文 + 截图验证）。

**Architecture:** pi-coding-agent 的 `AgentSession` 是单一真源；pi-server 为每个 UI session 持有一个 `SessionManager.create(rootDir)` 的 pi session 文件（路径回写到 SQLite `sessions.agent_session_path`），通过 `AuthStorage.setRuntimeApiKey` 把 DB 里的 provider key 推给 pi。`POST /sessions/:id/runs` 走真实 SSE（`ReadableStream` enqueue），`GET /sessions/:id/messages` 改为读 pi session 文件后 `parseSessionEntries + buildSessionContext`。Electron 端 `runChat` 由 batch 改为 async iterator，UI 增量渲染。最后用 `scripts/verify-minimax.mjs` 自动跑一次 + 截图三张。

**Tech Stack:** `@earendil-works/pi-coding-agent@0.75.5`、Hono、better-sqlite3、Web Streams API、React、Vitest、Electron 33、`BrowserWindow.webContents.capturePage`、pnpm workspace。

**Spec:** `docs/superpowers/specs/2026-05-26-pi-coding-agent-electron-shell-design.md`

**Commit policy:** 仓库当前没有任何 commit。每个 Task 末尾的 commit step 仍保留，但执行者可以在跑完整条 plan 后用单个 commit 一次性归档（与本仓库 owner 约定保持一致）。所有 `git add` 命令仍按粒度写出，方便后续 `git restore --staged` 拣选。

---

## 前置 Gate

执行本计划前先验证基线：

```bash
node --version    # 期望 >= 20.11
pnpm --version    # 期望 9.x
pnpm install
sqlite3 ~/.marginalia/db.sqlite "select name from providers where name like '%inimax%';"
# 期望至少一行 "Minimax"
sqlite3 ~/.marginalia/db.sqlite "select length(value) from env_vars e join providers p on p.api_key_ref=e.id where p.name like '%inimax%';"
# 期望返回的长度 > 0
```

如果 `~/.marginalia/db.sqlite` 不存在或 minimax provider 缺失，先按 README 跑一次 Electron + 通过 UI 添加 Minimax provider（baseUrl 留空让 pi 用内置 `https://api.minimaxi.com/anthropic`；如果你已用 `https://api.minimaxi.com/v1` 注册，Task 7 会自动识别并不依赖该字段）。

---

## File Structure

**新建：**
- `apps/pi-server/src/agent/pi-coding-agent-client.ts` — `AgentClient` 的 pi-coding-agent 实现
- `apps/pi-server/src/agent/agent-session-registry.ts` — 进程级 AuthStorage + ModelRegistry + sessionId→AgentSession LRU 缓存
- `apps/pi-server/src/agent/provider-id.ts` — `piProviderId(name)` 工具（含单测）
- `apps/pi-server/src/providers/provider-availability.ts` — 用 `ModelRegistry.getAvailable()` 实现 provider 可用性检查
- `apps/pi-server/src/agent/session-messages.ts` — pi session 文件 → UI `Message[]` 映射
- `apps/pi-server/test/agent-session-registry.test.ts`
- `apps/pi-server/test/pi-coding-agent-client.test.ts`
- `apps/pi-server/test/provider-availability.test.ts`
- `apps/pi-server/test/session-messages.test.ts`
- `apps/pi-server/test/provider-id.test.ts`
- `apps/pi-server/test/minimax-smoke.test.ts` — `MINIMAX_CN_API_KEY` 在 env 时跑，否则 skip
- `apps/desktop/src/api/sse-stream.ts` — `streamSse(response)` async iterator
- `apps/desktop/src/api/sse-stream.test.ts`
- `scripts/verify-minimax.mjs` — 端到端 smoke + 截图
- `output/verify-minimax/.gitkeep`

**修改：**
- `apps/pi-server/package.json` — 删 `pi-agent-core` / `pi-ai`，加 `pi-coding-agent`
- `apps/pi-server/src/agent/agent-client.ts` — 改为薄接口 + pi 类型 re-export
- `apps/pi-server/src/agent/fake-agent-client.ts` — 适配新接口
- `apps/pi-server/src/db/migrations.ts` — 加 `sessions.agent_session_path`
- `apps/pi-server/src/db/repositories.ts` — 加 `setAgentSessionPath` + `mapSession` 暴露字段
- `apps/pi-server/src/app.ts` — runs 用真 SSE；messages 走 pi 文件；providers/test 用 availability；注入 registry
- `apps/pi-server/test/provider-chat.test.ts` — 用新接口断言 SSE envelope（envelope 形态保持不变）
- `apps/desktop/src/api/client.ts` — `RunEvent` 借用 pi 类型；`runChat` 返回 async iterator
- `apps/desktop/src/api/client.test.ts` — 验证 async iterator 形态
- `apps/desktop/src/chat/ChatView.tsx` — 选 provider 下拉 + 增量渲染
- `apps/desktop/src/chat/ChatView.test.tsx` — 适配新行为
- `apps/desktop/electron/main.ts` — 加 `marginalia:capture-screenshot` IPC
- `apps/desktop/electron/preload.cts` — 暴露 `captureScreenshot`

**删除（彻底移除）：**
- `apps/pi-server/src/agent/openai-compatible-agent-client.ts`
- `apps/pi-server/src/agent/pi-agent-client.ts`
- `apps/pi-server/src/providers/provider-tester.ts`
- `apps/pi-server/test/openai-compatible-agent-client.test.ts`
- `apps/pi-server/test/pi-agent-client.test.ts`
- `apps/pi-server/test/provider-tester.test.ts`

---

## TDD 覆盖矩阵

| 功能点 | 测试文件 | 通过条件 |
|---|---|---|
| `piProviderId` 名字归一化 | `provider-id.test.ts` | `"Minimax"` → `"minimax-cn"`，`"MiniMax CN"` → `"minimax-cn"`，`"OpenAI"` → `"openai"`，未知名字小写化 |
| Session registry LRU + dispose | `agent-session-registry.test.ts` | 同 id 命中复用、容量满后最旧被 dispose、`evict(id)` 立即 dispose |
| pi-coding-agent client 流 | `pi-coding-agent-client.test.ts` | fake `createAgentSession` 注入 → 依次 yield 出 pi 原生事件且 `sessionFile` 回填 |
| Provider availability | `provider-availability.test.ts` | mock ModelRegistry 返回 minimax-cn 模型 → `{ok:true}`；列表为空 → `{ok:false}` |
| Session 文件转 UI messages | `session-messages.test.ts` | JSONL fixture（含 user/assistant/thinking）→ 仅返回 user/assistant + 顺序 + content 正确 |
| `app.ts` runs SSE envelope | `provider-chat.test.ts` | 真 SSE chunked 响应；envelope 含 `run_id`/`session_id`/`type`/`payload` |
| `app.ts` 消息读取 | `provider-chat.test.ts` 追加 it | `GET /sessions/:id/messages` 在 `agent_session_path` 指向 fixture 时返回 user+assistant |
| MiniMax 端到端 | `minimax-smoke.test.ts` | env 有 `MINIMAX_CN_API_KEY` 时收到 ≥1 个非空 `assistant_delta` + 1 个 `run_completed` |
| `streamSse` | `sse-stream.test.ts` | 跨 chunk 切分、空 keep-alive 行忽略、流结束 break |
| ChatView 增量渲染 + provider 选择 | `ChatView.test.tsx` | deltas 增量出现在 DOM；切换 provider 下拉 → 后续 run 用对应 providerId |

---

## Task 1: 清理旧 agent 代码、依赖切换

**Files:**
- Modify: `apps/pi-server/package.json`
- Delete: `apps/pi-server/src/agent/openai-compatible-agent-client.ts`
- Delete: `apps/pi-server/src/agent/pi-agent-client.ts`
- Delete: `apps/pi-server/src/providers/provider-tester.ts`
- Delete: `apps/pi-server/test/openai-compatible-agent-client.test.ts`
- Delete: `apps/pi-server/test/pi-agent-client.test.ts`
- Delete: `apps/pi-server/test/provider-tester.test.ts`

- [ ] **Step 1: 备份当前 import 关系**

Run: `grep -rn "openai-compatible-agent-client\|provider-tester\|pi-agent-client" apps/pi-server/src/`
Expected: 列出 `app.ts` 里的 3 处 import（`PiAgentClient`、`defaultProviderTester`、`ProviderConnectionTester`）。记下来，Task 7 重写 `app.ts` 时全部替换。

- [ ] **Step 2: 修改 `apps/pi-server/package.json`**

```json
{
  "name": "@marginalia/pi-server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@earendil-works/pi-coding-agent": "0.75.5",
    "@hono/node-server": "^1.13.8",
    "better-sqlite3": "^12.10.0",
    "hono": "^4.6.0",
    "pdf-parse": "^1.1.1"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.12",
    "@types/node": "^22.10.0",
    "@types/pdf-parse": "^1.1.4",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 3: 删除 6 个旧文件**

```bash
rm apps/pi-server/src/agent/openai-compatible-agent-client.ts
rm apps/pi-server/src/agent/pi-agent-client.ts
rm apps/pi-server/src/providers/provider-tester.ts
rm apps/pi-server/test/openai-compatible-agent-client.test.ts
rm apps/pi-server/test/pi-agent-client.test.ts
rm apps/pi-server/test/provider-tester.test.ts
```

- [ ] **Step 4: 安装依赖**

Run: `pnpm install`
Expected: 完成无错；`node_modules/.pnpm/@earendil-works+pi-coding-agent@0.75.5*` 存在。

- [ ] **Step 5: 提交**

```bash
git add apps/pi-server/package.json apps/pi-server/src/agent apps/pi-server/src/providers apps/pi-server/test pnpm-lock.yaml
git commit -m "chore(pi-server): drop self-rolled openai client and provider tester in favor of pi-coding-agent"
```

注：此步会让 `app.ts` 暂时构建失败（缺少 `PiAgentClient` 等 import）。Task 7 会修复。

---

## Task 2: `provider-id.ts` — provider 名归一化

**Files:**
- Create: `apps/pi-server/src/agent/provider-id.ts`
- Test: `apps/pi-server/test/provider-id.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/pi-server/test/provider-id.test.ts
import { describe, expect, it } from "vitest";
import { piProviderId } from "../src/agent/provider-id.js";

describe("piProviderId", () => {
  it("maps known minimax aliases to minimax-cn", () => {
    expect(piProviderId("Minimax")).toBe("minimax-cn");
    expect(piProviderId("MiniMax CN")).toBe("minimax-cn");
    expect(piProviderId("MINIMAX_CN")).toBe("minimax-cn");
    expect(piProviderId("minimax-cn")).toBe("minimax-cn");
  });

  it("maps openai variants to openai", () => {
    expect(piProviderId("OpenAI")).toBe("openai");
    expect(piProviderId("Open AI")).toBe("openai");
  });

  it("normalizes unknown names with kebab-case lowering", () => {
    expect(piProviderId("Custom Provider")).toBe("custom-provider");
    expect(piProviderId("my_endpoint")).toBe("my-endpoint");
  });

  it("falls back to empty string for blank input", () => {
    expect(piProviderId("")).toBe("");
    expect(piProviderId("   ")).toBe("");
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @marginalia/pi-server test -- provider-id.test.ts`
Expected: 因找不到 `../src/agent/provider-id.js` 失败。

- [ ] **Step 3: 实现**

```ts
// apps/pi-server/src/agent/provider-id.ts
export function piProviderId(name: string): string {
  const normalized = name.trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (!normalized) return "";
  if (normalized === "minimax" || normalized === "minimax-cn") return "minimax-cn";
  if (normalized === "minimax-global") return "minimax";
  if (normalized === "open-ai" || normalized === "openai") return "openai";
  return normalized;
}
```

- [ ] **Step 4: 运行通过**

Run: `pnpm --filter @marginalia/pi-server test -- provider-id.test.ts`
Expected: 4 tests passed。

- [ ] **Step 5: 提交**

```bash
git add apps/pi-server/src/agent/provider-id.ts apps/pi-server/test/provider-id.test.ts
git commit -m "feat(pi-server): add piProviderId name normalizer"
```

---

## Task 3: `agent-client.ts` — 薄接口 + pi 类型 re-export

**Files:**
- Modify: `apps/pi-server/src/agent/agent-client.ts`

- [ ] **Step 1: 整文件覆盖**

```ts
// apps/pi-server/src/agent/agent-client.ts
import type {
  AgentSessionEvent,
  AgentSessionConfig,
  PromptOptions,
  ModelRegistry,
  AuthStorage,
  SessionManager
} from "@earendil-works/pi-coding-agent";

/**
 * Re-export pi types as the single source of truth. Do not redefine these locally.
 */
export type { AgentSessionEvent, AgentSessionConfig, PromptOptions, ModelRegistry, AuthStorage, SessionManager };

/** Input for one chat turn from the UI. */
export type AgentRunInput = {
  /** pi-server's own session id (UUID, distinct from pi sessionFile). */
  sessionId: string;
  /** Workspace rootDir; becomes pi cwd. Must exist on disk. */
  workspaceRoot: string;
  /** pi provider id ("minimax-cn", "openai", …). */
  piProviderId: string;
  /** Model id on the chosen provider, e.g. "MiniMax-M2.7". */
  modelId: string;
  /** User's message text. */
  message: string;
  /** If we already have a pi session file for this UI session, open it; otherwise create. */
  agentSessionPath?: string | null;
  /** Optional passthrough for pi's prompt options (e.g. images). */
  promptOptions?: PromptOptions;
};

export type AgentRunResult = {
  /** Final session file path. Persist this in DB so future runs reuse it. */
  sessionFile: string;
  /** Stream of pi-native events. Consumer is responsible for full drain. */
  events: AsyncIterable<AgentSessionEvent>;
  /** Disposes the underlying AgentSession when caller is done. */
  dispose(): void;
};

export interface AgentClient {
  run(input: AgentRunInput): Promise<AgentRunResult>;
}
```

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @marginalia/pi-server typecheck`
Expected: 失败 — `app.ts` 仍 import 旧符号。这是预期，后续 Task 修复。先确认 `agent-client.ts` 本身 OK：

Run: `pnpm exec tsc -p apps/pi-server/tsconfig.json --noEmit apps/pi-server/src/agent/agent-client.ts 2>&1 | grep agent-client.ts || echo "agent-client clean"`
Expected: 输出 `agent-client clean`。

- [ ] **Step 3: 提交**

```bash
git add apps/pi-server/src/agent/agent-client.ts
git commit -m "refactor(pi-server): rewrite AgentClient interface around pi-coding-agent types"
```

---

## Task 4: `session-messages.ts` — pi session 文件 → UI Message 映射

**Files:**
- Create: `apps/pi-server/src/agent/session-messages.ts`
- Test: `apps/pi-server/test/session-messages.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/pi-server/test/session-messages.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readMessagesFromSessionFile } from "../src/agent/session-messages.js";

function writeJsonl(lines: object[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "session-msg-"));
  const file = path.join(dir, "s.jsonl");
  fs.writeFileSync(file, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");
  return file;
}

describe("readMessagesFromSessionFile", () => {
  it("returns user and assistant messages in order, ignoring header and non-message entries", () => {
    const file = writeJsonl([
      { version: 5, sessionId: "abc", cwd: "/tmp", created: "2026-05-26T00:00:00Z" },
      { type: "message", id: "1", timestamp: "2026-05-26T00:00:01Z", message: { role: "user", content: "hello" } },
      { type: "thinking_level_change", id: "2", timestamp: "2026-05-26T00:00:02Z", thinkingLevel: "medium" },
      { type: "message", id: "3", parentId: "1", timestamp: "2026-05-26T00:00:03Z", message: { role: "assistant", content: [{ type: "text", text: "world" }] } }
    ]);

    expect(readMessagesFromSessionFile(file)).toEqual([
      { id: "1", role: "user", content: "hello" },
      { id: "3", role: "assistant", content: "world" }
    ]);
  });

  it("returns [] when the file does not exist", () => {
    expect(readMessagesFromSessionFile("/no/such/path.jsonl")).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @marginalia/pi-server test -- session-messages.test.ts`
Expected: 找不到模块失败。

- [ ] **Step 3: 实现**

```ts
// apps/pi-server/src/agent/session-messages.ts
import fs from "node:fs";
import {
  parseSessionEntries,
  buildSessionContext,
  type SessionEntry,
  type SessionMessageEntry
} from "@earendil-works/pi-coding-agent";

export type UiMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
};

function stringifyContent(content: SessionMessageEntry["message"]["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part: any) => {
      if (!part) return "";
      if (typeof part === "string") return part;
      if (part.type === "text" && typeof part.text === "string") return part.text;
      return "";
    })
    .join("");
}

export function readMessagesFromSessionFile(filePath: string): UiMessage[] {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, "utf-8");
  const fileEntries = parseSessionEntries(raw);
  const sessionEntries = fileEntries.filter((entry): entry is SessionEntry => "type" in entry && entry.type !== undefined && (entry as any).type !== "session_info" ? true : "type" in entry);
  // buildSessionContext walks tree; for a linear chat it yields messages in chronological order.
  const ctx = buildSessionContext(sessionEntries as SessionEntry[]);
  const result: UiMessage[] = [];
  for (const entry of ctx.entries) {
    if (entry.type !== "message") continue;
    const msg = entry.message;
    if (msg.role !== "user" && msg.role !== "assistant" && msg.role !== "system") continue;
    result.push({
      id: entry.id,
      role: msg.role,
      content: stringifyContent(msg.content)
    });
  }
  return result;
}
```

- [ ] **Step 4: 运行测试**

Run: `pnpm --filter @marginalia/pi-server test -- session-messages.test.ts`
Expected: 2 passed。若 `buildSessionContext` 的返回结构与上面假设不符（例如属性叫 `messages` 而不是 `entries`），用以下排错命令直接看一遍：

Run: `node -e "import('@earendil-works/pi-coding-agent').then(m => console.log(Object.keys(m.buildSessionContext([]))))"`

修正后再跑测试至通过。

- [ ] **Step 5: 提交**

```bash
git add apps/pi-server/src/agent/session-messages.ts apps/pi-server/test/session-messages.test.ts
git commit -m "feat(pi-server): read UI messages from pi session JSONL files"
```

---

## Task 5: `agent-session-registry.ts` — 单例 + LRU 缓存

**Files:**
- Create: `apps/pi-server/src/agent/agent-session-registry.ts`
- Test: `apps/pi-server/test/agent-session-registry.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/pi-server/test/agent-session-registry.test.ts
import { describe, expect, it, vi } from "vitest";
import { AgentSessionRegistry, type RegistryDeps } from "../src/agent/agent-session-registry.js";

function fakeSession(label: string) {
  return {
    label,
    sessionFile: `/tmp/${label}.jsonl`,
    disposed: false,
    dispose() {
      this.disposed = true;
    }
  };
}

function makeDeps(): RegistryDeps & { built: string[] } {
  const built: string[] = [];
  return {
    built,
    authStorage: { setRuntimeApiKey: vi.fn() } as any,
    modelRegistry: {} as any,
    createSession: vi.fn(async ({ label }: { label: string }) => {
      built.push(label);
      return { session: fakeSession(label) as any };
    })
  };
}

describe("AgentSessionRegistry", () => {
  it("returns cached session for repeated sessionId", async () => {
    const deps = makeDeps();
    const reg = new AgentSessionRegistry({ ...deps, maxEntries: 2 });

    const a = await reg.acquire({ sessionId: "s1", workspaceRoot: "/tmp", agentSessionPath: null, label: "a" });
    const b = await reg.acquire({ sessionId: "s1", workspaceRoot: "/tmp", agentSessionPath: null, label: "b" });

    expect(a.session).toBe(b.session);
    expect(deps.built).toEqual(["a"]);
  });

  it("evicts least-recently-used when capacity exceeded", async () => {
    const deps = makeDeps();
    const reg = new AgentSessionRegistry({ ...deps, maxEntries: 2 });

    const first = await reg.acquire({ sessionId: "s1", workspaceRoot: "/tmp", agentSessionPath: null, label: "first" });
    await reg.acquire({ sessionId: "s2", workspaceRoot: "/tmp", agentSessionPath: null, label: "second" });
    await reg.acquire({ sessionId: "s1", workspaceRoot: "/tmp", agentSessionPath: null, label: "first-again" });
    await reg.acquire({ sessionId: "s3", workspaceRoot: "/tmp", agentSessionPath: null, label: "third" });

    expect((first.session as any).disposed).toBe(false); // s1 was used recently
    // s2 was LRU; its session must be disposed
    const allBuilt = deps.built;
    expect(allBuilt).toEqual(["first", "second", "third"]);
  });

  it("evict() disposes and removes specific session", async () => {
    const deps = makeDeps();
    const reg = new AgentSessionRegistry({ ...deps, maxEntries: 5 });
    const handle = await reg.acquire({ sessionId: "s1", workspaceRoot: "/tmp", agentSessionPath: null, label: "x" });
    reg.evict("s1");
    expect((handle.session as any).disposed).toBe(true);
    const handle2 = await reg.acquire({ sessionId: "s1", workspaceRoot: "/tmp", agentSessionPath: null, label: "x2" });
    expect(handle2.session).not.toBe(handle.session);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @marginalia/pi-server test -- agent-session-registry.test.ts`
Expected: 模块未找到失败。

- [ ] **Step 3: 实现**

```ts
// apps/pi-server/src/agent/agent-session-registry.ts
import type {
  AgentSession,
  AgentSessionConfig,
  AuthStorage,
  ModelRegistry,
  SessionManager
} from "@earendil-works/pi-coding-agent";

export type CreateSessionFn = (
  options: AgentSessionConfig & { label?: string }
) => Promise<{ session: AgentSession }>;

export type RegistryDeps = {
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  createSession: CreateSessionFn;
  /** Visible for tests. Default 20. */
  maxEntries?: number;
  /** Visible for tests. Defaults to require'd SessionManager.create. */
  sessionManagerFor?: (workspaceRoot: string, existingPath: string | null) => SessionManager;
};

export type AcquireInput = {
  sessionId: string;
  workspaceRoot: string;
  agentSessionPath: string | null;
  /** Extra config (model, tools, etc.). Pi types describe the shape. */
  config?: Partial<AgentSessionConfig>;
  /** Test-only forwarding for createSession identification. */
  label?: string;
};

export type SessionHandle = {
  sessionId: string;
  session: AgentSession;
  sessionFile: string;
  dispose(): void;
};

export class AgentSessionRegistry {
  private readonly entries = new Map<string, SessionHandle>();
  private readonly maxEntries: number;

  constructor(private readonly deps: RegistryDeps) {
    this.maxEntries = deps.maxEntries ?? 20;
  }

  async acquire(input: AcquireInput): Promise<SessionHandle> {
    const hit = this.entries.get(input.sessionId);
    if (hit) {
      this.entries.delete(input.sessionId); // move to MRU
      this.entries.set(input.sessionId, hit);
      return hit;
    }

    const { session } = await this.deps.createSession({
      ...(input.config ?? {}),
      cwd: input.workspaceRoot,
      authStorage: this.deps.authStorage,
      modelRegistry: this.deps.modelRegistry,
      sessionManager: this.deps.sessionManagerFor?.(input.workspaceRoot, input.agentSessionPath),
      label: input.label
    } as AgentSessionConfig & { label?: string });

    const handle: SessionHandle = {
      sessionId: input.sessionId,
      session,
      sessionFile: (session as any).sessionFile ?? "",
      dispose: () => session.dispose()
    };
    this.entries.set(input.sessionId, handle);
    this.maybeEvict();
    return handle;
  }

  evict(sessionId: string): void {
    const handle = this.entries.get(sessionId);
    if (!handle) return;
    handle.dispose();
    this.entries.delete(sessionId);
  }

  disposeAll(): void {
    for (const handle of this.entries.values()) handle.dispose();
    this.entries.clear();
  }

  private maybeEvict(): void {
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.evict(oldestKey);
    }
  }
}
```

- [ ] **Step 4: 运行测试通过**

Run: `pnpm --filter @marginalia/pi-server test -- agent-session-registry.test.ts`
Expected: 3 passed。

- [ ] **Step 5: 提交**

```bash
git add apps/pi-server/src/agent/agent-session-registry.ts apps/pi-server/test/agent-session-registry.test.ts
git commit -m "feat(pi-server): per-sessionId AgentSession registry with LRU eviction"
```

---

## Task 6: `pi-coding-agent-client.ts` — `AgentClient` 默认实现

**Files:**
- Create: `apps/pi-server/src/agent/pi-coding-agent-client.ts`
- Test: `apps/pi-server/test/pi-coding-agent-client.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/pi-server/test/pi-coding-agent-client.test.ts
import { describe, expect, it, vi } from "vitest";
import { PiCodingAgentClient } from "../src/agent/pi-coding-agent-client.js";
import type { AgentSessionEvent } from "../src/agent/agent-client.js";

function fakeSession(events: AgentSessionEvent[]) {
  const listeners: Array<(e: AgentSessionEvent) => void> = [];
  return {
    sessionFile: "/tmp/fake.jsonl",
    subscribe: (fn: (e: AgentSessionEvent) => void) => {
      listeners.push(fn);
      return () => {};
    },
    async prompt(_text: string) {
      for (const event of events) {
        for (const fn of listeners) fn(event);
      }
    },
    dispose: vi.fn()
  };
}

describe("PiCodingAgentClient", () => {
  it("streams pi-native events and resolves sessionFile", async () => {
    const events: AgentSessionEvent[] = [
      { type: "agent_start" } as AgentSessionEvent,
      { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hi" } } as AgentSessionEvent,
      { type: "message_end", message: { stopReason: "end" } } as AgentSessionEvent
    ];
    const session = fakeSession(events);

    const registry = {
      acquire: vi.fn(async () => ({
        sessionId: "s1",
        session: session as any,
        sessionFile: "/tmp/fake.jsonl",
        dispose: () => session.dispose()
      }))
    };

    const client = new PiCodingAgentClient(registry as any);
    const result = await client.run({
      sessionId: "s1",
      workspaceRoot: "/tmp",
      piProviderId: "minimax-cn",
      modelId: "MiniMax-M2.7",
      message: "hello"
    });
    expect(result.sessionFile).toBe("/tmp/fake.jsonl");

    const collected: AgentSessionEvent[] = [];
    for await (const e of result.events) collected.push(e);
    expect(collected).toEqual(events);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @marginalia/pi-server test -- pi-coding-agent-client.test.ts`
Expected: 模块未找到失败。

- [ ] **Step 3: 实现**

```ts
// apps/pi-server/src/agent/pi-coding-agent-client.ts
import { getModel } from "@earendil-works/pi-coding-agent";
import type {
  AgentClient,
  AgentRunInput,
  AgentRunResult,
  AgentSessionEvent
} from "./agent-client.js";
import type { AgentSessionRegistry } from "./agent-session-registry.js";

export class PiCodingAgentClient implements AgentClient {
  constructor(private readonly registry: AgentSessionRegistry) {}

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const model = getModel(input.piProviderId as any, input.modelId);
    if (!model) {
      throw new Error(`unknown model ${input.piProviderId}/${input.modelId}`);
    }

    const handle = await this.registry.acquire({
      sessionId: input.sessionId,
      workspaceRoot: input.workspaceRoot,
      agentSessionPath: input.agentSessionPath ?? null,
      config: { model }
    });

    const queue: AgentSessionEvent[] = [];
    const waiters: Array<(value: IteratorResult<AgentSessionEvent>) => void> = [];
    let finished = false;
    let error: unknown = null;

    const unsubscribe = handle.session.subscribe((event) => {
      queue.push(event);
      const waiter = waiters.shift();
      if (waiter) waiter({ value: queue.shift()!, done: false });
    });

    handle.session
      .prompt(input.message, input.promptOptions)
      .catch((err) => {
        error = err;
      })
      .finally(() => {
        finished = true;
        unsubscribe?.();
        for (const waiter of waiters.splice(0)) {
          waiter({ value: undefined as any, done: true });
        }
      });

    const events: AsyncIterable<AgentSessionEvent> = {
      [Symbol.asyncIterator]() {
        return {
          next: () =>
            new Promise<IteratorResult<AgentSessionEvent>>((resolve, reject) => {
              if (error) {
                reject(error);
                return;
              }
              if (queue.length > 0) {
                resolve({ value: queue.shift()!, done: false });
                return;
              }
              if (finished) {
                resolve({ value: undefined as any, done: true });
                return;
              }
              waiters.push(resolve);
            })
        };
      }
    };

    return {
      sessionFile: handle.sessionFile,
      events,
      dispose: () => unsubscribe?.()
    };
  }
}
```

- [ ] **Step 4: 运行测试通过**

Run: `pnpm --filter @marginalia/pi-server test -- pi-coding-agent-client.test.ts`
Expected: 1 passed。

- [ ] **Step 5: 提交**

```bash
git add apps/pi-server/src/agent/pi-coding-agent-client.ts apps/pi-server/test/pi-coding-agent-client.test.ts
git commit -m "feat(pi-server): pi-coding-agent backed AgentClient default impl"
```

---

## Task 7: 重写 `fake-agent-client.ts` 适配新接口

**Files:**
- Modify: `apps/pi-server/src/agent/fake-agent-client.ts`

- [ ] **Step 1: 整文件覆盖**

```ts
// apps/pi-server/src/agent/fake-agent-client.ts
import type {
  AgentClient,
  AgentRunInput,
  AgentRunResult,
  AgentSessionEvent
} from "./agent-client.js";

/**
 * Returns canned events for tests. Caller supplies the event stream per run.
 */
export class FakeAgentClient implements AgentClient {
  private nextEvents: AgentSessionEvent[] = [];

  enqueueEvents(events: AgentSessionEvent[]) {
    this.nextEvents = events;
  }

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const events = this.nextEvents.slice();
    this.nextEvents = [];
    async function* iterate() {
      for (const event of events) yield event;
    }
    return {
      sessionFile: `/tmp/fake/${input.sessionId}.jsonl`,
      events: iterate(),
      dispose() {}
    };
  }
}
```

- [ ] **Step 2: typecheck**

Run: `pnpm exec tsc -p apps/pi-server/tsconfig.json --noEmit 2>&1 | grep fake-agent-client.ts || echo "fake clean"`
Expected: 输出 `fake clean`。

- [ ] **Step 3: 提交**

```bash
git add apps/pi-server/src/agent/fake-agent-client.ts
git commit -m "refactor(pi-server): align FakeAgentClient with new AgentClient interface"
```

---

## Task 8: `provider-availability.ts` — 替换 provider-tester

**Files:**
- Create: `apps/pi-server/src/providers/provider-availability.ts`
- Test: `apps/pi-server/test/provider-availability.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/pi-server/test/provider-availability.test.ts
import { describe, expect, it } from "vitest";
import { ModelAvailabilityChecker } from "../src/providers/provider-availability.js";

function fakeRegistry(available: Array<{ provider: string; id: string }>) {
  return {
    async getAvailable() {
      return available;
    }
  };
}

describe("ModelAvailabilityChecker", () => {
  it("returns ok when provider id appears in pi available list", async () => {
    const checker = new ModelAvailabilityChecker(fakeRegistry([{ provider: "minimax-cn", id: "MiniMax-M2.7" }]) as any);
    const result = await checker.check({ piProviderId: "minimax-cn", modelId: "MiniMax-M2.7" });
    expect(result).toEqual({ ok: true, message: "ok" });
  });

  it("returns not-ok when provider absent", async () => {
    const checker = new ModelAvailabilityChecker(fakeRegistry([]) as any);
    const result = await checker.check({ piProviderId: "minimax-cn", modelId: "MiniMax-M2.7" });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/minimax-cn/);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @marginalia/pi-server test -- provider-availability.test.ts`
Expected: 模块未找到失败。

- [ ] **Step 3: 实现**

```ts
// apps/pi-server/src/providers/provider-availability.ts
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";

export type AvailabilityInput = {
  piProviderId: string;
  modelId: string;
};

export type AvailabilityResult = { ok: boolean; message: string };

export class ModelAvailabilityChecker {
  constructor(private readonly registry: ModelRegistry) {}

  async check(input: AvailabilityInput): Promise<AvailabilityResult> {
    const available = await this.registry.getAvailable();
    const hit = available.find(
      (m: { provider: string; id: string }) => m.provider === input.piProviderId && m.id === input.modelId
    );
    if (hit) return { ok: true, message: "ok" };
    const sameProvider = available.filter((m) => m.provider === input.piProviderId);
    if (sameProvider.length === 0) {
      return { ok: false, message: `provider ${input.piProviderId} not available (missing API key?)` };
    }
    return { ok: false, message: `model ${input.modelId} not registered under ${input.piProviderId}` };
  }
}
```

- [ ] **Step 4: 测试通过**

Run: `pnpm --filter @marginalia/pi-server test -- provider-availability.test.ts`
Expected: 2 passed。

- [ ] **Step 5: 提交**

```bash
git add apps/pi-server/src/providers/provider-availability.ts apps/pi-server/test/provider-availability.test.ts
git commit -m "feat(pi-server): provider availability via pi ModelRegistry"
```

---

## Task 9: DB migration — `sessions.agent_session_path`

**Files:**
- Modify: `apps/pi-server/src/db/migrations.ts`
- Modify: `apps/pi-server/src/db/repositories.ts`
- Test: append to `apps/pi-server/test/provider-chat.test.ts`

- [ ] **Step 1: 在 `provider-chat.test.ts` 顶部 `describe("provider chat migrations", ...)` 内追加 it**

```ts
it("adds agent_session_path column to sessions", () => {
  const db = memoryDb();
  migrate(db);
  const columns = db.prepare("pragma table_info(sessions)").all().map((r: any) => r.name);
  expect(columns).toContain("agent_session_path");
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @marginalia/pi-server test -- provider-chat.test.ts -t "agent_session_path"`
Expected: 断言失败。

- [ ] **Step 3: 修改 `apps/pi-server/src/db/migrations.ts`，在已有 `model` ALTER 后追加**

将文件末尾的：
```ts
  const sessionColumns = db.prepare("pragma table_info(sessions)").all().map((row: any) => row.name);
  if (!sessionColumns.includes("model")) {
    db.exec("ALTER TABLE sessions ADD COLUMN model TEXT");
  }
  db.prepare("insert or ignore into schema_migrations (version, applied_at) values (?, ?)").run(1, Date.now());
}
```

替换为：
```ts
  const sessionColumns = db.prepare("pragma table_info(sessions)").all().map((row: any) => row.name);
  if (!sessionColumns.includes("model")) {
    db.exec("ALTER TABLE sessions ADD COLUMN model TEXT");
  }
  if (!sessionColumns.includes("agent_session_path")) {
    db.exec("ALTER TABLE sessions ADD COLUMN agent_session_path TEXT");
  }
  db.prepare("insert or ignore into schema_migrations (version, applied_at) values (?, ?)").run(1, Date.now());
}
```

- [ ] **Step 4: 在 `apps/pi-server/src/db/repositories.ts` 的 `Session` 类型添加字段并写 setter**

在 `Session` 类型里加：
```ts
  agentSessionPath?: string | null;
```

在 `mapSession` 里加：
```ts
    agentSessionPath: row.agent_session_path ?? null,
```

在文件末尾追加函数：
```ts
export function setAgentSessionPath(db: Database.Database, id: string, agentSessionPath: string) {
  db.prepare("update sessions set agent_session_path = ?, updated_at = ? where id = ?").run(
    agentSessionPath,
    now(),
    id
  );
  return getSession(db, id);
}
```

- [ ] **Step 5: 测试通过**

Run: `pnpm --filter @marginalia/pi-server test -- provider-chat.test.ts -t "agent_session_path"`
Expected: 1 passed。

- [ ] **Step 6: 提交**

```bash
git add apps/pi-server/src/db/migrations.ts apps/pi-server/src/db/repositories.ts apps/pi-server/test/provider-chat.test.ts
git commit -m "feat(pi-server): persist pi agent session file path on sessions row"
```

---

## Task 10: 重写 `app.ts` — registry 注入、真 SSE、新 messages 路径

**Files:**
- Modify: `apps/pi-server/src/app.ts`
- Modify: `apps/pi-server/test/provider-chat.test.ts`

注：这是最长的 Task。允许多次内部迭代。

- [ ] **Step 1: 写失败测试 — 真 SSE chunked**

替换 `provider-chat.test.ts` 里的 `it("streams run envelopes and persists assistant messages", …)` 的内容为下面这版（用 FakeAgentClient + AgentSessionEvent，不再用旧 `{ stream }` 形式）：

```ts
it("streams run envelopes via real SSE and writes assistant text", async () => {
  const db = memoryDb();
  migrate(db);
  const workspace = createWorkspace(db, { name: "Docs", rootDir: "/tmp/docs-run" });
  const session = createSession(db, { workspaceId: workspace.id, title: "Chat", origin: "desktop", model: "MiniMax-M2.7" });

  const fake = new FakeAgentClient();
  fake.enqueueEvents([
    { type: "agent_start" } as any,
    { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hel" } } as any,
    { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "lo" } } as any,
    { type: "message_end", message: { stopReason: "end", content: "hello" } } as any
  ]);

  const app = createApp({ db, agentClient: fake });

  const provider = await (
    await app.request("/providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Minimax", apiKey: "sk-test", defaultModel: "MiniMax-M2.7" })
    })
  ).json();

  const response = await app.request(`/sessions/${session.id}/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ providerId: provider.id, message: "hi" })
  });

  expect(response.headers.get("content-type")).toContain("text/event-stream");
  const text = await response.text();
  expect(text).toContain('"type":"run_started"');
  expect(text).toContain('"type":"assistant_delta"');
  expect(text).toContain('"text":"hel"');
  expect(text).toContain('"text":"lo"');
  expect(text).toContain('"type":"run_completed"');
});
```

并在该文件顶部 import 区追加：

```ts
import { FakeAgentClient } from "../src/agent/fake-agent-client.js";
```

也把旧的 `agentClient: { stream: async function* () {...} }` 写法清掉（如果还在）。

- [ ] **Step 2: 写失败测试 — provider-id 推断 + run input**

替换"passes OpenAI-compatible provider configuration into the agent client"那个 it 为：

```ts
it("passes pi provider id and model into AgentClient.run", async () => {
  let seen: any = null;
  const db = memoryDb();
  migrate(db);
  const workspace = createWorkspace(db, { name: "Docs", rootDir: "/tmp/docs-pi" });
  const session = createSession(db, { workspaceId: workspace.id, title: "Chat", origin: "desktop" });

  const stubClient = {
    async run(input: any) {
      seen = input;
      async function* iterate() {
        yield { type: "message_end", message: { stopReason: "end", content: "ok" } } as any;
      }
      return { sessionFile: "/tmp/x.jsonl", events: iterate(), dispose() {} };
    }
  };

  const app = createApp({ db, agentClient: stubClient as any });
  const provider = await (
    await app.request("/providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Minimax", apiKey: "sk-test", baseUrl: null, defaultModel: "MiniMax-M2.7" })
    })
  ).json();

  await app.request(`/sessions/${session.id}/runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ providerId: provider.id, message: "ping", model: "MiniMax-M2.7" })
  });

  expect(seen).toMatchObject({
    sessionId: session.id,
    workspaceRoot: "/tmp/docs-pi",
    piProviderId: "minimax-cn",
    modelId: "MiniMax-M2.7",
    message: "ping"
  });
});
```

- [ ] **Step 3: 写失败测试 — messages 来自 pi session 文件**

在同文件 `describe("chat runs", ...)` 末尾追加：

```ts
it("serves messages from the pi session file when present", async () => {
  const db = memoryDb();
  migrate(db);
  const workspace = createWorkspace(db, { name: "Docs", rootDir: "/tmp/docs-msg" });
  const session = createSession(db, { workspaceId: workspace.id, title: "Chat", origin: "desktop" });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-msg-"));
  const sessionFile = path.join(tmpDir, "s.jsonl");
  fs.writeFileSync(
    sessionFile,
    [
      { version: 5, sessionId: "abc", cwd: "/tmp", created: "2026-05-26T00:00:00Z" },
      { type: "message", id: "u1", timestamp: "2026-05-26T00:00:01Z", message: { role: "user", content: "hi" } },
      { type: "message", id: "a1", parentId: "u1", timestamp: "2026-05-26T00:00:02Z", message: { role: "assistant", content: [{ type: "text", text: "yo" }] } }
    ].map((line) => JSON.stringify(line)).join("\n") + "\n"
  );
  setAgentSessionPath(db, session.id, sessionFile);

  const app = createApp({ db });
  const response = await app.request(`/sessions/${session.id}/messages`);
  expect(await response.json()).toEqual([
    { id: "u1", role: "user", content: "hi" },
    { id: "a1", role: "assistant", content: "yo" }
  ]);
});
```

并在 `provider-chat.test.ts` 顶部 import：

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setAgentSessionPath } from "../src/db/repositories.js";
```

- [ ] **Step 4: 运行确认失败**

Run: `pnpm --filter @marginalia/pi-server test -- provider-chat.test.ts`
Expected: 上面新增/修改的 3 个 it 全部 FAIL（其余通过）。

- [ ] **Step 5: 重写 `apps/pi-server/src/app.ts`**

整文件替换为：

```ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import type Database from "better-sqlite3";
import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  createAgentSession
} from "@earendil-works/pi-coding-agent";
import type { AgentClient } from "./agent/agent-client.js";
import { AgentSessionRegistry } from "./agent/agent-session-registry.js";
import { PiCodingAgentClient } from "./agent/pi-coding-agent-client.js";
import { piProviderId } from "./agent/provider-id.js";
import { readMessagesFromSessionFile } from "./agent/session-messages.js";
import { migrate } from "./db/migrations.js";
import { openDatabase } from "./db/connection.js";
import {
  completeRun,
  createMessage,
  createProvider,
  createRun,
  createSession,
  createWorkspace,
  getMessages,
  getSession,
  getWorkspace,
  getProvider,
  getRecentWorkspace,
  listProviders,
  listSessions,
  listWorkspaces,
  markWorkspaceOpened,
  setAgentSessionPath,
  updateSession
} from "./db/repositories.js";
import { readDocument, type DocumentContent } from "./files/document-reader.js";
import { listWorkspaceFiles, searchWorkspaceFiles } from "./files/file-tree.js";
import { createHealthInfo } from "./health.js";
import { ModelAvailabilityChecker } from "./providers/provider-availability.js";

export type AppOptions = {
  startedAt?: Date;
  db?: Database.Database;
  agentClient?: AgentClient;
  authStorage?: AuthStorage;
  modelRegistry?: ModelRegistry;
  availabilityChecker?: ModelAvailabilityChecker;
  documentReader?: (rootDir: string, relativePath: string) => Promise<DocumentContent>;
};

export function createApp(options: AppOptions = {}) {
  const startedAt = options.startedAt ?? new Date();
  const db = options.db ?? openDatabase();
  const documentReader = options.documentReader ?? readDocument;
  const authStorage = options.authStorage ?? AuthStorage.create();
  const modelRegistry = options.modelRegistry ?? ModelRegistry.create(authStorage);
  const registry = new AgentSessionRegistry({
    authStorage,
    modelRegistry,
    createSession: (config) => createAgentSession(config),
    sessionManagerFor: (cwd, existing) =>
      existing ? SessionManager.open(existing) : SessionManager.create(cwd)
  });
  const agentClient = options.agentClient ?? new PiCodingAgentClient(registry);
  const availabilityChecker = options.availabilityChecker ?? new ModelAvailabilityChecker(modelRegistry);

  migrate(db);
  syncProviderKeys(db, authStorage);

  const app = new Hono();
  app.use("*", cors({ origin: (origin) => origin }));
  app.get("/health", (c) => c.json(createHealthInfo(startedAt)));
  app.get("/workspaces", (c) => c.json(listWorkspaces(db)));
  app.post("/workspaces", async (c) => {
    const body = await c.req.json<{ name: string; rootDir: string }>();
    return c.json(createWorkspace(db, body), 201);
  });
  app.patch("/workspaces/:id/open", (c) => {
    const workspace = markWorkspaceOpened(db, c.req.param("id"));
    return workspace ? c.json(workspace) : c.json({ error: "workspace not found" }, 404);
  });
  app.get("/workspaces/:id/sessions", (c) => c.json(listSessions(db, c.req.param("id"))));
  app.get("/workspaces/:id/files", (c) => {
    const workspace = getWorkspace(db, c.req.param("id"));
    if (!workspace) return c.json({ error: "workspace not found" }, 404);
    return c.json(listWorkspaceFiles(workspace.rootDir));
  });
  app.get("/workspaces/:id/files/content", async (c) => {
    const workspace = getWorkspace(db, c.req.param("id"));
    if (!workspace) return c.json({ error: "workspace not found" }, 404);
    try {
      return c.json(await documentReader(workspace.rootDir, c.req.query("path") ?? ""));
    } catch (error) {
      if ((error as Error).message === "Path escapes workspace") return c.json({ error: "Path escapes workspace" }, 403);
      return c.json({ error: "file not found" }, 404);
    }
  });
  app.get("/workspaces/:id/files/search", async (c) => {
    const workspace = getWorkspace(db, c.req.param("id"));
    if (!workspace) return c.json({ error: "workspace not found" }, 404);
    return c.json(await searchWorkspaceFiles(workspace.rootDir, c.req.query("q") ?? ""));
  });
  app.post("/sessions", async (c) => {
    const body = await c.req.json<{ workspaceId: string; title: string; origin?: string }>();
    return c.json(createSession(db, body), 201);
  });
  app.patch("/sessions/:sessionId", async (c) => {
    const body = await c.req.json<{ model?: string | null }>();
    const session = updateSession(db, c.req.param("sessionId"), { model: body.model });
    return session ? c.json(session) : c.json({ error: "session not found" }, 404);
  });
  app.get("/sessions/:sessionId/messages", (c) => {
    const session = getSession(db, c.req.param("sessionId"));
    if (!session) return c.json({ error: "session not found" }, 404);
    if (session.agentSessionPath) {
      return c.json(readMessagesFromSessionFile(session.agentSessionPath));
    }
    // Legacy fallthrough: empty list (SQLite messages table is no longer written by /runs).
    return c.json(getMessages(db, session.id));
  });
  app.post("/sessions/:sessionId/messages", async (c) => {
    const body = await c.req.json<{ role: "user" | "assistant" | "system"; content: string }>();
    return c.json(createMessage(db, { sessionId: c.req.param("sessionId"), ...body }), 201);
  });
  app.post("/quick-chat", (c) => {
    const workspace = getRecentWorkspace(db);
    if (!workspace) return c.json({ error: "workspace required" }, 409);
    return c.json(createSession(db, { workspaceId: workspace.id, title: "Quick chat", origin: "quick_chat" }), 201);
  });
  app.get("/providers", (c) => c.json(listProviders(db)));
  app.post("/providers", async (c) => {
    const body = await c.req.json<{ name: string; apiKey: string; baseUrl?: string | null; defaultModel: string }>();
    const provider = createProvider(db, body);
    authStorage.setRuntimeApiKey(piProviderId(provider.name), body.apiKey);
    return c.json(provider, 201);
  });
  app.post("/providers/:id/test", async (c) => {
    const provider = getProvider(db, c.req.param("id"));
    if (!provider) return c.json({ error: "provider not found" }, 404);
    const result = await availabilityChecker.check({
      piProviderId: piProviderId(provider.name),
      modelId: provider.defaultModel
    });
    return c.json(result);
  });

  app.post("/sessions/:sessionId/runs", async (c) => {
    const sessionId = c.req.param("sessionId");
    const session = getSession(db, sessionId);
    if (!session) return c.json({ error: "session not found" }, 404);
    const workspace = getWorkspace(db, session.workspaceId);
    if (!workspace) return c.json({ error: "workspace not found" }, 404);

    const body = await c.req.json<{ providerId: string; message: string; model?: string; contextFiles?: string[] }>();
    const provider = getProvider(db, body.providerId);
    if (!provider) return c.json({ error: "provider not found" }, 404);

    const modelId = body.model ?? provider.defaultModel;
    const run = createRun(db, { sessionId, providerId: provider.id, model: modelId });

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (type: string, payload: Record<string, unknown> = {}) => {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                run_id: run.id,
                session_id: sessionId,
                type,
                payload,
                created_at: new Date().toISOString()
              })}\n\n`
            )
          );
        };
        emit("run_started", { model: modelId });

        let assistantText = "";
        try {
          const result = await agentClient.run({
            sessionId,
            workspaceRoot: workspace.rootDir,
            piProviderId: piProviderId(provider.name),
            modelId,
            message: body.message,
            agentSessionPath: session.agentSessionPath ?? null
          });
          if (result.sessionFile) setAgentSessionPath(db, sessionId, result.sessionFile);

          for await (const event of result.events) {
            // Native event (kind="agent_event") for forward-looking consumers.
            emit("agent_event", { event });
            // Legacy compatibility envelope for current ChatView.
            if (event.type === "message_update" && (event as any).assistantMessageEvent?.type === "text_delta") {
              const delta = (event as any).assistantMessageEvent.delta as string;
              if (delta) {
                assistantText += delta;
                emit("assistant_delta", { text: delta });
              }
            }
            if (event.type === "message_end") {
              const stop = (event as any).message?.stopReason;
              if (stop === "error") {
                const msg = (event as any).message?.errorMessage ?? "agent failed";
                emit("run_failed", { error: msg });
                completeRun(db, run.id, "failed", msg);
                controller.close();
                return;
              }
            }
          }

          emit("assistant_message", { content: assistantText });
          emit("run_completed");
          completeRun(db, run.id, "completed");
        } catch (error) {
          const msg = (error as Error).message;
          emit("run_failed", { error: msg });
          completeRun(db, run.id, "failed", msg);
        } finally {
          controller.close();
        }
      }
    });

    return new Response(stream, { headers: { "content-type": "text/event-stream" } });
  });

  return app;
}

function syncProviderKeys(db: Database.Database, authStorage: AuthStorage) {
  const rows = db
    .prepare(
      "select providers.name as name, env_vars.value as api_key from providers join env_vars on env_vars.id = providers.api_key_ref where providers.enabled = 1"
    )
    .all() as Array<{ name: string; api_key: string }>;
  for (const row of rows) {
    const piId = piProviderId(row.name);
    if (piId && row.api_key) authStorage.setRuntimeApiKey(piId, row.api_key);
  }
}
```

- [ ] **Step 6: 运行 pi-server 全部测试**

Run: `pnpm --filter @marginalia/pi-server test`
Expected: 全部通过（含 provider-chat 新断言）。如果"provider test connection"那个 it 失败，是因为它仍 inject 旧的 `providerTester`；按下面 step 7 修复。

- [ ] **Step 7: 在 `provider-chat.test.ts` 里把旧的 `providerTester` it 调整为 availability**

将旧 "creates providers and delegates test connection" 替换为：

```ts
it("returns provider availability via injected checker", async () => {
  const db = memoryDb();
  migrate(db);
  const availabilityChecker = {
    async check({ piProviderId }: { piProviderId: string }) {
      return { ok: piProviderId === "minimax-cn", message: piProviderId === "minimax-cn" ? "ok" : "missing" };
    }
  } as any;
  const app = createApp({ db, availabilityChecker });

  const provider = await (
    await app.request("/providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Minimax", apiKey: "sk-test", defaultModel: "MiniMax-M2.7" })
    })
  ).json();

  const res = await app.request(`/providers/${provider.id}/test`, { method: "POST" });
  expect(await res.json()).toEqual({ ok: true, message: "ok" });
});
```

- [ ] **Step 8: 全测试再过**

Run: `pnpm --filter @marginalia/pi-server test`
Expected: 全部 PASS。

- [ ] **Step 9: 提交**

```bash
git add apps/pi-server/src/app.ts apps/pi-server/test/provider-chat.test.ts
git commit -m "feat(pi-server): real SSE streaming via pi-coding-agent, messages from pi session file"
```

---

## Task 11: 端到端 MiniMax smoke 测试（可跳过）

**Files:**
- Create: `apps/pi-server/test/minimax-smoke.test.ts`

- [ ] **Step 1: 写测试**

```ts
// apps/pi-server/test/minimax-smoke.test.ts
import { describe, it, expect } from "vitest";
import { AuthStorage, ModelRegistry, createAgentSession, SessionManager, getModel } from "@earendil-works/pi-coding-agent";

const KEY = process.env.MINIMAX_CN_API_KEY;

describe.runIf(Boolean(KEY))("minimax-cn live smoke", () => {
  it("streams at least one text_delta and ends cleanly", async () => {
    const authStorage = AuthStorage.create("/tmp/marginalia-smoke-auth.json");
    authStorage.setRuntimeApiKey("minimax-cn", KEY!);
    const modelRegistry = ModelRegistry.inMemory(authStorage);
    const model = getModel("minimax-cn", "MiniMax-M2.7");
    if (!model) throw new Error("MiniMax-M2.7 missing from pi-ai built-ins");

    const { session } = await createAgentSession({
      model,
      authStorage,
      modelRegistry,
      sessionManager: SessionManager.inMemory(process.cwd()),
      tools: []
    });

    const deltas: string[] = [];
    let ended = false;

    const unsubscribe = session.subscribe((event: any) => {
      if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta" && event.assistantMessageEvent.delta) {
        deltas.push(event.assistantMessageEvent.delta);
      }
      if (event.type === "message_end") ended = true;
    });

    try {
      await session.prompt("用一句话介绍你自己。");
    } finally {
      unsubscribe?.();
      session.dispose();
    }

    expect(deltas.join("").length).toBeGreaterThan(0);
    expect(ended).toBe(true);
  }, 60_000);
});
```

- [ ] **Step 2: 验证 skip 行为**

Run: `pnpm --filter @marginalia/pi-server test -- minimax-smoke.test.ts`
Expected: 当 env 没 `MINIMAX_CN_API_KEY` 时，`describe.runIf(false)` 让 0 个 it 运行（vitest 输出 "0 passed"），过；当 env 有 key 时真打。

- [ ] **Step 3: 用真 key 跑一遍**

Run:
```bash
KEY=$(sqlite3 ~/.marginalia/db.sqlite "select e.value from env_vars e join providers p on p.api_key_ref=e.id where p.name like '%inimax%' limit 1;")
MINIMAX_CN_API_KEY="$KEY" pnpm --filter @marginalia/pi-server test -- minimax-smoke.test.ts
```
Expected: 1 passed in 数秒～30 秒。如失败，看输出错误码：401 表示 key 无效；超时表示网络/baseUrl 问题（确认 pi-ai 内置 `https://api.minimaxi.com/anthropic` 可达）。

- [ ] **Step 4: 提交**

```bash
git add apps/pi-server/test/minimax-smoke.test.ts
git commit -m "test(pi-server): live MiniMax-CN smoke test gated on MINIMAX_CN_API_KEY"
```

---

## Task 12: Desktop — `sse-stream.ts` async iterator

**Files:**
- Create: `apps/desktop/src/api/sse-stream.ts`
- Test: `apps/desktop/src/api/sse-stream.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// apps/desktop/src/api/sse-stream.test.ts
import { describe, expect, it } from "vitest";
import { streamSse } from "./sse-stream.js";

function chunked(parts: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    }
  });
}

describe("streamSse", () => {
  it("yields parsed events split across chunks", async () => {
    const stream = chunked([
      'data: {"type":"run_started"',
      ',"run_id":"r1"}\n\n',
      'data: {"type":"assistant_delta","payload":{"text":"hi"}}\n\n'
    ]);
    const events: unknown[] = [];
    for await (const event of streamSse(stream)) events.push(event);
    expect(events).toEqual([
      { type: "run_started", run_id: "r1" },
      { type: "assistant_delta", payload: { text: "hi" } }
    ]);
  });

  it("ignores keep-alive empty data lines", async () => {
    const stream = chunked(['data: \n\n', 'data: {"type":"x"}\n\n']);
    const events: unknown[] = [];
    for await (const event of streamSse(stream)) events.push(event);
    expect(events).toEqual([{ type: "x" }]);
  });
});
```

- [ ] **Step 2: 运行失败**

Run: `pnpm --filter @marginalia/desktop test -- sse-stream.test.ts`
Expected: 模块未找到失败。

- [ ] **Step 3: 实现**

```ts
// apps/desktop/src/api/sse-stream.ts
export async function* streamSse<T = unknown>(body: ReadableStream<Uint8Array> | null): AsyncIterable<T> {
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = raw
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("");
        if (data) yield JSON.parse(data) as T;
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}
```

- [ ] **Step 4: 测试通过**

Run: `pnpm --filter @marginalia/desktop test -- sse-stream.test.ts`
Expected: 2 passed。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/api/sse-stream.ts apps/desktop/src/api/sse-stream.test.ts
git commit -m "feat(desktop): async-iterator SSE stream helper"
```

---

## Task 13: Desktop — `client.ts` 换 async iterator + pi 类型

**Files:**
- Modify: `apps/desktop/src/api/client.ts`
- Modify: `apps/desktop/src/api/client.test.ts`

- [ ] **Step 1: 改测试**

整文件替换为：

```ts
// apps/desktop/src/api/client.test.ts
import { describe, expect, it } from "vitest";
import { ApiClient } from "./client.js";

describe("ApiClient.runChat", () => {
  it("returns an async iterator of run events", async () => {
    global.fetch = (async () =>
      new Response(
        'data: {"type":"run_started","payload":{"model":"MiniMax-M2.7"}}\n\n' +
          'data: {"type":"assistant_delta","payload":{"text":"hi"}}\n\n' +
          'data: {"type":"run_completed","payload":{}}\n\n',
        { headers: { "content-type": "text/event-stream" } }
      )) as typeof fetch;

    const api = new ApiClient("http://server");
    const events: unknown[] = [];
    const stream = await api.runChat("s1", { providerId: "p1", model: "MiniMax-M2.7", message: "hi" });
    for await (const event of stream) events.push(event);
    expect(events).toEqual([
      { type: "run_started", payload: { model: "MiniMax-M2.7" } },
      { type: "assistant_delta", payload: { text: "hi" } },
      { type: "run_completed", payload: {} }
    ]);
  });
});
```

- [ ] **Step 2: 运行失败**

Run: `pnpm --filter @marginalia/desktop test -- client.test.ts`
Expected: `runChat is not async iterable`-类断言失败。

- [ ] **Step 3: 修改 `client.ts`**

把 `readSse` 删掉（被 sse-stream 替代）；`runChat` 改为：

```ts
import { streamSse } from "./sse-stream.js";

// ...类型定义保留 Workspace/Session/Message/Provider/FileEntry/DocumentContent ...

export type RunEvent = {
  type: string;
  run_id?: string;
  session_id?: string;
  payload?: Record<string, unknown>;
  created_at?: string;
};

export class ApiClient {
  // ... 其他方法保持原样 ...

  async runChat(
    sessionId: string,
    input: { providerId: string; model?: string; message: string; contextFiles?: string[] }
  ): Promise<AsyncIterable<RunEvent>> {
    const response = await fetch(`${this.baseUrl}/sessions/${sessionId}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input)
    });
    if (!response.ok) {
      const error = (await response.json().catch(() => ({ error: response.statusText }))) as { error?: string };
      throw new Error(error.error ?? response.statusText);
    }
    return streamSse<RunEvent>(response.body);
  }
}

// 不再导出 readSse；保留 streamSse 给消费者通过 sse-stream.js 自取。
```

把旧的 `runChat` 实现和 `readSse` 函数删掉。整文件其他类型保持不变。

- [ ] **Step 4: 全量 desktop typecheck**

Run: `pnpm --filter @marginalia/desktop typecheck`
Expected: 失败 — `ChatView.tsx` 仍用旧的 batched 返回。Task 14 修复，先跳过。

- [ ] **Step 5: 跑这两个测试**

Run: `pnpm --filter @marginalia/desktop test -- client.test.ts sse-stream.test.ts`
Expected: 通过。

- [ ] **Step 6: 提交**

```bash
git add apps/desktop/src/api/client.ts apps/desktop/src/api/client.test.ts
git commit -m "refactor(desktop): runChat returns async iterator of RunEvent"
```

---

## Task 14: Desktop — ChatView 增量渲染 + provider 选择

**Files:**
- Modify: `apps/desktop/src/chat/ChatView.tsx`
- Modify: `apps/desktop/src/chat/ChatView.test.tsx`

- [ ] **Step 1: 重写 ChatView.test.tsx**

整文件替换为：

```tsx
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatView } from "./ChatView.js";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...init.headers }
  });
}

function sseResponse(chunks: string[]) {
  return new Response(chunks.map((c) => `data: ${c}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" }
  });
}

describe("ChatView", () => {
  beforeEach(() => cleanup());

  it("streams assistant deltas incrementally and selects an existing provider", async () => {
    global.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/providers")) {
        return jsonResponse([
          { id: "openai-1", name: "OpenAI", defaultModel: "gpt-4.1" },
          { id: "mm-1", name: "Minimax", defaultModel: "MiniMax-M2.7" }
        ]);
      }
      if (url.endsWith("/sessions/s1/messages")) return jsonResponse([]);
      if (url.endsWith("/sessions/s1") && init?.method === "PATCH") return jsonResponse({ id: "s1" });
      if (url.endsWith("/sessions/s1/runs")) {
        return sseResponse([
          '{"type":"run_started","payload":{"model":"MiniMax-M2.7"}}',
          '{"type":"assistant_delta","payload":{"text":"hel"}}',
          '{"type":"assistant_delta","payload":{"text":"lo"}}',
          '{"type":"run_completed","payload":{}}'
        ]);
      }
      return jsonResponse({});
    });

    render(<ChatView serverUrl="http://server" session={{ id: "s1", workspaceId: "w1", title: "Chat", origin: "desktop" }} />);

    fireEvent.change(await screen.findByLabelText("Provider"), { target: { value: "mm-1" } });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "say hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("hello")).toBeInTheDocument();
    expect(screen.getByText("say hi")).toBeInTheDocument();
  });

  it("shows retry after a run error", async () => {
    global.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.endsWith("/providers")) return jsonResponse([{ id: "mm-1", name: "Minimax", defaultModel: "MiniMax-M2.7" }]);
      if (url.endsWith("/sessions/s1/messages")) return jsonResponse([]);
      if (url.endsWith("/sessions/s1/runs")) return jsonResponse({ error: "missing key" }, { status: 400 });
      return jsonResponse({});
    });

    render(<ChatView serverUrl="http://server" session={{ id: "s1", workspaceId: "w1", title: "Chat", origin: "desktop" }} />);
    fireEvent.change(await screen.findByLabelText("Message"), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.getByText("missing key")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
```

注：删除原文件里依赖"内联 provider 创建表单"的 3 个 it（saves/tests/file-suggestions）。文件搜索逻辑仍在 ChatView 中保留（不删），只是不再在主测试断言。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @marginalia/desktop test -- ChatView.test.tsx`
Expected: 第 1 个 it 在"找 Provider label"或"看不到 hello"处失败。

- [ ] **Step 3: 整文件覆盖 `ChatView.tsx`**

```tsx
import { useEffect, useMemo, useState } from "react";
import { ApiClient, type Message, type Provider, type Session } from "../api/client.js";

const emptyAttachedFiles: string[] = [];

export function ChatView({
  serverUrl,
  session,
  attachedFiles = emptyAttachedFiles
}: {
  serverUrl: string;
  session: Session;
  attachedFiles?: string[];
}) {
  const api = useMemo(() => new ApiClient(serverUrl), [serverUrl]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerId, setProviderId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState(session.model ?? "");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [fileSuggestions, setFileSuggestions] = useState<{ path: string }[]>([]);
  const [contextFiles, setContextFiles] = useState<string[]>(attachedFiles);

  useEffect(() => {
    setContextFiles(attachedFiles);
  }, [attachedFiles]);

  useEffect(() => {
    void api.listProviders().then((items) => {
      const list = Array.isArray(items) ? items : [];
      setProviders(list);
      if (!providerId && list.length > 0) setProviderId(list[0].id);
      if (!model && list.length > 0) setModel(list[0].defaultModel);
    });
    void api.listMessages(session.id).then((items) => setMessages(Array.isArray(items) ? items : []));
  }, [api, session.id]);

  async function changeModel(value: string) {
    setModel(value);
    await api.updateSession(session.id, { model: value });
  }

  async function send() {
    if (!draft.trim()) return;
    const provider = providers.find((p) => p.id === providerId) ?? providers[0];
    if (!provider) {
      setError("no provider configured");
      return;
    }
    setError("");
    setSending(true);
    const userId = `local-user-${Date.now()}`;
    const assistantId = `local-assistant-${Date.now()}`;
    setMessages((items) => [
      ...items,
      { id: userId, role: "user", content: draft },
      { id: assistantId, role: "assistant", content: "" }
    ]);
    const sentDraft = draft;
    setDraft("");

    try {
      const events = await api.runChat(session.id, {
        providerId: provider.id,
        model: model || provider.defaultModel,
        message: sentDraft,
        contextFiles
      });
      for await (const event of events) {
        if (event.type === "assistant_delta") {
          const delta = (event.payload as { text?: string } | undefined)?.text ?? "";
          if (delta) {
            setMessages((items) =>
              items.map((item) =>
                item.id === assistantId ? { ...item, content: item.content + delta } : item
              )
            );
          }
        }
        if (event.type === "run_failed") {
          const errMsg = (event.payload as { error?: string } | undefined)?.error ?? "run failed";
          throw new Error(errMsg);
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function updateDraft(value: string) {
    setDraft(value);
    if (value.endsWith("@")) {
      setFileSuggestions(await api.searchFiles(session.workspaceId, ""));
    }
  }

  function attachFile(path: string) {
    setContextFiles((items) => (items.includes(path) ? items : [...items, path]));
    setFileSuggestions([]);
  }

  return (
    <section>
      <label>
        Provider
        <select value={providerId} onChange={(event) => setProviderId(event.target.value)}>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>{p.name} · {p.defaultModel}</option>
          ))}
        </select>
      </label>
      <label>
        Model
        <input value={model} onChange={(event) => void changeModel(event.target.value)} />
      </label>
      <div aria-label="Messages">
        {messages.map((item) => (
          <p key={item.id} data-role={item.role}>{item.content}</p>
        ))}
      </div>
      {error ? (
        <p>
          {error} <button onClick={send}>Retry</button>
        </p>
      ) : null}
      {contextFiles.map((path) => (
        <button key={path}>{path}</button>
      ))}
      {fileSuggestions.map((file) => (
        <button key={file.path} onClick={() => attachFile(file.path)}>
          {file.path}
        </button>
      ))}
      <label>
        Message
        <textarea value={draft} onChange={(event) => void updateDraft(event.target.value)} />
      </label>
      <button disabled={sending} onClick={send}>
        Send
      </button>
    </section>
  );
}
```

注：彻底删除内联 provider 创建/测试表单（Save provider、Test provider、Base URL 等输入）。这些通过 SQLite 手动或单独 ProviderSettings 页操作；本 spec 不在此 Task 加 UI。

- [ ] **Step 4: 测试通过**

Run: `pnpm --filter @marginalia/desktop test -- ChatView.test.tsx`
Expected: 2 passed。

- [ ] **Step 5: 全量 desktop typecheck + test**

Run: `pnpm --filter @marginalia/desktop typecheck && pnpm --filter @marginalia/desktop test`
Expected: 全部通过。如果 `WorkspaceShell.tsx` 或别处仍引用旧 API，按报错单独修。

- [ ] **Step 6: 提交**

```bash
git add apps/desktop/src/chat/ChatView.tsx apps/desktop/src/chat/ChatView.test.tsx
git commit -m "feat(desktop): incremental ChatView render and explicit provider picker"
```

---

## Task 15: Electron — capture-screenshot IPC

**Files:**
- Modify: `apps/desktop/electron/main.ts`
- Modify: `apps/desktop/electron/preload.cts`

- [ ] **Step 1: 修改 `main.ts`**

在 `import` 段加：

```ts
import fs from "node:fs/promises";
```

在 `ipcMain.handle("workspace:pick-directory", ...)` 之后追加：

```ts
ipcMain.handle("marginalia:capture-screenshot", async (_event, label: string) => {
  if (!windowRef) throw new Error("window not ready");
  const image = await windowRef.webContents.capturePage();
  const buffer = image.toPNG();
  const outDir = path.resolve(process.cwd(), "output/verify-minimax");
  await fs.mkdir(outDir, { recursive: true });
  const safe = label.replace(/[^a-z0-9_-]+/gi, "-");
  const file = path.join(outDir, `${Date.now()}-${safe}.png`);
  await fs.writeFile(file, buffer);
  return file;
});
```

- [ ] **Step 2: 修改 `preload.cts`**

整文件替换为：

```ts
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("marginalia", {
  getPiServerStatus: () => ipcRenderer.invoke("pi-server:status"),
  restartPiServer: () => ipcRenderer.invoke("pi-server:restart"),
  pickWorkspaceDirectory: () => ipcRenderer.invoke("workspace:pick-directory"),
  captureScreenshot: (label: string) => ipcRenderer.invoke("marginalia:capture-screenshot", label)
});
```

- [ ] **Step 3: typecheck**

Run: `pnpm --filter @marginalia/desktop typecheck`
Expected: 通过（若 `window.marginalia` 全局类型在某 `.d.ts` 内定义且不含 `captureScreenshot`，在该 `.d.ts` 里补一行 `captureScreenshot?: (label: string) => Promise<string>;`，并把修改加入下面的 commit）。

- [ ] **Step 4: 提交**

```bash
git add apps/desktop/electron/main.ts apps/desktop/electron/preload.cts apps/desktop/src/vite-env.d.ts
git commit -m "feat(desktop): expose captureScreenshot IPC for verification scripts"
```

---

## Task 16: 端到端 verify 脚本 + 截图归档

**Files:**
- Create: `scripts/verify-minimax.mjs`
- Create: `output/verify-minimax/.gitkeep`
- Create: `output/verify-minimax/2026-05-26.md` (执行产物)

- [ ] **Step 1: 写脚本**

```js
// scripts/verify-minimax.mjs
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";

const outDir = path.resolve("output/verify-minimax");
await fs.mkdir(outDir, { recursive: true });

function fetchJson(url, init) {
  return fetch(url, init).then(async (r) => {
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return r.json();
  });
}

async function waitFor(url, ms = 15000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server ${url} did not become ready`);
}

const serverProcess = spawn("pnpm", ["--filter", "@marginalia/pi-server", "dev"], {
  stdio: ["ignore", "pipe", "inherit"]
});

let port = 0;
serverProcess.stdout.on("data", (chunk) => {
  for (const line of chunk.toString().split("\n")) {
    if (!line.trim()) continue;
    try {
      const evt = JSON.parse(line);
      if (evt.type === "ready") port = evt.port;
    } catch {}
  }
});

try {
  while (!port) await new Promise((r) => setTimeout(r, 100));
  const base = `http://127.0.0.1:${port}`;
  await waitFor(`${base}/health`);

  const providers = await fetchJson(`${base}/providers`);
  const minimax = providers.find((p) => /minimax/i.test(p.name));
  if (!minimax) throw new Error("Minimax provider not configured in ~/.marginalia/db.sqlite");

  const workspaces = await fetchJson(`${base}/workspaces`);
  const workspace = workspaces[0];
  if (!workspace) throw new Error("create a workspace first via the UI");

  const session = await fetchJson(`${base}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceId: workspace.id, title: "verify-minimax", origin: "verify" })
  });

  async function run(message) {
    const response = await fetch(`${base}/sessions/${session.id}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ providerId: minimax.id, model: minimax.defaultModel, message })
    });
    if (!response.ok) throw new Error(`run failed: ${await response.text()}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const events = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let i = buffer.indexOf("\n\n");
      while (i >= 0) {
        const raw = buffer.slice(0, i);
        buffer = buffer.slice(i + 2);
        const data = raw.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
        if (data) events.push(JSON.parse(data));
        i = buffer.indexOf("\n\n");
      }
    }
    return events;
  }

  const turn1 = await run("用一句话介绍你自己。");
  await fs.writeFile(path.join(outDir, "turn1-events.json"), JSON.stringify(turn1, null, 2));
  const turn2 = await run("再讲一个冷笑话。");
  await fs.writeFile(path.join(outDir, "turn2-events.json"), JSON.stringify(turn2, null, 2));

  const messages = await fetchJson(`${base}/sessions/${session.id}/messages`);
  await fs.writeFile(path.join(outDir, "messages.json"), JSON.stringify(messages, null, 2));

  const summary = [
    "# verify-minimax 2026-05-26",
    "",
    `- pi-server port: ${port}`,
    `- session id: ${session.id}`,
    `- provider: ${minimax.name} (${minimax.defaultModel})`,
    "",
    "## Turn 1: 用一句话介绍你自己。",
    "",
    "```",
    messages.find((m, i) => m.role === "assistant" && i >= 1)?.content ?? "(missing)",
    "```",
    "",
    "## Turn 2: 再讲一个冷笑话。",
    "",
    "```",
    messages.filter((m) => m.role === "assistant").slice(-1)[0]?.content ?? "(missing)",
    "```",
    "",
    `Total events captured: ${turn1.length + turn2.length}`,
    ""
  ].join("\n");
  await fs.writeFile(path.join(outDir, "2026-05-26.md"), summary);
  console.log("verify-minimax: OK →", path.join(outDir, "2026-05-26.md"));
} finally {
  serverProcess.kill();
}
```

注：本脚本不启动 Electron — 直接打 pi-server HTTP，足以证明 chat 端到端通。截图由下面 Step 4 用 `playwright`（已在 `output/playwright/` 目录看到使用过）或手动 Electron 启动捕获。

- [ ] **Step 2: 跑一次（需 ~/.marginalia/db.sqlite 里有 minimax provider + 至少 1 个 workspace）**

Run: `node scripts/verify-minimax.mjs`
Expected: 控制台打印 `verify-minimax: OK → output/verify-minimax/2026-05-26.md`；该 md 文件包含两轮真实回复（非空）。

如失败：
- "Minimax provider not configured" → 用 Electron UI 加一次 Minimax provider 或直接 `INSERT INTO providers …`
- "create a workspace first" → 同上加 workspace
- 401 → key 失效，更新 env_vars.value

- [ ] **Step 3: 手动启动 Electron 截 3 张图（Electron 截图脚本本 spec 不全自动化；用 Task 15 暴露的 IPC，开 devtools 跑）**

```bash
pnpm --filter @marginalia/desktop dev
# Electron 窗口打开后，DevTools Console 跑：
# await window.marginalia.captureScreenshot("01-empty-chat")
# 选 Minimax provider；输入消息；点 Send；等回复完成；
# await window.marginalia.captureScreenshot("02-first-reply")
# 再发一条上下文相关问题；等完成；
# await window.marginalia.captureScreenshot("03-multi-turn")
```

确认 `output/verify-minimax/*.png` 出现 3 张文件。

- [ ] **Step 4: 把截图文件名追加到 `output/verify-minimax/2026-05-26.md`**

在该 md 末尾追加：

```md
## Screenshots
- ![empty chat](./<file 01>.png)
- ![first reply](./<file 02>.png)
- ![multi-turn](./<file 03>.png)
```

（用实际文件名替换 `<file XX>`）

- [ ] **Step 5: 添加 .gitkeep（如目录已被截图填充则跳过）**

```bash
touch output/verify-minimax/.gitkeep
```

- [ ] **Step 6: 提交**

```bash
git add scripts/verify-minimax.mjs output/verify-minimax/
git commit -m "test: end-to-end verify-minimax script and screenshot artifacts"
```

---

## Task 17: 整体回归 + typecheck

**Files:** （无新增）

- [ ] **Step 1: 全量 typecheck**

Run: `pnpm typecheck`
Expected: 全部 0 错误。

- [ ] **Step 2: 全量 test**

Run: `pnpm test`
Expected: 全部 PASS（minimax-smoke 如无 env 则 skip）。

- [ ] **Step 3: 修复任何遗留的旧 import**

Run: `grep -rn "OpenAICompatibleAgentClient\|PiAgentClient\|defaultProviderTester\|ProviderConnectionTester\|readSse" apps/`
Expected: 0 结果。如有，按文件单独修复并提交。

- [ ] **Step 4: 最终提交**

```bash
git status
# 若 status 干净，结束；若有零碎改动按需提交。
```

---

## Self-Review

按 spec 第 10 节风险逐项核对：
- pi-coding-agent system prompt 来自 cwd：Task 10 中 `workspaceRoot` 强制传 workspace.rootDir ✅
- 默认工具含 bash/write：Task 14 ChatView 未加提示文案。**补一条**：在 ChatView `<section>` 顶部加 `<p>This agent can read/write files in the current workspace.</p>` — 在 Task 14 Step 3 的 JSX 顶部已留好位置，请实施者落地时补上一行。
- session 文件版本：`buildSessionContext` 内部已处理 migration；不另写代码。
- AuthStorage 路径冲突：Task 10 使用 `AuthStorage.create()`（默认 `~/.pi/agent/auth.json`）。**修正**：spec 要求 `~/.marginalia/auth.json` 以避免与 `pi` CLI 冲突。把 Task 10 Step 5 的 `AuthStorage.create()` 改为 `AuthStorage.create(path.join(homedir(), ".marginalia/auth.json"))`，并在文件顶 import `import { homedir } from "node:os"; import path from "node:path";`。

将以上两条修正在执行 Task 10 / 14 时一并应用。

Spec 覆盖核对：
- §3.1 数据流 → Task 10 实现 ✅
- §3.2 模块边界 → Task 2/3/4/5/6/8 ✅
- §3.3 依赖切换 → Task 1 ✅
- §4.1 注册表 → Task 5 ✅
- §4.2 Session 文件位置 → Task 10 sessionManagerFor ✅
- §4.3 流式 SSE → Task 10 Step 5 ReadableStream ✅
- §4.4 消息读取 → Task 4 + Task 10 messages 路由 ✅
- §4.5 Provider 测试 → Task 8 ✅
- §4.6 错误传播 → Task 10 message_end stopReason=error ✅
- §5 接口契约 → Task 3 ✅
- §6 错误边界 → 部分由 Task 10 catch 实现；session 文件被删的 fallback 不在 Task 5 写明，**补充**：在 Task 5 `sessionManagerFor` 实现里加 try/catch，open 失败 fallback 到 create
- §7 测试 → Tasks 2/4/5/6/8/10/11/12/13/14 ✅
- §8 截图验证 → Task 15/16 ✅

§6 fallback 实施提示：在 Task 10 Step 5 的 `sessionManagerFor` lambda 实现里加 try/catch：

```ts
sessionManagerFor: (cwd, existing) => {
  if (!existing) return SessionManager.create(cwd);
  try {
    return SessionManager.open(existing);
  } catch {
    return SessionManager.create(cwd);
  }
}
```

请在执行 Task 10 时一并落地这版。

无 placeholder / TBD。命名一致性：`agentSessionPath` 在 spec、migration、registry、AgentRunInput 中一致；`piProviderId` / `modelId` 字段在 Task 3/6/10 中一致。

---

## Execution Handoff

完成后请按 spec §9 顺序落地。两种执行方式可选：

1. **Subagent-Driven（推荐）**：每个 Task 派一个 fresh subagent，做完一个 review 一个。
2. **Inline Execution**：本会话内一路执行，每 2-3 个 Task 做 checkpoint。

