---
type: plan
record_id: PLAN-P2-SKILLS-001
status: active
source_spec_id: SPEC-P2-SKILLS-001
created: 2026-07-18
updated: 2026-07-18
target_milestone: post-M0
owner: repository-maintainers
docs_impact:
  user:
    - docs/user/guide.md
    - docs/user/concepts.md
    - docs/user/configuration.md
  developer:
    - docs/developer/api.md
    - docs/developer/architecture.md
    - docs/developer/development.md
  product_status: true
---

# Codex 风格 Skills 集成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox
> (`- [ ]`) syntax for tracking.

**Goal:** 在 Marginalia Desktop 中实现 Codex 风格的 `$`/`/` Skill 选择与 Settings → Skills
管理，同时严格保留 Pi 的 Skill 解析、隐式提示和 session 历史语义。

**Architecture:** pi-server 维护 global-only 与 workspace 级不可变 `SkillCatalog` 快照，按已确认的
六级目录顺序独立调用 Pi loader 解析每个候选，并以 canonical realpath 应用 Marginalia 私有启停
偏好。每次 run 在服务端 session lease 内刷新 Catalog、校验结构化 Skill identities、构建完整
prompt，再用 revision-pinned `DefaultResourceLoader` 启动 Pi；Desktop 只消费公开 snapshot，并在
`run_started` 后提交 scoped draft。

**Tech Stack:** Node.js 22.19+、TypeScript ESM、Hono、better-sqlite3、
`@earendil-works/pi-coding-agent` 0.75.5、Electron 39、React 18、Zustand、Tailwind、Vitest、
Testing Library、Electron screenshot verification。

## Global Constraints

- 不新增运行时依赖；复用 Node 标准库、Pi loader、现有 Hono/React/Zustand 设施。
- TypeScript ESM import 必须带 `.js`；desktop 跨目录 import 使用 `@/`。
- 所有 desktop 用户可见字符串通过 `t()`，同时增加 English/Chinese keys。
- `agent_event` 保持 raw pi payload；只保留现有 run-level SSE envelopes。
- `packages/chat-core` 只放 pi-shaped 类型桥和无 UI 依赖的纯展示辅助。
- Skill identity、偏好、去重和选择校验统一使用 canonical realpath；客户端 path 永远不是任意文件读取权限。
- 显式选择最多 16 个；单项正文最多 512 KiB；合计 blocks 最多 2 MiB；preview 最多 256 KiB。
- 每任务测试先行，先观察目标失败，再写最小实现；每个任务独立 Conventional Commit。
- 用户流程、HTTP、SQLite、权限或架构进入正常路径时，在同一任务同步正式文档。
- UI 交付必须运行 `pnpm verify:visual` 并逐张裁决，不以命令退出码代替视觉判断。
- 实施开始时把 spec/plan 从 approved/draft 改为 active；完成后写 Implementation Outcome 并归档。

## Scope Check

本 spec 横跨 server catalog、run transaction 与 desktop UX，但三者共享同一个安全验收边界：公开
picker identity 必须能被同一 snapshot 在发送前复验，并由同一 revision 驱动 Pi loader。把它拆为
独立计划会留下“可选择但不能安全发送”或“server 能力没有受支持 UI”的中间产品，因此保留一个
线性端到端计划。任务仍按可独立 review 的领域边界拆分。

## File Responsibility Map

### pi-server

- **apps/pi-server/src/security/capability.ts**：敏感路由的 token 与 exact-Origin 判定，不处理业务。
- **apps/pi-server/src/run/session-run-leases.ts**：每个 session 的进程内 single-flight lease。
- `apps/pi-server/src/agent/agent-client.ts`：`prepare/start/settled` 公共生命周期契约。
- `apps/pi-server/src/agent/pi-coding-agent-client.ts`：revision-pinned Pi loader 与 execution stream。
- `apps/pi-server/src/agent/agent-session-registry.ts`：按 `effectiveRevision` 复用或重建 session handle。
- **apps/pi-server/src/agent/agent-message.ts**：Skill blocks、用户正文、附件 envelope 的最终拼装。
- `apps/pi-server/src/db/migrations.ts`：真实的 v1 → v2 schema migration。
- **apps/pi-server/src/db/skill-preferences.ts**：canonical path 启停偏好的唯一数据库入口。
- **apps/pi-server/src/skills/types.ts**：Catalog 内部与公开 DTO 类型、大小常量、错误 reason union。
- **apps/pi-server/src/skills/discovery.ts**：六级 root、Pi/Agents mode、ancestor 与稳定路径顺序。
- **apps/pi-server/src/skills/candidate-loader.ts**：单候选三次稳定读取和 Pi 原生解析。
- **apps/pi-server/src/skills/catalog.ts**：偏好、collision、revision、串行 refresh 与不可变 snapshot。
- **apps/pi-server/src/skills/turn-preflight.ts**：结构化选择校验、去重、XML block 构建计划。
- `apps/pi-server/src/app.ts`：保留字符串字面量 route 注册，组合 capability、Catalog 和 run transaction。
- `apps/pi-server/src/index.ts`：从 Electron child environment 注入 token 与 dev origin。

### shared + desktop

- **packages/chat-core/src/user-display.ts**：live/reopened 共用的 `$skill` 展示和 prompt 归一化纯函数。
- `apps/desktop/electron/pi-server-spawner.ts`：生成每进程 token，并安全传入 child environment。
- `apps/desktop/src/api/client.ts`：带 token 的 Skills API、run selection 与结构化 `ApiError`。
- `apps/desktop/src/store/app-store.ts`：非持久化、按 owner 隔离的 `TurnDraft` 和一次性 `pendingTurn`。
- **apps/desktop/src/hooks/useSkillCatalog.ts**：picker/Settings 的显式 refresh 与 stale-response guard。
- `apps/desktop/src/hooks/useStreamingChat.ts`：以 `run_started` 作为接受边界。
- **apps/desktop/src/chat/Composer/SkillMenu.tsx**：`$` 专用选择列表。
- **apps/desktop/src/chat/Composer/SkillChip.tsx**：有序选择、移除与 invalid 状态。
- `apps/desktop/src/chat/Composer/SlashMenu.tsx`：Commands/Skills 分区与扁平键盘导航。
- `apps/desktop/src/chat/Composer/Composer.tsx`：受控 draft、三类 trigger 和 chips 容器。
- **apps/desktop/src/chat/SkillPreconditionBanner.tsx**：Refresh/移除/Settings 修复入口。
- **apps/desktop/src/settings/SkillsPane.tsx**：搜索、状态、toggle、refresh、详情和 preview。
- `apps/desktop/src/chat/NewThreadView.tsx`、`apps/desktop/src/chat/ChatView.tsx`：owner/pendingTurn/Retry 编排。
- `apps/desktop/src/app/AppShell.tsx`：可信 token 和已解析 workspace 上下文下传。

## Execution Order

1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 16。
任务 1–4 建立安全和事务基础；5–9 完成 Catalog/API/Pi runtime；10–15 完成历史与 Desktop；
16 负责 Electron 视觉验收、仓库总门禁和记录归档。

---

### Task 1: Skills capability 与 Electron 进程凭据

**Files:**

- Create: **apps/pi-server/src/security/capability.ts**
- Create: **apps/pi-server/test/capability.test.ts**
- Modify: `apps/pi-server/src/app.ts`
- Modify: `apps/pi-server/src/index.ts`
- Modify: `apps/desktop/electron/pi-server-spawner.ts`
- Modify: `apps/desktop/electron/pi-server-spawner.test.ts`
- Modify: `apps/desktop/electron/main.ts`
- Modify: `apps/desktop/electron/preload.cts`
- Modify: `apps/desktop/src/vite-env.d.ts`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/App.test.tsx`
- Modify: `apps/desktop/src/app/AppShell.tsx`
- Modify: `apps/desktop/src/hooks/useApi.ts`
- Modify: `apps/desktop/src/api/client.ts`
- Modify: `apps/desktop/src/api/client.test.ts`
- Modify: `docs/developer/api.md`
- Modify: `docs/developer/architecture.md`
- Modify: `docs/developer/development.md`
- Modify: `docs/superpowers/specs/2026-07-18-skills-integration-design.md`
- Modify: `docs/superpowers/plans/2026-07-18-skills-integration.md`
- Modify: `docs/superpowers/README.md`

**Interfaces:**

- Produces:
  - `type CapabilityPolicy = { token: string | null; allowedOrigins: ReadonlySet<string> }`
  - `authorizeCapability(request: Request, policy: CapabilityPolicy): 401 | 403 | null`
  - ready status `{ status: "ready"; url: string; capabilityToken: string }`
  - `new ApiClient(baseUrl: string, capabilityToken: string)`；只给 Skills API 与 run 加 bearer。
- Preserves: `/health` 和其他既有 route 的当前认证边界；整体 loopback 问题仍保持 open。

- [x] **Step 1: 激活设计记录并写 capability 失败测试**

把 spec/plan frontmatter 状态改为 `active`，README index 同步；新增测试固定以下矩阵：

```ts
const cases = [
  { token: undefined, origin: undefined, status: 401 },
  { token: "wrong", origin: undefined, status: 401 },
  { token: "secret", origin: "https://evil.example", status: 403 },
  { token: "secret", origin: undefined, status: 200 },
  { token: "secret", origin: "null", status: 200 },
  { token: "secret", origin: "http://127.0.0.1:5173", status: 200 }
] as const;

function sensitiveHeaders(token?: string, origin?: string): HeadersInit {
  return {
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(origin ? { origin } : {})
  };
}
```

测试还要断言允许的 `OPTIONS` 返回 `204`，包含 `Authorization, Content-Type`，且不要求 bearer；
evil origin 的 preflight 不返回 allow-origin。

- [x] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm --filter @marginalia/pi-server test -- capability
pnpm --filter @marginalia/desktop test -- pi-server-spawner client App
```

Expected: FAIL，因为 server 仍反射 Origin、run 无认证、ready status 没有 token。

- [x] **Step 3: 实现纯 capability 判定**

**apps/pi-server/src/security/capability.ts** 完整公共边界：

```ts
export type CapabilityPolicy = {
  token: string | null;
  allowedOrigins: ReadonlySet<string>;
};

export type CapabilityFailure = 401 | 403;

export function isAllowedOrigin(origin: string | null, policy: CapabilityPolicy): boolean {
  return origin === null || origin === "null" || policy.allowedOrigins.has(origin);
}

export function authorizeCapability(
  request: Request,
  policy: CapabilityPolicy
): CapabilityFailure | null {
  if (!isAllowedOrigin(request.headers.get("origin"), policy)) return 403;
  const expected = policy.token;
  if (!expected) return 401;
  return request.headers.get("authorization") === `Bearer ${expected}` ? null : 401;
}
```

`app.ts` 用 exact allowlist 配置全局 CORS，不再返回任意 origin；在 run handler 首行调用
`authorizeCapability`。`OPTIONS` 由 CORS middleware 处理，actual request 必须同时过 Origin 和 bearer。
`AppOptions` 的注入点固定为 `capability?: CapabilityPolicy`，缺省值为
`{ token: null, allowedOrigins: new Set() }`；失败响应固定为
`401 { error: "unauthorized" }` 或 `403 { error: "origin_forbidden" }`。

- [x] **Step 4: 生成 token 并贯通 main → preload → renderer**

`startPiServer` 每次启动用 `randomBytes(32).toString("base64url")` 生成 token；测试通过
`capabilityToken` option 注入固定值。launcher 的精确签名改为：

```ts
type LaunchFn = (
  scriptPath: string,
  cwd: string,
  env: Readonly<Record<string, string>>
) => PiServerProcess;

type StartOptions = {
  launch?: LaunchFn;
  scriptPath?: string;
  isPackaged?: boolean;
  timeoutMs?: number;
  capabilityToken?: string;
  allowedOrigin?: string;
};
```

child env 只新增 `MARGINALIA_CAPABILITY_TOKEN` 和可选 `MARGINALIA_ALLOWED_ORIGIN`；token 不进入
stdout、stderr 或 SQLite。`main.ts` 只把经过既有 loopback 校验的 Vite URL 的 `.origin` 传入。
`serializeStatus` 和 preload status 返回 token；`AppShell` 调用 `useApi(serverUrl, token)`。

- [x] **Step 5: 给 ApiClient 敏感请求统一加 bearer**

```ts
export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly capabilityToken: string
  ) {}

  private sensitiveHeaders(): HeadersInit {
    return {
      "content-type": "application/json",
      authorization: `Bearer ${this.capabilityToken}`
    };
  }
}
```

本任务只把 `runChat` 切到 `sensitiveHeaders()`；Skills methods 在 Task 11 增加。普通 workspace、
provider、document API 不带 token。开发浏览器 fallback 同时要求 query 中有 `serverUrl` 和
`capabilityToken`，缺任一项都不构造 ready bridge。

- [x] **Step 6: 更新权限与开发契约**

`docs/developer/api.md` 记录所有 run 需要 bearer、401/403 和 preflight；
`docs/developer/architecture.md` 记录局部 capability 数据流且明确不关闭 `P0-SEC-001`；
`docs/developer/development.md` 记录 Electron 自动注入以及显式浏览器调试参数。

- [x] **Step 7: 运行 focused 验证**

Run:

```bash
pnpm --filter @marginalia/pi-server test -- capability provider-chat approval-flow
pnpm --filter @marginalia/pi-server typecheck
pnpm --filter @marginalia/desktop test -- pi-server-spawner client App useApi
pnpm --filter @marginalia/desktop typecheck
pnpm docs:check
```

Expected: PASS；缺 token 的 run 是 401，其他既有 API 不变。

**Task 1 results (2026-07-18):**

- 实际完成：run capability、exact-Origin CORS、Electron 每进程 token、preload/renderer 贯通，且
  `ApiClient` 只给 run 加 bearer；Skills API 留给 Task 11。
- RED：pi-server capability 测试 4 项按预期失败；desktop spawner/client/App 测试 3 项按预期失败；
  安全 review 的 debug query history 回归测试 1 项按预期失败。
- GREEN：focused pi-server 20 tests 与 desktop 61 tests 全通过；两个 package typecheck 和
  `pnpm docs:check` 通过；最终 `pnpm verify` 全通过。
- 正式文档：更新 `docs/developer/api.md`、`docs/developer/architecture.md` 和
  `docs/developer/development.md`。
- Formal review fixes：启动器在 dev/packaged 两条路径继承环境前移除旧 capability token 和
  allowed origin，再应用本次可信注入；同步 user、product status 与 readiness audit 的局部认证边界。
- 偏差与遗留：无实现偏差；局部 capability 不关闭 `P0-SEC-001`。

- [x] **Step 8: 提交**

```bash
git add apps/pi-server apps/desktop docs/developer docs/superpowers
git commit -m "feat(desktop): secure Skills-capable runs"
```

---

### Task 2: AgentClient `prepare/start/settled` 生命周期

**Files:**

- Modify: `apps/pi-server/src/agent/agent-client.ts`
- Modify: `apps/pi-server/src/agent/pi-coding-agent-client.ts`
- Modify: `apps/pi-server/src/agent/fake-agent-client.ts`
- Modify: `apps/pi-server/src/agent/scripted-fake-agent.ts`
- Modify: `apps/pi-server/src/app.ts`
- Modify: `apps/pi-server/test/pi-coding-agent-client.test.ts`
- Modify: `apps/pi-server/test/fake-agent-client.test.ts`
- Modify: `apps/pi-server/test/scripted-fake-agent.test.ts`
- Modify: `apps/pi-server/test/provider-chat.test.ts`
- Modify: `docs/developer/architecture.md`

**Interfaces:**

- Replaces: `AgentClient.run(input)` 和 `AgentRunResult.dispose()`。
- Produces:

```ts
export type AgentPrepareInput = Omit<AgentRunInput, "message" | "promptOptions" | "abortSignal">;

export type AgentRunExecution = {
  events: AsyncIterable<AgentRunEvent>;
  abort(): void;
  settled: Promise<void>;
};

export type PreparedAgentRun = {
  sessionFile: string;
  start(message: string, promptOptions?: PromptOptions): AgentRunExecution;
};

export interface AgentClient {
  prepare(input: AgentPrepareInput): Promise<PreparedAgentRun>;
  resolveApproval(sessionId: string, approvalId: string, decision: ApprovalDecision): boolean;
  cancelPending(sessionId: string): number;
}
```

- [x] **Step 1: 写生命周期失败测试**

覆盖四个可观察事实：

```ts
it("does not prompt during prepare", async () => {
  const prepared = await client.prepare(input);
  expect(session.prompt).not.toHaveBeenCalled();
  const execution = prepared.start("hello");
  expect(session.prompt).toHaveBeenCalledWith("hello", undefined);
  await execution.settled;
});

it("settles after a synchronous prompt failure", async () => {
  session.prompt.mockImplementation(() => {
    throw new Error("sync boom");
  });
  const execution = (await client.prepare(input)).start("hello");
  await expect(execution.settled).resolves.toBeUndefined();
  await expect(collect(execution.events)).rejects.toThrow("sync boom");
});

it("abort delegates to the prepared session", async () => {
  const execution = (await client.prepare(input)).start("hello");
  execution.abort();
  expect(session.abort).toHaveBeenCalledTimes(1);
});
```

Fake client 还要断言 approval pause/resolution 在新接口下顺序不变。

- [x] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm --filter @marginalia/pi-server test -- pi-coding-agent-client fake-agent-client scripted-fake-agent provider-chat
```

Expected: FAIL，因为 `prepare`/`start`/`settled` 尚不存在。

- [x] **Step 3: 改造 AgentClient 类型与 fake clients**

`FakeAgentClient.prepare()` 捕获当次 enqueue 的 event 副本；`start()` 才创建 iterator。它返回一个
始终可等待的 `settled`：iterator 正常结束、抛错或 abort 后 resolve，approval 行为沿用现有 pending
map。`ScriptedFakeAgentClient.prepare()` 只选脚本并委托 fake，不在 prepare 期间消费事件。

- [x] **Step 4: 改造 Pi client，确保 start 同步失败也有 execution**

`prepare()` 继续完成 model、policy、loader、registry acquire 和 thinking level；`start()` 内建立
queue/subscriptions，再用以下边界启动 prompt：

```ts
let resolveSettled!: () => void;
const settled = new Promise<void>((resolve) => {
  resolveSettled = resolve;
});

const finish = (failure?: unknown) => {
  if (finished) return;
  error = failure ?? null;
  finished = true;
  offApproval();
  unsubscribe?.();
  for (const waiter of waiters.splice(0)) waiter();
  resolveSettled();
};

try {
  Promise.resolve(handle.session.prompt(message, promptOptions)).then(
    () => finish(),
    (failure) => finish(failure)
  );
} catch (failure) {
  finish(failure);
}
```

iterator waiter 类型改成能在 `finish()` 后重新检查 `queue/error/finished`，保证 failure 不会被错误
转换成普通 done。`abort()` 只调用当前 handle 的 `session.abort()`。

- [x] **Step 5: 迁移 route 测试桩到新接口**

统一使用这个小 helper，避免每个测试重复不一致的 execution：

```ts
function preparedRun(events: AgentRunEvent[], sessionFile = "/tmp/test.jsonl") {
  return {
    sessionFile,
    start() {
      return {
        events: (async function* () {
          yield* events;
        })(),
        abort() {},
        settled: Promise.resolve()
      };
    }
  };
}
```

本任务只保持 route 外部行为通过；事务顺序在 Task 3 调整。

- [x] **Step 6: 更新内部生命周期文档并验证**

Run:

```bash
pnpm --filter @marginalia/pi-server test -- pi-coding-agent-client fake-agent-client scripted-fake-agent provider-chat approval-flow
pnpm --filter @marginalia/pi-server typecheck
pnpm docs:check
```

Expected: PASS；`prepare` 不 prompt，`start` 的所有出口都最终 settled。

**Implementation Outcome (Task 2):**

- 实际完成：`AgentClient` 已拆分为 `prepare/start/settled`；Pi client、fake clients 和 route
  callsite 已迁移，route 的 run 创建位置保持不变，未提前实现 Task 3 的事务顺序。
- RED：prescribed focused command 按预期出现 4 个失败文件、14 个失败测试，原因为
  `prepare()` 不存在及 route 仍调用旧 `run()`。
- GREEN：focused lifecycle/route/approval 共 29 tests 通过；pi-server typecheck、
  `pnpm docs:check` 和最终 `pnpm verify` 全通过。
- Review fix：prepared run 只允许一次 `start()`；fake abort 等待 iterator unwind 后才 settled。
- 正式文档：更新 `docs/developer/architecture.md`，记录 preparation 与 execution 生命周期。
- 偏差与遗留：原 Task 2 Files 清单漏列必需的 route callsite `apps/pi-server/src/app.ts`，已补入；
  无设计偏差或新增遗留。

- [x] **Step 7: 提交**

```bash
git add apps/pi-server docs/developer/architecture.md
git commit -m "refactor(pi-server): split agent preparation from execution"
```

---

### Task 3: Per-session run lease 与 pre-create 事务边界

**Files:**

- Create: **apps/pi-server/src/run/session-run-leases.ts**
- Create: **apps/pi-server/test/session-run-leases.test.ts**
- Create: **apps/pi-server/src/agent/agent-message.ts**
- Create: **apps/pi-server/test/agent-message.test.ts**
- Modify: `apps/pi-server/src/app.ts`
- Modify: `apps/pi-server/test/provider-chat.test.ts`
- Modify: `apps/pi-server/test/approval-flow.test.ts`
- Modify: `docs/developer/api.md`
- Modify: `docs/developer/architecture.md`

**Interfaces:**

- Consumes: Task 2 `AgentClient.prepare()`、`PreparedAgentRun.start()`、`execution.settled`。
- Produces:

```ts
export type RunLease = { release(): void };

export class SessionRunLeases {
  tryAcquire(sessionId: string): RunLease | null;
  isBusy(sessionId: string): boolean;
}

export async function buildAgentMessage(input: {
  workspaceRoot: string;
  text: string;
  contextFiles: readonly string[];
  skillBlocks?: readonly string[];
}): Promise<string>;
```

- [x] **Step 1: 写 lease 与 transaction 失败测试**

```ts
it("allows one lease per session and makes release idempotent", () => {
  const leases = new SessionRunLeases();
  const first = leases.tryAcquire("s1");
  expect(first).not.toBeNull();
  expect(leases.tryAcquire("s1")).toBeNull();
  first?.release();
  first?.release();
  expect(leases.tryAcquire("s1")).not.toBeNull();
});
```

Route integration 测试用 deferred `settled` 固定顺序：第一个 request 已 start 未 settled 时第二个返回
`409 { error: "session_busy" }`；断开触发 `abort()` 但 lease 直到 settled 后才释放。另写计数测试：
`prepare` 抛错、附件读取/消息构建抛错、`createRun` 抛错时 `runs` 表仍为 0 且 lease 已释放；
`start` 后失败则已有一条 failed run。

- [x] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm --filter @marginalia/pi-server test -- session-run-leases agent-message provider-chat approval-flow
```

Expected: FAIL，当前 route 在 stream 内才 prepare 且没有服务端 single-flight。

- [x] **Step 3: 实现最小 lease 和独立消息构建器**

```ts
export class SessionRunLeases {
  private readonly active = new Set<string>();

  tryAcquire(sessionId: string): RunLease | null {
    if (this.active.has(sessionId)) return null;
    this.active.add(sessionId);
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.active.delete(sessionId);
      }
    };
  }

  isBusy(sessionId: string): boolean {
    return this.active.has(sessionId);
  }
}
```

把现有 `buildAgentMessage` 原样迁入 `agent-message.ts`，在 `skillBlocks` 非空时按
`blocks + "\n\n" + text` 放在最前，附件 envelope 始终最后；保留 context path 去重和现有
`readDocument` 行为。

- [x] **Step 4: 重排 run handler**

handler 顺序固定为：auth → session/workspace → request decode/validation（含 provider）→
`tryAcquire` → message build → `agentClient.prepare` → `createRun` → return SSE。SSE callback 中：

```ts
let execution: AgentRunExecution | null = null;
try {
  await emit("run_started", { model: modelId });
  execution = prepared.start(agentMessage, promptOptions);
  const onAbort = () => {
    execution?.abort();
    agentClient.cancelPending(sessionId);
  };
  request.signal.addEventListener("abort", onAbort, { once: true });
  try {
    for await (const event of execution.events) await forward(event);
  } catch (failure) {
    execution.abort();
    throw failure;
  } finally {
    if (request.signal.aborted) execution.abort();
    try {
      await execution.settled;
    } finally {
      request.signal.removeEventListener("abort", onAbort);
    }
  }
} finally {
  try {
    agentClient.cancelPending(sessionId);
    expirePendingApprovals(db, run.id);
  } finally {
    lease.release();
  }
}
```

正常事件流结束时不要无条件 abort；`execution.abort()` 只放在 `request.signal.aborted` 或异常路径。
abort 路径在等待 `settled` 前取消挂起审批，final cleanup 保持幂等；所有 start 后失败都完成 DB
run，任何 createRun 前失败释放 lease 且不写 run。

- [x] **Step 5: 记录 API 错误与生命周期**

`docs/developer/api.md` 增加 `409 session_busy` 且说明不会创建 run；architecture 记录 lease 在
`settled` 后释放、SSE disconnect 发 abort 并立即取消挂起审批。

- [x] **Step 6: focused 验证**

Run:

```bash
pnpm --filter @marginalia/pi-server test -- session-run-leases agent-message provider-chat approval-flow
pnpm --filter @marginalia/pi-server typecheck
pnpm docs:check
```

Expected: PASS；同 session 重叠请求 409，不同 session 可并行。

- [x] **Step 7: 提交**

```bash
git add apps/pi-server docs/developer/api.md docs/developer/architecture.md
git commit -m "feat(pi-server): serialize runs per session"
```

**Implementation Outcome (Task 3):**

- 实际完成：新增进程内 per-session lease 和独立消息构建器；run route 在创建数据库记录前完成
  消息构建与 agent preparation，并在 execution `settled` 后释放 lease。
- RED：修正测试 fixture 后，prescribed focused command 出现 3 个失败文件和 4 个目标失败测试；
  缺失模块、同 session 重叠仍返回 200、prepare/message failure 仍发生在 SSE 内。
- GREEN：focused lease/message/route/approval 共 29 tests 通过；pi-server typecheck、
  `pnpm docs:check` 和最终 `pnpm verify` 全通过。
- 正式文档：更新 `docs/developer/api.md` 和 `docs/developer/architecture.md`，记录
  `409 session_busy`、pre-create 边界、disconnect abort 和 settled 后释放语义。
- Security review：disconnect/异常 abort 路径会在等待 `settled` 前取消挂起审批，避免审批等待
  阻止 settlement，final cleanup 保持幂等。
- Formal review fixes：request abort listener 保持到 `execution.settled` 后才移除，覆盖事件流已结束
  但 execution 仍在收尾的 disconnect；补充 events iterator exception 的 run/lease 直接回归测试，
  并把 route 顺序澄清为 auth → session/workspace → request/provider validation → lease → message →
  prepare → createRun → SSE/start。
- 偏差与遗留：provider 必须从 request body 取得 ID，因此 body JSON 解析仍先于 provider 校验；
  provider 校验后才取得 lease，消息附件构建和 preparation 均在 lease 内。无其他设计偏差；
  跨进程恢复与 ChatView 卸载后的主动停止仍由既有 readiness issues 跟踪。

---

### Task 4: SQLite v2 Skill preferences

**Files:**

- Create: **apps/pi-server/src/db/skill-preferences.ts**
- Create: **apps/pi-server/test/skill-preferences.test.ts**
- Modify: `apps/pi-server/src/db/migrations.ts`
- Modify: `apps/pi-server/test/db-connection.test.ts`
- Modify: `apps/pi-server/test/provider-chat.test.ts`
- Modify: `docs/developer/api.md`
- Modify: `docs/developer/architecture.md`

**Interfaces:**

- Produces:

```ts
export type SkillPreference = {
  skillPath: string;
  enabled: boolean;
  updatedAt: number;
};

export interface SkillPreferenceStore {
  enabledFor(skillPath: string): boolean;
  setEnabled(skillPath: string, enabled: boolean): SkillPreference;
  list(): SkillPreference[];
}

export function createSkillPreferenceStore(db: Database.Database): SkillPreferenceStore;
```

- [x] **Step 1: 写 v1 → v2 与 repository 失败测试**

测试先手工创建带 `schema_migrations(version=1)` 的 v1 DB，再调用 `migrate(db)`：

```ts
expect(db.prepare("select version from schema_migrations order by version").all()).toEqual([
  { version: 1 },
  { version: 2 }
]);
expect(tableNames(db)).toContain("skill_preferences");
expect(() =>
  db.prepare("insert into skill_preferences values (?, ?, ?)").run("/x", 2, 1)
).toThrow();
```

Repository 用例固定 default-enabled、upsert、canonical string 原样作为 key、以及文件消失后记录仍
存在（tombstone 不自动删除）。

- [x] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm --filter @marginalia/pi-server test -- skill-preferences db-connection provider-chat
```

Expected: FAIL，因为 migration 只有伪 v1 记录且没有 preferences 表。

- [x] **Step 3: 把 migration 改为顺序版本**

保留现有 v1 DDL，改为每个版本独立 transaction：

```ts
db.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
  );
`);
const applied = new Set(
  (db.prepare("select version from schema_migrations").all() as Array<{ version: number }>).map(
    (row) => row.version
  )
);

const migrations: ReadonlyArray<{ version: number; sql: string }> = [
  { version: 1, sql: V1_SQL },
  {
    version: 2,
    sql: `
      CREATE TABLE skill_preferences (
        skill_path TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        updated_at INTEGER NOT NULL
      );
    `
  }
];

for (const migration of migrations) {
  if (applied.has(migration.version)) continue;
  db.transaction(() => {
    db.exec(migration.sql);
    db.prepare("insert into schema_migrations (version, applied_at) values (?, ?)").run(
      migration.version,
      Date.now()
    );
  })();
}
```

现有 `sessions.model` 与 `agent_session_path` 兼容升级必须仍属于 v1 bootstrap：旧 DB 已有 version 1
但缺列的历史异常形态继续由幂等 column guard 修复，不能被 v2 重构破坏。

- [x] **Step 4: 实现 store**

`enabledFor` 没有 row 时返回 true；`setEnabled` 用
`INSERT ... ON CONFLICT(skill_path) DO UPDATE` 并返回 camelCase DTO；`list()` 只供 Catalog 一次性
构造 preference map，不在候选循环中做 N 次查询。

- [x] **Step 5: 更新数据库契约并验证**

Run:

```bash
pnpm --filter @marginalia/pi-server test -- skill-preferences db-connection provider-chat
pnpm --filter @marginalia/pi-server typecheck
pnpm docs:check
```

Expected: PASS；fresh DB 得到 v1+v2，真实 v1 DB 只补 v2，不丢既有数据。

**Task 4 results (2026-07-18):**

- 实际完成：SQLite migration 改为 v1/v2 顺序 transaction，新增带 `enabled IN (0, 1)` 约束的
  `skill_preferences`；`SkillPreferenceStore` 实现缺省启用、exact canonical string key、upsert、单次
  bulk list 和持久 tombstone。未提前实现 discovery、Catalog 或 HTTP API。
- RED：prescribed focused command exit 1；recorded-v1 只返回 version 1、fresh DB 缺 preferences 表，
  store module 尚不存在，共 2 个失败测试、1 个失败 suite、22 个既有测试通过。
- GREEN：prescribed focused suite 28/28 通过；补齐完整 suite 发现的旧 migration 断言后，扩展 focused
  suite 36/36 通过。pi-server typecheck、`pnpm docs:check` 与最终 `pnpm verify` 全通过；最终仓库门禁
  包含 docs 28、chat-core 14、pi-server 155（另 1 个 opt-in smoke skip）和 desktop 330 tests 及 builds。
- 正式文档：更新 `docs/developer/api.md` 和 `docs/developer/architecture.md` 的 v2 schema、兼容修复、
  preference key/default/upsert/list/tombstone 契约。
- Review：security、architecture 与 adversarial pass 无 finding。
- 偏差与遗留：原 Files 清单漏列已有断言 `apps/pi-server/test/workspace-session.test.ts`，完整门禁发现后
  已同步到 v1+v2；第一次全门禁先修复 API 文档格式，第二次暴露该旧断言，第三次完整通过。无实现
  偏差或新增遗留。
- Formal review fixes：v1 bootstrap/历史列修复现已在记录 v1 前由独立 `BEGIN IMMEDIATE`
  transaction 原子完成，v2 失败不会阻止已记录 v1 的必要修复；每个版本在取得写锁后重新检查
  `schema_migrations`，两个真实 worker connection 的同库回归证明并发 migrate 都成功且 v2 只应用
  一次。新增强制 v2 失败、version insert 回滚和部分 column repair 回滚覆盖。
- Formal review RED：原实现的 focused migration suite exit 1，3 项按预期失败（fresh v1 与异常 v1
  在 v2 失败后均缺兼容列；两个连接中一个报 `table skill_preferences already exists`），另有 5 项通过；
  独立 partial-repair rollback 校准在旧实现下 1 项失败、8 项 skipped。
- Formal review GREEN：Task 4 focused suite 41/41 通过，pi-server typecheck 与 `pnpm docs:check`
  通过；最终 `pnpm verify` 通过，包含 docs 28、chat-core 14、pi-server 160（另 1 个 opt-in smoke
  skip）、desktop 330 tests 和全部 builds。security、architecture 与 adversarial review 无 finding。

- [x] **Step 6: 提交**

```bash
git add apps/pi-server docs/developer/api.md docs/developer/architecture.md
git commit -m "feat(pi-server): persist Skill enablement preferences"
```

---

### Task 5: 六级 Skill discovery 与稳定顺序

**Files:**

- Create: **apps/pi-server/src/skills/types.ts**
- Create: **apps/pi-server/src/skills/discovery.ts**
- Create: **apps/pi-server/test/skill-discovery.test.ts**
- Modify: `docs/user/configuration.md`
- Modify: `docs/developer/architecture.md`

**Interfaces:**

- Consumes: Pi `loadSkillsFromDir()` 作为目录语义来源；本任务不解析 candidate metadata。
- Produces:

```ts
export type SkillSource =
  | "workspace_marginalia"
  | "workspace_pi"
  | "ancestor_agents"
  | "user_marginalia"
  | "user_pi"
  | "user_agents";

export type SkillScope = "workspace" | "user";
export type SkillDiscoveryMode = "pi" | "agents";

export type SkillDiagnostic = {
  code: string;
  level: "warning" | "error";
  message: string;
  path?: string;
};

export type DiscoveredSkillFile = {
  discoveredPath: string;
  sourceRoot: string;
  relativePath: string;
  source: SkillSource;
  scope: SkillScope;
  mode: SkillDiscoveryMode;
  sourcePriority: number;
  ancestorDepth: number;
};

export type SkillDiscoveryOptions = {
  workspaceRoot?: string | null;
  homeDir: string;
};

export function discoverSkillFiles(options: SkillDiscoveryOptions): Promise<DiscoveredSkillFile[]>;
```

- [x] **Step 1: 写 discovery table-driven 失败测试**

在临时 home/workspace/repo 中创建同名和不同名 fixtures，固定完整顺序：

```ts
expect(result.map((item) => item.source)).toEqual([
  "workspace_marginalia",
  "workspace_pi",
  "ancestor_agents",
  "ancestor_agents",
  "user_marginalia",
  "user_pi",
  "user_agents"
]);
```

同一测试组必须覆盖：Pi mode 根级 `foo.md` + nested `SKILL.md`；Agents mode 只保留
`SKILL.md`；ancestor nearest-first；`.git` 目录和 worktree `.git` 文件都停止；无 Git 时走到 filesystem
root；ancestor canonical root 等于 `~/.agents/skills` 时排除；symlink root；同 source 内用 POSIX
relative path 的 Unicode code-point 顺序，不依赖 readdir 顺序。

- [x] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm --filter @marginalia/pi-server test -- skill-discovery
```

Expected: FAIL，模块不存在。

- [x] **Step 3: 实现 root 枚举**

```ts
function sourceRoots(workspaceRoot: string | null, homeDir: string): SkillSourceRoot[] {
  const workspace = workspaceRoot
    ? [
        root(
          path.join(workspaceRoot, ".marginalia/skills"),
          "workspace_marginalia",
          "workspace",
          "pi",
          1
        ),
        root(path.join(workspaceRoot, ".pi/skills"), "workspace_pi", "workspace", "pi", 2),
        ...ancestorAgentRoots(workspaceRoot, homeDir)
      ]
    : [];
  return [
    ...workspace,
    root(path.join(homeDir, ".marginalia/skills"), "user_marginalia", "user", "pi", 4),
    root(path.join(homeDir, ".pi/agent/skills"), "user_pi", "user", "pi", 5),
    root(path.join(homeDir, ".agents/skills"), "user_agents", "user", "agents", 6)
  ];
}
```

`.marginalia`/`.pi` 只看 workspace root；ancestor `.agents` 从 workspace 向上到 Git root（含）或
filesystem root。用 `realpath` 比较 global agents root；不存在的 root 不报 fatal。

- [x] **Step 4: 复用 Pi 目录扫描语义并稳定排序**

对每个 root 调用 `loadSkillsFromDir({ dir, source })`，把 `skills[].filePath` 和
`diagnostics[].path` 的文件 path 合并；Agents mode 再过滤 `basename(path) === "SKILL.md"`。
这样复用 Pi 的 root markdown、递归、ignore 与 symlink 规则，同时让缺 description 的 invalid
文件仍能进入下一阶段。每个 root 去重后使用：

```ts
export function unicodeCodePointCompare(left: string, right: string): number {
  const a = Array.from(left);
  const b = Array.from(right);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const delta = a[index]!.codePointAt(0)! - b[index]!.codePointAt(0)!;
    if (delta !== 0) return delta;
  }
  return a.length - b.length;
}
```

排序 key 为 `sourcePriority` → `ancestorDepth` → normalized POSIX `relativePath`。

- [x] **Step 5: 更新磁盘目录正式文档**

`docs/user/configuration.md` 写六级顺序、两种 discovery mode、nearest ancestor/Git stop 与
global duplicate 排除；`docs/developer/architecture.md` 记录 discovery 只产 descriptor，不决定
valid/effective。

- [x] **Step 6: focused 验证**

Run:

```bash
pnpm --filter @marginalia/pi-server test -- skill-discovery
pnpm --filter @marginalia/pi-server typecheck
pnpm docs:check
```

Expected: PASS，重复执行得到相同顺序。

**Task 5 results (2026-07-18):**

- 实际完成：新增 descriptor-only discovery 类型和实现，按六级 source priority、ancestor depth、
  Unicode code-point POSIX relative path 输出稳定顺序；ancestor nearest-first，包含 `.git` 目录或
  worktree `.git` 文件标记的 Git root，无 Git 时继续到 filesystem root。Global Agents root 通过
  realpath 排除 canonical ancestor duplicate；缺失 root 非 fatal。
- Pi 兼容：每个 root 直接调用导出的 `loadSkillsFromDir()`，合并 `skills[].filePath` 与
  `diagnostics[].path` 后按 mode 过滤，因此 Pi mode 同时保留 root Markdown 与 nested `SKILL.md`，
  Agents mode 只保留 `SKILL.md`，缺 description 的文件仍进入后续阶段。本任务不解析 metadata、
  canonicalize candidate identity、读取 preference 或决定 collision/effective。
- RED：prescribed focused command exit 1；Vitest 无法加载尚不存在的
  `apps/pi-server/src/skills/discovery.ts`，1 个 suite 按预期失败且未收集测试。
- GREEN：focused suite 13/13 通过，并连续执行两次得到相同结果；pi-server typecheck 和
  `pnpm docs:check` 通过。最终 `pnpm verify` 通过，包含 docs 28、chat-core 14、pi-server 173（另
  1 个 opt-in smoke skip）、desktop 330 tests 及全部 builds。
- 正式文档：更新 `docs/user/configuration.md` 的六级目录、两种 mode、ancestor/Git stop、global
  duplicate 与稳定顺序契约；更新 `docs/developer/architecture.md` 的 Pi scanner 复用和
  descriptor-only 阶段边界。
- Review：base、architecture 和 adversarial pass 无 Task 5 契约 finding。Security pass 记录两项
  Pi loader inherited/upstream residual risk：候选由 Pi 以同步、无大小上限方式读取，超大文件可能
  阻塞或耗尽内存；Pi 的递归 directory symlink traversal 缺 active-realpath cycle guard，循环 symlink
  可能造成 CPU hang。最终 broad review 应继续跟踪这两项；本任务按已确认的 Pi-compatible scan
  契约不自建 prewalker/limit，也不改变 Pi symlink semantics。
- 偏差与遗留：无实现偏差；除上述 inherited/upstream Pi loader 风险外无新增遗留。Task 5 没有 UI
  变化，不需要 visual verification。

- [x] **Step 7: 提交**

```bash
git add apps/pi-server/src/skills apps/pi-server/test/skill-discovery.test.ts docs/user/configuration.md docs/developer/architecture.md
git commit -m "feat(pi-server): discover Skills in Pi-compatible order"
```

---

### Task 6: 单候选稳定读取与 Pi 原生解析

**Files:**

- Create: **apps/pi-server/src/skills/candidate-loader.ts**
- Create: **apps/pi-server/test/skill-candidate-loader.test.ts**
- Modify: **apps/pi-server/src/skills/types.ts**
- Modify: `docs/developer/architecture.md`

**Interfaces:**

- Consumes: Task 5 `DiscoveredSkillFile`；Pi `loadSkills({ skillPaths: [path], includeDefaults: false })`。
- Produces:

```ts
export const SKILL_EXPLICIT_BYTES = 512 * 1024;
export const SKILL_PREVIEW_BYTES = 256 * 1024;

export type ParsedSkillCandidate = DiscoveredSkillFile & {
  canonicalPath: string;
  canonicalBaseDir: string;
  skill: Skill | null;
  diagnostics: SkillDiagnostic[];
  bytesTotal: number;
  contentHash: string;
  explicitEligible: boolean;
  explicitOnly: boolean;
  rawContent: string | null;
  previewContent: string;
  previewTruncated: boolean;
};

export type CandidateLoaderDeps = {
  realpath(path: string): Promise<string>;
  readFile(path: string): Promise<Buffer>;
  parse(path: string): LoadSkillsResult;
};

export function loadSkillCandidate(
  descriptor: DiscoveredSkillFile,
  deps?: CandidateLoaderDeps
): Promise<ParsedSkillCandidate>;
```

- [x] **Step 1: 写稳定读取失败测试**

用 injectable deps 精确控制 A/parse/B：

```ts
it("accepts only metadata parsed between equal reads", async () => {
  const reads = [Buffer.from(V1), Buffer.from(V2), Buffer.from(V2), Buffer.from(V2)];
  const candidate = await loadSkillCandidate(descriptor, fakeDeps({ reads }));
  expect(candidate.rawContent).toBe(V2);
  expect(fakeParse).toHaveBeenCalledTimes(2);
});

it("publishes unstable_file after exactly three attempts", async () => {
  const candidate = await loadSkillCandidate(descriptor, alwaysChangingDeps());
  expect(fakeParse).toHaveBeenCalledTimes(3);
  expect(candidate.skill).toBeNull();
  expect(candidate.diagnostics).toContainEqual(expect.objectContaining({ code: "unstable_file" }));
});
```

再覆盖 valid、Pi warning 但有 Skill、缺 description 无 Skill、read failure、512 KiB 边界、超限只
保留 preview、`disable-model-invocation`、realpath 前后改变，以及 name/path/baseDir 含 XML 1.0
禁用控制字符。

- [x] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm --filter @marginalia/pi-server test -- skill-candidate-loader
```

Expected: FAIL，loader 不存在。

- [x] **Step 3: 实现三次稳定读取协议**

每次 attempt 严格执行：`realpath A → read A → parse(canonical A) → realpath B → read B`；只有
realpath 和 SHA-256 都相同时接受该 parsed result 与 B bytes。默认 parser：

```ts
const parse = (filePath: string): LoadSkillsResult =>
  loadSkills({
    cwd: path.dirname(filePath),
    agentDir: path.dirname(filePath),
    skillPaths: [filePath],
    includeDefaults: false
  });
```

每个 candidate 独立调用，不能先按 name/collision/disabled 跳过。三次都不稳定时返回 invalid
candidate，而不是 reject 整个 refresh。

- [x] **Step 4: 固定 valid/warning/size/control-char 判定**

Pi 返回 `skill` 即 valid，即使 diagnostics 有 warning；`skill === null` 才 invalid。正文用 UTF-8
decode；eligible candidate 保留最多 512 KiB 的完整 `rawContent`，其他只留 256 KiB prefix。
identifier 检查只接受 XML 1.0 合法字符：

```ts
export function hasUnsupportedXmlChar(value: string): boolean {
  for (const char of value) {
    const cp = char.codePointAt(0)!;
    if (cp === 0x9 || cp === 0xa || cp === 0xd) continue;
    if (cp >= 0x20 && cp <= 0xd7ff) continue;
    if (cp >= 0xe000 && cp <= 0xfffd) continue;
    if (cp >= 0x10000 && cp <= 0x10ffff) continue;
    return true;
  }
  return false;
}
```

- [x] **Step 5: 更新稳定 snapshot 契约并验证**

Run:

```bash
pnpm --filter @marginalia/pi-server test -- skill-candidate-loader
pnpm --filter @marginalia/pi-server typecheck
pnpm docs:check
```

Expected: PASS；warning candidate 仍 valid，第三次不稳定只影响该 candidate。

**Task 6 results (2026-07-18):**

- 实际完成：新增 `ParsedSkillCandidate`、512 KiB 显式正文与 256 KiB preview byte 常量，以及单
  candidate loader。每次最多三次严格执行 realpath A、read A、Pi parse(canonical A)、realpath B、
  read B；只有 canonical path 与 SHA-256 同时相等才发布夹在稳定 reads 之间的 parsed result 和 bytes
  B。失败或三次不稳定返回当前 invalid candidate diagnostic，不 reject 整体 refresh。
- Pi 与内容语义：默认 parser 每次只传一个 canonical path 且 `includeDefaults: false`；Pi warning 加
  `Skill` 仍 valid，只有没有 `Skill` 才 invalid。正文按 UTF-8 decode，所有大小决定按 Buffer bytes；
  512 KiB 边界可显式调用，超限只留 256 KiB preview；`disable-model-invocation` 映射
  `explicitOnly`。Name、canonical path 或 canonical base directory 含 XML 1.0 不支持字符时保留 Pi
  metadata、禁止显式调用并产生 `unsupported_identifier`。
- RED：prescribed focused command exit 1；Vitest 无法加载尚不存在的
  `apps/pi-server/src/skills/candidate-loader.ts`，1 个 suite 按预期失败且未收集测试。
- GREEN：focused suite 20/20 通过；pi-server typecheck 和 `pnpm docs:check` 通过。最终
  `pnpm verify` 通过，包含 docs 28、chat-core 14、pi-server 193（另 1 个 opt-in smoke skip）、
  desktop 330 tests 及全部 formatting、lint、typecheck 和 builds。
- 正式文档：更新 `docs/developer/architecture.md`，记录 per-candidate stable read/Pi parse、failure
  isolation、byte limits、identifier validation 和本阶段不处理 preference/collision/effective 的边界。
- Review：base 与 architecture pass 无 Task 6 contract finding。Security/adversarial pass 提出两项
  design-accepted residual risk：canonical Skill symlink target 可位于 source root 外；稳定性协议和 Pi
  parser 会在 512 KiB eligibility 判定前完整读取文件。前者是 spec 明确的 Pi-compatible symlink
  语义，后者延续 Task 5 已记录的 upstream Pi 同步无界读取风险；source-root containment 或 bounded
  pre-read 都会破坏已确认契约，因此本任务不修改。最终 broad review 应继续跟踪。
- 偏差与遗留：无实现偏差；除上述 design-accepted residual risks 外无新增遗留。Task 6 没有 UI
  变化，不需要 visual verification。

- [x] **Step 6: 提交**

```bash
git add apps/pi-server/src/skills apps/pi-server/test/skill-candidate-loader.test.ts docs/developer/architecture.md
git commit -m "feat(pi-server): parse stable Skill candidates"
```

---

### Task 7: 不可变 SkillCatalog snapshot、collision 与 revisions

**Files:**

- Create: **apps/pi-server/src/skills/catalog.ts**
- Create: **apps/pi-server/test/skill-catalog.test.ts**
- Modify: **apps/pi-server/src/skills/types.ts**
- Modify: `docs/user/concepts.md`
- Modify: `docs/user/configuration.md`
- Modify: `docs/developer/architecture.md`

**Interfaces:**

- Consumes: Task 4 `SkillPreferenceStore`、Task 5 discovery、Task 6 parsed candidate。
- Produces:

```ts
export type SkillStatus = "effective" | "shadowed" | "disabled" | "invalid";

export type SkillCandidate = ParsedSkillCandidate & {
  enabled: boolean;
  effective: boolean;
  status: SkillStatus;
  shadowedBy: string | null;
};

export type SkillCatalogSnapshot = Readonly<{
  workspaceId: string | null;
  workspaceRoot: string | null;
  catalogRevision: string;
  effectiveRevision: string;
  refreshedAt: number;
  candidates: readonly SkillCandidate[];
  effectiveSkills: readonly Skill[];
  diagnostics: readonly SkillDiagnostic[];
}>;

export interface SkillCatalogService {
  refresh(input: {
    workspaceId: string | null;
    workspaceRoot: string | null;
  }): Promise<SkillCatalogSnapshot>;
  current(input: {
    workspaceId: string | null;
    workspaceRoot: string | null;
  }): SkillCatalogSnapshot | null;
  setEnabled(input: {
    workspaceId: string | null;
    workspaceRoot: string | null;
    path: string;
    enabled: boolean;
  }): Promise<SkillCatalogSnapshot>;
}

export class SkillCandidateNotFoundError extends Error {
  readonly code = "skill_candidate_not_found";
}
```

- [x] **Step 1: 写 reducer 与 refresh 失败测试**

Table cases 必须固定 status precedence 和 first-wins：

```ts
const cases = [
  { valid: false, enabled: false, winner: false, status: "invalid" },
  { valid: true, enabled: false, winner: false, status: "disabled" },
  { valid: true, enabled: true, winner: false, status: "shadowed" },
  { valid: true, enabled: true, winner: true, status: "effective" }
] as const;
```

另测：disabled 高优先级 winner 不占 name，下一 enabled valid 同名候选接替；same canonical alias
保留第一次；同 source 内路径排序稳定；`catalogRevision` 随 diagnostics/preference/preview 变化；
`effectiveRevision` 只随 effective metadata/path/order/body hash 变化；同状态反复 refresh revision
不变；旧 generation 不能覆盖新 snapshot；global-only 与 workspace cache 隔离；symlink retarget 后
旧 canonical selection 不再属于新 snapshot。

- [x] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm --filter @marginalia/pi-server test -- skill-catalog
```

Expected: FAIL，Catalog 不存在。

- [x] **Step 3: 实现纯 snapshot reducer**

先 realpath identity 去重，再一次读取 `preferences.list()` 构造 Map；对全部 parsed candidates
应用 `invalid > disabled > collision`：

```ts
const winnerByName = new Map<string, SkillCandidate>();
for (const candidate of candidates) {
  if (!candidate.skill) {
    publish(candidate, "invalid");
    continue;
  }
  if (!candidate.enabled) {
    publish(candidate, "disabled");
    continue;
  }
  const winner = winnerByName.get(candidate.skill.name);
  if (winner) {
    publish(candidate, "shadowed", winner.canonicalPath);
    continue;
  }
  winnerByName.set(candidate.skill.name, candidate);
  publish(candidate, "effective");
}
```

effective `LoadSkillsResult` 直接由第一阶段保存的 Pi `Skill` objects 和聚合 diagnostics 组成，不
再次读盘、不把 Pi 已 collision 后的结果拿来反向过滤。

- [x] **Step 4: 实现 revision 与串行 refresh**

对稳定 JSON projection 用 SHA-256；projection 数组保持 discovery 顺序，object key 手工固定。
每个 canonical workspace root（global 用固定 key）维护 promise chain + generation。只有当前最高
generation 可 `snapshots.set(key, deepFreeze(snapshot))`；失败不覆盖上一份成功 snapshot，但当前
调用仍 reject，让 picker 禁止新增。

- [x] **Step 5: 同步概念和配置文档**

`docs/user/concepts.md` 把 Skills 从 disabled 概念改为 effective/shadowed/disabled/invalid 和
explicit-only；`docs/user/configuration.md` 记录 canonical path preference、winner 接替、refresh
触发与无 watcher；architecture 记录两阶段解析与双 revision。

- [x] **Step 6: focused 验证**

Run:

```bash
pnpm --filter @marginalia/pi-server test -- skill-discovery skill-candidate-loader skill-catalog skill-preferences
pnpm --filter @marginalia/pi-server typecheck
pnpm docs:check
```

Expected: PASS；相同磁盘状态在乱序 readdir 下产生相同 revisions。

**Task 7 results (2026-07-18):**

- 实际完成：新增 immutable Skill catalog service 与类型。Reducer 先按 canonical path first-wins
  去重，再用单次 preference `list()` map 按 invalid、disabled、collision precedence 发布完整
  candidate、effective Pi Skill clones 和聚合 diagnostics；invalid/disabled 不占 name，shadowedBy
  固定指向 canonical winner。
- Revision 与 cache：稳定 fixed-key JSON projection 生成 SHA-256 `catalogRevision` 和
  `effectiveRevision`；前者覆盖管理可见 candidate/diagnostic/preference/preview，后者只覆盖 effective
  metadata/path/order/body hash。Canonical workspace/global cache 分区，per-key promise chain 与
  generation 阻止旧 refresh 发布；失败 reject 且保留既有 snapshot。
- Immutability 与 mutation：snapshot 深拷贝 loader-owned Pi Skill/sourceInfo/diagnostics 后递归冻结，
  不冻结上游共享对象，也不重新读盘或 parse。`setEnabled()` 执行 refresh、exact canonical membership、
  preference upsert、refresh；缺失或 symlink retarget 后旧 path 抛 `skill_candidate_not_found`。
- RED：规定 `skill-catalog` command exit 1，Vitest 因 `catalog.js` 尚不存在而在收集前失败。GREEN：
  catalog 21/21；Task 4–7 focused suite 63/63，pi-server typecheck 和 `pnpm docs:check` 全通过。
- 全门禁：`pnpm verify` 通过，包含 docs 28、chat-core 14、pi-server 219（另 1 个 opt-in smoke skip）、
  desktop 330 tests，以及 formatting、lint、typecheck 和全部 builds。
- 正式文档：更新 user concepts/configuration 与 developer architecture，记录四状态、explicit-only、
  canonical preference/winner handoff、显式 refresh/无 watcher、两阶段 reducer 和双 revision。
- Review：deep security pass 提出 workspace root TOCTOU、unbounded candidate loads 与 cold-cache staged
  success 三项；修复前 focused RED 为 3 failed/18 passed，修复后 21/21。现在每次 refresh 只 canonicalize
  workspace root 一次并贯穿 key/discovery/snapshot，以固定四 worker 加载 candidate，并在最新 generation
  失败时发布最近 staged success。Canonical alias 仍在 Task 6 load 后去重，避免破坏 per-descriptor invalid
  diagnostics 契约。最终 base/architecture/adversarial re-review 无 finding。
- 偏差与遗留：无实现偏差或新增依赖。Task 7 无 UI-visible change，不运行 visual verification。Task 5/6
  已记录的 Pi discovery 同步无界读取、symlink cycle 和单文件完整读取 residual risks 保持不变。

**Formal review fixes (Task 7 collision diagnostics):**

- 扩展 serializable `SkillDiagnostic`，保留 Pi-compatible structured collision identity；Task 6 mapper、
  Task 7 clone/deep-freeze 和 `catalogRevision` projection 都保留该结构。
- 每个 enabled valid shadowed loser 的 cloned diagnostics 追加 deterministic `pi_collision` warning，
  loser/winner 均使用 canonical path；aggregate diagnostics 同步包含。Parsed candidate inputs 不变，
  invalid、disabled 和 canonical alias 不生成 collision diagnostic。
- RED：candidate-loader 与 catalog focused command 为 2 failed/46 passed，分别证明 Pi collision identity
  被 mapper 丢弃和 shadowed loser 缺 diagnostic。GREEN：两 suite 49/49；Task 4–7 focused suite 66/66，
  typecheck、docs check 和全 `pnpm verify` 通过。无 Task 8 实现或新增 residual risk。

- [x] **Step 7: 提交**

```bash
git add apps/pi-server/src/skills apps/pi-server/test/skill-catalog.test.ts docs/user docs/developer/architecture.md
git commit -m "feat(pi-server): publish immutable Skill catalogs"
```

---

### Task 8: Skills HTTP API 与 snapshot membership

**Files:**

- Create: **apps/pi-server/test/skills-api.test.ts**
- Modify: `apps/pi-server/src/app.ts`
- Modify: **apps/pi-server/src/skills/catalog.ts**
- Modify: **apps/pi-server/src/skills/types.ts**
- Modify: `docs/developer/api.md`
- Modify: `docs/contracts/docs-impact.json`

**Interfaces:**

- Consumes: Task 1 capability、Task 7 `SkillCatalogService`。
- Produces:
  - `GET /skills?workspaceId=<optional>` → public snapshot without `rawContent`/Pi objects。
  - `PATCH /skills/state` body `{ path, enabled, workspaceId? }` → refreshed public snapshot。
  - `GET /skills/content?path=<canonical>&workspaceId=<optional>` → `{ path, content, truncated, bytesTotal }`。

- [x] **Step 1: 写 Skills API 失败测试**

用 injected fake Catalog 固定响应，覆盖：缺/错 token 401、evil Origin 403、无 workspace global-only、
unknown workspace 404、GET 强制 refresh、响应不含 `rawContent`/`skill`、invalid candidate 可 preview、
preview 截断、unknown/cross-workspace/arbitrary `/etc/passwd` path 404、toggle 只允许当前 snapshot member、
toggle 后再次 refresh 并返回新 revision、Catalog 整体 refresh reject 时返回不泄露 path/bytes 的 500。

```ts
expect(await response.json()).toMatchObject({
  workspaceId: null,
  catalogRevision: "catalog-1",
  effectiveRevision: "effective-1"
});
expect(JSON.stringify(await clone.json())).not.toContain("rawContent");
```

- [x] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm --filter @marginalia/pi-server test -- skills-api
```

Expected: FAIL，routes 不存在。

- [x] **Step 3: 增加 AppOptions 依赖与公开 DTO mapper**

`AppOptions` 增加可注入 `skillCatalog?: SkillCatalogService`；默认用 db preference store 构造真实
Catalog。公开 mapper 明确逐字段复制：name/description 缺失时为 null，包含 discovered/canonical
path、source/scope/status/enabled/effective/explicitOnly/explicitEligible/diagnostics/shadowedBy/
bytesTotal，不复制 bytes、hash、Pi `Skill` object。

- [x] **Step 4: 以字符串字面量注册三个 route**

必须继续在 `app.ts` 写：

```ts
app.get("/skills", ...);
app.patch("/skills/state", ...);
app.get("/skills/content", ...);
```

这样 `docs:check` route inventory 可静态识别。每个 handler 先 capability，再解析可选 workspace，
通过 `getWorkspace` 得到 server-owned root；path 只做 `snapshot.candidates.find(canonicalPath === path)`，
绝不 `readFile(requestPath)`。PATCH 委托 `skillCatalog.setEnabled()`，其内部顺序是 refresh →
membership → preference upsert → refresh；unknown member 以 typed not-found failure 返回 404。

- [x] **Step 5: 更新 API inventory 与 docs-impact**

`docs/developer/api.md` 的 route inventory 增加三个 route，并逐字段记录 request/response/401/403/
404；`docs/contracts/docs-impact.json` 增加覆盖 `apps/pi-server/src/skills/**`、desktop Skills UI 和
store 的规则，要求 user guide/configuration、developer API/architecture、product status 同步。

- [x] **Step 6: focused 验证**

Run:

```bash
pnpm --filter @marginalia/pi-server test -- skills-api skill-catalog capability
pnpm --filter @marginalia/pi-server typecheck
pnpm docs:check
```

Expected: PASS；token 持有者也不能读取 snapshot 外 path。

**Implementation Outcome (2026-07-18):**

- 实际完成：三个字符串字面量 Skills route、可注入/默认 SQLite Catalog、server-owned workspace
  resolution、explicit public DTO mapper、snapshot-only preview 与 typed membership toggle 已落地；GET
  每次 refresh，PATCH 保持 refresh → membership → preference → refresh。
- 授权与泄漏边界：三个 handler 都在 query/body/workspace/refresh 前执行 capability；public snapshot
  不发布 workspace root、preview/body、content hash、Pi Skill 或 effectiveSkills；content 只返回刚刷新
  snapshot member 的 canonical identity 和 preview fields，不按 request path 读盘。
- RED/GREEN：初始 `skills-api` 为 16 failed/1 passed，失败均来自 route 缺失；首轮 GREEN 为 17/17。
  Deep review 另发现非 boolean `enabled` 会被 truthy 值误解释，新增 focused RED 为 1 failed/20 passed，
  加入 JSON/schema validation 后最终为 21/21。
- 验证：Skills API/catalog/capability focused suite 52/52，pi-server typecheck、`pnpm docs:check` 与完整
  `pnpm verify` 通过；完整门禁包含 docs 28、chat-core 14、pi-server 243（另 1 个 opt-in smoke skip）、
  desktop 330 tests 和全部 build。
- 正式文档：API inventory/请求响应/400/401/403/404/500 与 snapshot membership 已记录；docs-impact
  新规则覆盖 server Skills、desktop Skills UI/store，并要求 user guide/configuration、developer
  API/architecture 和 product status 同步。
- Review：deep security/architecture/adversarial pass 无未处理 finding。Out-of-root Skill symlink 是已批准
  discovery 契约的高敏感 residual：需要有效 capability 加已存在且可发现的 symlink；单独提交任意 path
  仍为 404。Task 8 不新增 source-root containment，content route 也不重读 symlink target。
- 偏差与遗留：新增 `400 invalid request` runtime schema guard 以落实 documented request shape；其余无实现
  偏差、无新增依赖、无 UI-visible change，因此不运行 visual verification。

- [x] **Step 7: 提交**

```bash
git add apps/pi-server docs/developer/api.md docs/contracts/docs-impact.json
git commit -m "feat(pi-server): expose read-only Skills management API"
```

---

### Task 9: Run Skill preflight、XML blocks 与 revision-pinned loader

**Files:**

- Create: **apps/pi-server/src/skills/turn-preflight.ts**
- Create: **apps/pi-server/test/skill-turn-preflight.test.ts**
- Modify: `apps/pi-server/src/agent/agent-client.ts`
- Modify: **apps/pi-server/src/agent/agent-message.ts**
- Modify: `apps/pi-server/src/agent/agent-session-registry.ts`
- Modify: `apps/pi-server/src/agent/pi-coding-agent-client.ts`
- Modify: `apps/pi-server/src/app.ts`
- Modify: **apps/pi-server/test/agent-message.test.ts**
- Modify: `apps/pi-server/test/agent-session-registry.test.ts`
- Modify: `apps/pi-server/test/pi-coding-agent-client.test.ts`
- Modify: `apps/pi-server/test/provider-chat.test.ts`
- Modify: `docs/developer/api.md`
- Modify: `docs/developer/architecture.md`

**Interfaces:**

- Consumes: Task 3 lease/transaction、Task 7 internal snapshot、Task 8 API identity。
- Produces:

```ts
export type SkillSelection = { name: string; path: string };
export type InvalidSelectionReason =
  | "missing"
  | "disabled"
  | "invalid"
  | "shadowed"
  | "name_mismatch"
  | "too_large"
  | "unsupported_identifier";

export type AgentRuntimeSkills = {
  effectiveRevision: string;
  loadResult: LoadSkillsResult;
};

export type PreparedSkillTurn = {
  selections: readonly SkillSelection[];
  blocks: readonly string[];
  runtime: AgentRuntimeSkills;
};

export function prepareSkillTurn(
  snapshot: SkillCatalogSnapshot,
  selections: readonly SkillSelection[]
): PreparedSkillTurn;
```

- [ ] **Step 1: 写纯 preflight 失败测试**

覆盖 0/1/N selections、canonical path 首次去重与顺序、全部 invalid reasons、name mismatch 不自动
改绑、disabled winner 后旧 path 不改绑 successor、16/17 数量边界、512 KiB item、2 MiB total、
explicit-only 可显式调用、五种 attribute entities、References text escaping、unsupported control char。

```ts
expect(plan.blocks.join("\n\n")).toBe(
  '<skill name="a&amp;b" location="/tmp/a&amp;b/SKILL.md">\n' +
    "References are relative to /tmp/a&amp;b.\n\nBody\n</skill>"
);
```

测试所有 409/413 都发生在 `prepare`/`createRun` 之前，数据库 run count 保持 0。

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm --filter @marginalia/pi-server test -- skill-turn-preflight agent-message agent-session-registry pi-coding-agent-client provider-chat
```

Expected: FAIL，run body 不认识 `skills`，loader 仍固定无 Skills。

- [ ] **Step 3: 实现选择校验与 Pi-compatible body extraction**

先按 path 去重保留第一次，再逐项 exact membership。用与 Pi 0.75.5 一致的 newline/frontmatter
规则提取 body，避免引入 YAML parser：

```ts
export function stripPiFrontmatter(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.startsWith("---")) return normalized;
  const endIndex = normalized.indexOf("\n---", 3);
  return endIndex === -1 ? normalized : normalized.slice(endIndex + 4).trim();
}
```

builder 分别实现 `escapeXmlAttribute`（`& " < > '`）和 `escapeXmlText`（`& < >`），绝不有损替换
control chars。block UTF-8 byte size 用 `Buffer.byteLength`，合计超过限制抛 typed 413 error。

- [ ] **Step 4: 让 registry 按 effectiveRevision 重建**

`AcquireInput` 增加 `resourceRevision: string`，`SessionHandle` 保存同字段。cache hit 只有 revision 相同
才复用；不同则先 evict 旧 handle，再以同一个 `agentSessionPath` 建新 session。该方法只在 Task 3
lease 内调用。测试 active execution 期间 route 不会调用 acquire；空闲后的 revision 变化才重建。

- [ ] **Step 5: 注入 pinned skillsOverride**

`AgentPrepareInput` 增加 `runtimeSkills: AgentRuntimeSkills`。Pi client 创建 loader：

```ts
const pinned = input.runtimeSkills.loadResult;
const loader = new DefaultResourceLoader({
  cwd: input.workspaceRoot,
  agentDir: path.join(homedir(), ".marginalia", "pi-agent"),
  noExtensions: true,
  noSkills: true,
  noPromptTemplates: true,
  noThemes: true,
  noContextFiles: true,
  skillsOverride: () => ({
    skills: [...pinned.skills],
    diagnostics: [...pinned.diagnostics]
  }),
  extensionFactories: [createApprovalExtension(...) as unknown as ExtensionFactory]
});
```

registry `resourceRevision` 使用 `effectiveRevision`。只有 diagnostics/disabled loser 等 catalog-only
变化不会重建 session。

Pi client integration test 还要读取 loader 的 `getSkills()` 和最终 system prompt fixture：effective
Skills 被注入；`disableModelInvocation=true` 的 Skill 保留在 loader 供显式调用，但被 Pi 原生
`formatSkillsForPrompt` 排除在隐式 system prompt 之外。

- [ ] **Step 6: 集成 run preflight transaction**

run body 增加 `skills?: SkillSelection[]`。lease 内先 `catalog.refresh`，再 `prepareSkillTurn`，然后
`buildAgentMessage({ skillBlocks: plan.blocks, ... })`，成功后才 `agentClient.prepare({ runtimeSkills:
plan.runtime, ... })` 和 `createRun`。typed failures 响应：

```ts
return c.json(
  {
    error: "skill_precondition_failed",
    catalogRevision: snapshot.catalogRevision,
    invalidSelections: failure.invalidSelections
  },
  409
);
```

数量/total payload 返回 `413 { error: "skill_payload_too_large" }`。0 Skills 仍传当前 runtime snapshot，
因为 Pi system prompt 需要隐式 effective Skills；因此所有 run 都需 capability。

- [ ] **Step 7: 更新 run API 与架构**

`docs/developer/api.md` 记录 `skills` body、去重、409 body/reasons、413 和 createRun 前置性；
architecture 记录 `skillsOverride`、effectiveRevision session rebuild、完整 prompt 顺序：Skill blocks
→ user text → attached_files。

- [ ] **Step 8: focused 验证**

Run:

```bash
pnpm --filter @marginalia/pi-server test -- skill-turn-preflight agent-message agent-session-registry pi-coding-agent-client provider-chat skill-catalog
pnpm --filter @marginalia/pi-server typecheck
pnpm docs:check
```

Expected: PASS；0/1/N Skills 与隐式 loader 使用同一 effectiveRevision，所有 precondition failure
无 run row、无 start。

- [ ] **Step 9: 提交**

```bash
git add apps/pi-server docs/developer/api.md docs/developer/architecture.md
git commit -m "feat(pi-server): preflight Skill-enabled agent runs"
```

---

### Task 10: Live/reopened 共用的 user prompt 展示归一化

**Files:**

- Create: **packages/chat-core/src/user-display.ts**
- Create: **packages/chat-core/src/user-display.test.ts**
- Modify: `packages/chat-core/src/index.ts`
- Modify: `apps/pi-server/src/agent/session-messages.ts`
- Modify: `apps/pi-server/test/session-messages.test.ts`
- Modify: `docs/developer/architecture.md`

**Interfaces:**

- Consumes: Task 9 生成的连续 leading `<skill>` blocks 和既有 trailing `<attached_files>` envelope。
- Produces:

```ts
export type UserDisplay = {
  text: string;
  skillNames: readonly string[];
};

export function formatUserDisplayText(text: string, skillNames: readonly string[]): string;

export function normalizeAgentPromptForDisplay(raw: string): UserDisplay;
```

- [ ] **Step 1: 写 pure parser 失败测试**

覆盖 0/1/N blocks、五种 entity decoding、Skill 已从磁盘删除、normal attachment suffix、没有 Skill
但有 attachment、malformed leading block 完整 fail-closed、malformed attachment 只保留 suffix、body 中
伪 closing tag 的已知 V1 降级、以及普通用户文本不变：

```ts
expect(normalizeAgentPromptForDisplay(twoSkillPrompt)).toEqual({
  skillNames: ["brainstorming", "pdf"],
  text: "$brainstorming $pdf\n\nReview this document"
});

expect(normalizeAgentPromptForDisplay("<skill broken\n\nhello")).toEqual({
  skillNames: [],
  text: "<skill broken\n\nhello"
});
```

Session test 在调用 `readMessagesFromSessionFile` 前后读取原文件并断言 bytes 完全相同。

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm --filter @marginalia/chat-core test -- user-display
pnpm --filter @marginalia/pi-server test -- session-messages
```

Expected: FAIL，shared helper 不存在，历史仍返回完整 prompt。

- [ ] **Step 3: 实现严格 leading block parser**

不使用 Pi `parseSkillBlock()`，因为它只支持单 block。循环规则固定为：

```ts
const SKILL_OPEN = /^<skill name="([^"\r\n]*)" location="([^"\r\n]*)">\n/;
const SKILL_CLOSE = "\n</skill>";

function parseLeadingSkills(raw: string): { names: string[]; rest: string } | null {
  let rest = raw;
  const names: string[] = [];
  while (rest.startsWith("<skill")) {
    const open = SKILL_OPEN.exec(rest);
    if (!open) return null;
    const closeAt = rest.indexOf(SKILL_CLOSE, open[0].length);
    if (closeAt < 0) return null;
    const name = decodeXmlAttribute(open[1]!);
    const location = decodeXmlAttribute(open[2]!);
    if (name === null || location === null) return null;
    names.push(name);
    rest = rest.slice(closeAt + SKILL_CLOSE.length);
    if (rest === "") break;
    if (!rest.startsWith("\n\n")) return null;
    rest = rest.slice(2);
    if (!rest.startsWith("<skill")) break;
  }
  return names.length > 0 ? { names, rest } : { names: [], rest: raw };
}
```

`decodeXmlAttribute` 只接受 `&amp; &quot; &lt; &gt; &apos;`；任何其他 entity 返回 null。

- [ ] **Step 4: 实现严格 attachment suffix 与 formatter**

只从最后一个 `\n\n<attached_files>\n` 开始尝试，并要求 wrapper 到字符串末尾、内部完全由
Marginalia 生成的 `<attached_file ...>\n...\n</attached_file>` blocks 组成；不完整则保持 suffix。
如果 raw 以疑似 `<skill` 开头但 skill parser 失败，整个 raw 原样返回，不再单独剥附件。

```ts
export function formatUserDisplayText(text: string, skillNames: readonly string[]): string {
  const markers = skillNames.map((name) => `$${name}`).join(" ");
  if (!markers) return text;
  return text ? `${markers}\n\n${text}` : markers;
}
```

- [ ] **Step 5: 只在 history API 的展示副本上应用**

`session-messages.ts` 对 user message clone：

```ts
const message =
  sessionMessage.role === "user"
    ? {
        ...sessionMessage,
        content: normalizeAgentPromptForDisplay(sessionMessage.content).text
      }
    : sessionMessage;
result.push({ id, message });
```

不查询 Catalog、不改文件、不改变 assistant/toolResult。

- [ ] **Step 6: focused 验证**

Run:

```bash
pnpm --filter @marginalia/chat-core test -- user-display
pnpm --filter @marginalia/chat-core typecheck
pnpm --filter @marginalia/pi-server test -- session-messages provider-chat
pnpm --filter @marginalia/pi-server typecheck
pnpm docs:check
```

Expected: PASS；重开只看到 markers + user text，session bytes 未改。

- [ ] **Step 7: 提交**

```bash
git add packages/chat-core apps/pi-server/src/agent/session-messages.ts apps/pi-server/test/session-messages.test.ts docs/developer/architecture.md
git commit -m "feat(chat-core): normalize Skill-enabled user prompts"
```

---

### Task 11: Desktop Skills API 与结构化错误

**Files:**

- Modify: `apps/desktop/src/api/client.ts`
- Create: **apps/desktop/src/api/client.skills.test.ts**
- Modify: `apps/desktop/src/api/client.test.ts`
- Modify: `apps/desktop/src/hooks/useStreamingChat.test.ts`

**Interfaces:**

- Consumes: Task 1 sensitive headers、Task 8 Skills routes、Task 9 run request/error。
- Produces:

```ts
export type SkillSelection = { name: string; path: string };
export type SkillStatus = "effective" | "shadowed" | "disabled" | "invalid";

export type SkillDiagnostic = {
  code: string;
  level: "warning" | "error";
  message: string;
  path?: string;
};

export type InvalidSkillSelection = {
  name: string;
  path: string;
  reason:
    | "missing"
    | "disabled"
    | "invalid"
    | "shadowed"
    | "name_mismatch"
    | "too_large"
    | "unsupported_identifier";
  winnerPath?: string;
};

export type SkillCandidate = {
  name: string | null;
  description: string | null;
  discoveredPath: string;
  canonicalPath: string;
  source: string;
  scope: "workspace" | "user";
  status: SkillStatus;
  enabled: boolean;
  effective: boolean;
  explicitOnly: boolean;
  explicitEligible: boolean;
  shadowedBy: string | null;
  bytesTotal: number;
  diagnostics: SkillDiagnostic[];
};

export type SkillCatalogSnapshot = {
  workspaceId: string | null;
  catalogRevision: string;
  effectiveRevision: string;
  refreshedAt: number;
  candidates: SkillCandidate[];
  diagnostics: SkillDiagnostic[];
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details: Record<string, unknown>
  ) {
    super(message);
    this.name = "ApiError";
  }
}
```

- [ ] **Step 1: 写 client 失败测试**

断言三个 Skills methods 和 run 都有 bearer；普通 `listWorkspaces` 没 bearer；workspaceId/path query
使用 `URLSearchParams`；PATCH body 精确；401/409/413 保留 status/code/details，尤其：

```ts
await expect(api.runChat("s1", runInput)).rejects.toMatchObject({
  name: "ApiError",
  status: 409,
  code: "skill_precondition_failed",
  details: {
    invalidSelections: [{ name: "pdf", path: "/old", reason: "missing" }]
  }
});
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm --filter @marginalia/desktop test -- client.skills client useStreamingChat
```

Expected: FAIL，client 没 Skills DTO/methods，错误被压扁为普通 Error。

- [ ] **Step 3: 实现统一 response error decoder**

```ts
async function apiError(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const code = typeof body.error === "string" ? body.error : "http_error";
  const message = typeof body.message === "string" ? body.message : code;
  return new ApiError(message, response.status, code, body);
}
```

`request`、`requestNoContent`、`runChat` 都使用此 decoder；不再通过 message 字符串判断 409。

- [ ] **Step 4: 增加 Skills methods 与 run selection**

```ts
listSkills(workspaceId?: string | null): Promise<SkillCatalogSnapshot>;
setSkillEnabled(input: {
  path: string;
  enabled: boolean;
  workspaceId?: string | null;
}): Promise<SkillCatalogSnapshot>;
readSkillContent(input: {
  path: string;
  workspaceId?: string | null;
}): Promise<{ path: string; content: string; truncated: boolean; bytesTotal: number }>;
```

`runChat` input 增加 `skills?: SkillSelection[]`，body 原顺序传输。三个 Skills methods 与 run 使用
`sensitiveHeaders()`，其余 API 继续用普通 JSON header。

- [ ] **Step 5: focused 验证**

Run:

```bash
pnpm --filter @marginalia/desktop test -- client.skills client useStreamingChat
pnpm --filter @marginalia/desktop typecheck
```

Expected: PASS；typed errors 的 details 未丢失。

- [ ] **Step 6: 提交**

```bash
git add apps/desktop/src/api apps/desktop/src/hooks/useStreamingChat.test.ts
git commit -m "feat(desktop): add typed Skills API client"
```

---

### Task 12: Scoped TurnDraft、pendingTurn 与 `run_started` 接受边界

**Files:**

- Modify: `apps/desktop/src/store/app-store.ts`
- Modify: `apps/desktop/src/store/app-store.test.ts`
- Modify: `apps/desktop/src/chat/Composer/Composer.tsx`
- Modify: `apps/desktop/src/chat/Composer/Composer.test.tsx`
- Modify: `apps/desktop/src/chat/NewThreadView.tsx`
- Modify: `apps/desktop/src/chat/NewThreadView.test.tsx`
- Modify: `apps/desktop/src/chat/ChatView.tsx`
- Modify: `apps/desktop/src/chat/ChatView.test.tsx`
- Modify: `apps/desktop/src/hooks/useStreamingChat.ts`
- Modify: `apps/desktop/src/hooks/useStreamingChat.test.ts`
- Modify: `apps/desktop/src/i18n/messages.ts`

**Interfaces:**

- Consumes: Task 10 `formatUserDisplayText`、Task 11 `SkillSelection`/`ApiError`。
- Produces:

```ts
export type TurnDraft = {
  text: string;
  contextFiles: string[];
  skills: SkillSelection[];
};

export type PendingTurn = {
  sessionId: string;
  turn: TurnDraft;
};

export type TurnOwner = `session:${string}` | `new:${string}`;

type SendCallbacks = {
  onAccepted(turn: TurnDraft, optimisticEntry: ChatEntry): void;
  onError(error: ApiError | Error, accepted: boolean): void;
};
```

- [ ] **Step 1: 写 store isolation 失败测试**

覆盖 `session:s1`、`session:s2`、`new:w1`、`new:w2` 四个 owner 的 text/files/skills 不串用；
canonical path 去重保留第一次；`moveTurnDraft("new:w1", "session:s3")` 原子移动；`clearTurnDraft`
只清目标；persist JSON 不含 `turnDrafts` 或 `pendingTurn`。

```ts
expect(persisted.state).not.toHaveProperty("turnDrafts");
expect(persisted.state).not.toHaveProperty("pendingTurn");
```

- [ ] **Step 2: 写接受时序失败测试**

`useStreamingChat` 分别模拟 HTTP 409（无 SSE）、`run_started` 后 failure、以及 stream 在 started 前
结束。断言：

```ts
expect(onAccepted).not.toHaveBeenCalled(); // 409
expect(onUserAppend).not.toHaveBeenCalled();

expect(onAccepted).toHaveBeenCalledTimes(1); // run_started 后
expect(onUserAppend).toHaveBeenCalledWith(
  expect.objectContaining({
    message: expect.objectContaining({ content: "$pdf\n\nReview" })
  })
);
```

- [ ] **Step 3: 运行测试确认失败**

Run:

```bash
pnpm --filter @marginalia/desktop test -- app-store useStreamingChat Composer NewThreadView ChatView
```

Expected: FAIL，draft 在 Composer local state、pending 只有 string、bubble 在 HTTP 接受前追加。

- [ ] **Step 4: 实现非持久化 scoped draft actions**

删除全局 `pendingPrompt`/`contextFiles`，增加：

```ts
getTurnDraft(owner: TurnOwner): TurnDraft;
setTurnText(owner: TurnOwner, text: string): void;
addTurnContextFile(owner: TurnOwner, path: string): void;
removeTurnContextFile(owner: TurnOwner, path: string): void;
addTurnSkill(owner: TurnOwner, skill: SkillSelection): void;
removeTurnSkill(owner: TurnOwner, path: string): void;
replaceTurnSkills(owner: TurnOwner, skills: SkillSelection[]): void;
clearTurnDraft(owner: TurnOwner): void;
moveTurnDraft(from: TurnOwner, to: TurnOwner): TurnDraft;
setPendingTurn(turn: PendingTurn | null): void;
claimPendingTurn(sessionId: string): TurnDraft | null;
```

所有 getter 缺项返回新的 empty draft，不能共享可变 singleton。

- [ ] **Step 5: 把 Composer 改为受控值**

Props 精确改为 `text/onTextChange/contextFiles/.../skills/...`；删除 local `draft`，trigger/menu 仍可
local。`submit()` 只调用 `onSubmit({ text: text.trim(), contextFiles, skills })`，绝不清 text/files/skills；
清理由 owner 在 run acceptance 后执行。

- [ ] **Step 6: 改造 New Thread handoff**

owner 为 `new:${activeWorkspaceId ?? "global"}`。创建 session 成功后：

```ts
const turn = moveTurnDraft(owner, `session:${session.id}`);
setPendingTurn({ sessionId: session.id, turn });
setActiveSession(session.id);
setView("chat");
```

workspace 切换只改变 owner，不删除其他 workspace draft。session 创建失败不移动 draft。

- [ ] **Step 7: 以 `run_started` 接受并清空对应 owner**

ChatView mount 时先调用 `claimPendingTurn(sessionId)`：matching envelope 原子取出并清空，避免失败后
rerender/remount 自动重复发送；实际 `session:<id>` draft 仍保留。`useStreamingChat.send(turn)` 在遍历
到首个 `run_started` 时才生成 optimistic user entry，content 用
`formatUserDisplayText(turn.text, turn.skills.map(s => s.name))`，并调用 `onAccepted` 一次。ChatView 的
`onAccepted` 清 `session:<id>` 并设置 `lastSent`；precondition 失败不清 draft。

`lastSent` 只记录已 accepted turn；Retry 只从该对象发送完整 `{ text, contextFiles, skills }`。

- [ ] **Step 8: focused 验证**

Run:

```bash
pnpm --filter @marginalia/desktop test -- app-store useStreamingChat Composer NewThreadView ChatView
pnpm --filter @marginalia/desktop typecheck
```

Expected: PASS；Settings unmount、workspace/session 切换与 401/409/413 都不丢或串 draft。

- [ ] **Step 9: 提交**

```bash
git add apps/desktop/src/store apps/desktop/src/chat apps/desktop/src/hooks/useStreamingChat.ts apps/desktop/src/hooks/useStreamingChat.test.ts apps/desktop/src/i18n/messages.ts
git commit -m "feat(desktop): preserve scoped Skill turn drafts"
```

---

### Task 13: `$` picker、Slash Skills 分区与有序 chips

**Files:**

- Create: **apps/desktop/src/hooks/useSkillCatalog.ts**
- Create: **apps/desktop/src/hooks/useSkillCatalog.test.tsx**
- Create: **apps/desktop/src/chat/Composer/SkillMenu.tsx**
- Create: **apps/desktop/src/chat/Composer/SkillMenu.test.tsx**
- Create: **apps/desktop/src/chat/Composer/SkillChip.tsx**
- Create: **apps/desktop/src/chat/Composer/SkillChip.test.tsx**
- Modify: `apps/desktop/src/chat/Composer/SlashMenu.tsx`
- Modify: `apps/desktop/src/chat/Composer/SlashMenu.test.tsx`
- Modify: `apps/desktop/src/chat/Composer/Composer.tsx`
- Modify: `apps/desktop/src/chat/Composer/Composer.test.tsx`
- Modify: `apps/desktop/src/chat/Composer/useMenuNav.ts`
- Modify: `apps/desktop/src/i18n/messages.ts`

**Interfaces:**

- Consumes: Task 11 snapshot/API、Task 12 controlled `skills`。
- Produces:

```ts
export type SkillPickerItem = Omit<
  Pick<
    SkillCandidate,
    "name" | "description" | "canonicalPath" | "source" | "explicitOnly" | "diagnostics"
  >,
  "name"
> & { name: string };

export function useSkillCatalog(
  api: ApiClient,
  workspaceId: string | null
): {
  snapshot: SkillCatalogSnapshot | null;
  loading: boolean;
  error: ApiError | Error | null;
  refresh(): Promise<SkillCatalogSnapshot | null>;
};
```

- [ ] **Step 1: 写 hook stale-response 失败测试**

用两个 deferred responses：w1 请求先发后回，切到 w2 后 w2 先回；断言最终 snapshot 只能是 w2。
同 workspace 连续两个 request 也只接受最新 requestId。refresh reject 时保留旧 snapshot 供展示，但
返回 null 且暴露 error，picker 不允许从旧结果新增 selection。

- [ ] **Step 2: 写菜单与 chips 失败测试**

覆盖 `$` 打开 Skill-only menu、query 搜索 name/description、`/` 同时显示 Commands/Skills headings、
keyboard ArrowDown 只遍历 selectable rows、选择 Skill 删除 trigger token 且正文不写 `/skill:*`、
chips 顺序、canonical dedupe、remove、warning/explicit-only badge、empty/loading/error。显式断言没有
`/skills` 管理 command；名为 `skills` 的磁盘 Skill 仍是 Skill row。

- [ ] **Step 3: 运行测试确认失败**

Run:

```bash
pnpm --filter @marginalia/desktop test -- useSkillCatalog SkillMenu SkillChip SlashMenu Composer
```

Expected: FAIL，只有 `/`/`@` trigger 和静态 commands。

- [ ] **Step 4: 实现带 requestId/workspace guard 的 hook**

```ts
const requestId = useRef(0);
const workspaceRef = useRef(workspaceId);
workspaceRef.current = workspaceId;

function asError(failure: unknown): Error {
  return failure instanceof Error ? failure : new Error(String(failure));
}

const refresh = useCallback(async () => {
  const id = ++requestId.current;
  const requestedWorkspace = workspaceId;
  setLoading(true);
  try {
    const next = await api.listSkills(requestedWorkspace);
    if (id !== requestId.current || workspaceRef.current !== requestedWorkspace) return null;
    setSnapshot(next);
    setError(null);
    return next;
  } catch (failure) {
    if (id === requestId.current && workspaceRef.current === requestedWorkspace)
      setError(asError(failure));
    return null;
  } finally {
    if (id === requestId.current) setLoading(false);
  }
}, [api, workspaceId]);
```

workspace change 时递增 requestId 并清当前 snapshot/error，避免把另一 workspace 的 rows 暂时展示。
NewThreadView/ChatView mount 以及 workspace owner 改变时主动调用一次 `refresh()`；菜单每次打开仍再
refresh，从而同时满足 workspace-switch 与 picker-open 两个刷新事件。

- [ ] **Step 5: 增加第三类 trigger 与 picker eligibility**

`Trigger.kind` 增加 `"skill"`，regex 扩展为 `([/@$])`。每次 `$` 或 `/` menu 打开都调用 `refresh()`。
eligible list 只包含 `effective && enabled && status === "effective" && explicitEligible && name !== null`。
refresh 失败后菜单只显示 error/retry，不允许点击旧 row。

- [ ] **Step 6: 合并 Slash rows 但保持扁平导航**

```ts
type SlashRow =
  | { kind: "command"; key: string; name: string; help: string }
  | { kind: "skill"; key: string; skill: SkillPickerItem };

const selectableRows: SlashRow[] = [
  ...filteredCommands.map(commandRow),
  ...filteredSkills.map(skillRow)
];
```

section labels 不进入数组。`useMenuNav` 继续接一维 rows；onSelect 返回 discriminated union。command
保持既有行为，skill 统一调用 `onAddSkill({ name, path: canonicalPath })`。

- [ ] **Step 7: 渲染 chips 并接 controlled store actions**

chips 位于附件卡上方或同一区域，显示 `$name`、source tooltip、remove button；canonical path 是 key。
`Composer` 不自己去重，调用 Task 12 store action，保证所有入口使用同一 dedupe。所有 aria labels、
empty/error/status copy 加 en/zh keys。

- [ ] **Step 8: focused 验证**

Run:

```bash
pnpm --filter @marginalia/desktop test -- useSkillCatalog SkillMenu SkillChip SlashMenu Composer NewThreadView ChatView
pnpm --filter @marginalia/desktop typecheck
```

Expected: PASS；`$` 和 `/` 生成相同 structured identity，不出现 `/skills` command。

- [ ] **Step 9: 提交**

```bash
git add apps/desktop/src/hooks/useSkillCatalog.ts apps/desktop/src/hooks/useSkillCatalog.test.tsx apps/desktop/src/chat/Composer apps/desktop/src/i18n/messages.ts
git commit -m "feat(desktop): select Skills from dollar and slash menus"
```

---

### Task 14: Settings → Skills 只读管理页

**Files:**

- Create: **apps/desktop/src/settings/SkillsPane.tsx**
- Create: **apps/desktop/src/settings/SkillsPane.test.tsx**
- Modify: **apps/desktop/src/hooks/useSkillCatalog.ts**
- Modify: **apps/desktop/src/hooks/useSkillCatalog.test.tsx**
- Modify: `apps/desktop/src/settings/SettingsView.tsx`
- Modify: `apps/desktop/src/settings/SettingsView.test.tsx`
- Modify: `apps/desktop/src/app/AppShell.tsx`
- Modify: `apps/desktop/src/app/AppShell.test.tsx`
- Modify: `apps/desktop/src/i18n/messages.ts`

**Interfaces:**

- Consumes: Task 11 Skills API、Task 13 catalog hook。
- Produces:

```ts
type SkillsPaneProps = {
  api: ApiClient;
  workspace: { id: string; name: string } | null;
};

// Added to useSkillCatalog result:
setEnabled(path: string, enabled: boolean): Promise<SkillCatalogSnapshot | null>;
```

- [ ] **Step 1: 写 Settings 失败测试**

覆盖：Skills tab 可点击且打开即 refresh；有效 workspace 显示 name 并请求 workspaceId；stale
`activeWorkspaceId` 不在已加载列表时传 null/global-only；搜索 name/description/discovered/canonical
path；四种 status；warning 与 explicit-only 独立 badges；source + discovered + canonical path；row
选择后 lazy content fetch；invalid 仍 preview；truncated 提示；toggle 返回新 snapshot；manual refresh；
API failure retry；无 create/import/install/edit/uninstall controls。

```ts
expect(
  screen.queryByRole("button", { name: /create|import|install|edit/i })
).not.toBeInTheDocument();
expect(api.listSkills).toHaveBeenCalledWith(null); // stale workspace fallback
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm --filter @marginalia/desktop test -- SkillsPane SettingsView AppShell useSkillCatalog
```

Expected: FAIL，Skills tab disabled，没有 pane。

- [ ] **Step 3: 扩展 hook 的 toggle 与 stale guard**

`setEnabled` 捕获调用时 workspaceId/requestId；调用 `api.setSkillEnabled` 返回的 snapshot 只有在
workspace 仍匹配时落地。开始 toggle 时不 optimistic 改 status；失败保留原 snapshot 并暴露 error，
避免 winner 接替的复杂状态在 client 重算。

- [ ] **Step 4: 实现列表/详情双栏但保持现有 Settings 宽度体系**

左侧：search input + status/source rows；右侧：selected candidate metadata、diagnostics、只读 preview。
状态 label 精确为 Effective、Enabled · Shadowed、Disabled、Invalid；warning/explicit-only 另渲染。
toggle 的 checked 来自 `candidate.enabled`，Invalid candidate 也显示真实 preference。所有颜色使用
既有 surface/border/text/emerald tokens，不加 ad-hoc hex/oklch。

`SettingsView` 只为 Skills 放宽内容宽度，其他 tab 保持现状：

```tsx
<div className={cn("w-full", tab === "skills" ? "max-w-[920px]" : "max-w-[440px]")}>
  {tab === "general" && <GeneralPane />}
  {tab === "providers" && <ProvidersPane api={api} />}
  {tab === "skills" && <SkillsPane api={api} workspace={skillsWorkspace} />}
</div>
```

- [ ] **Step 5: 严格处理 preview response race**

row selection 递增 `contentRequestId`，response 只有 candidate canonicalPath、workspaceId 与 requestId
仍匹配时落地；切 row/workspace 时先清 preview。preview 只展示 server content，不再从 path 读文件。

- [ ] **Step 6: 在 AppShell 解析可信 workspace context**

```ts
const activeWorkspace = useMemo(
  () => workspaces.data.find((workspace) => workspace.id === activeWorkspaceId) ?? null,
  [workspaces.data, activeWorkspaceId]
);

<SettingsView
  api={api}
  skillsWorkspace={activeWorkspace ? { id: activeWorkspace.id, name: activeWorkspace.name } : null}
/>
```

Settings tab 移除 disabled；MCP 仍 disabled。SkillsPane mount 时 refresh，tab 返回时重新 mount/refresh。

- [ ] **Step 7: 加 i18n 并 focused 验证**

Run:

```bash
pnpm --filter @marginalia/desktop test -- SkillsPane SettingsView AppShell useSkillCatalog useTranslation
pnpm --filter @marginalia/desktop typecheck
```

Expected: PASS；global-only 与 workspace 视图都可搜索、preview、toggle、refresh。

- [ ] **Step 8: 提交**

```bash
git add apps/desktop/src/settings apps/desktop/src/app/AppShell.tsx apps/desktop/src/app/AppShell.test.tsx apps/desktop/src/hooks/useSkillCatalog.ts apps/desktop/src/hooks/useSkillCatalog.test.tsx apps/desktop/src/i18n/messages.ts
git commit -m "feat(desktop): manage disk Skills from Settings"
```

---

### Task 15: Precondition blocked 修复流、Retry 与正式产品文档

**Files:**

- Create: **apps/desktop/src/chat/SkillPreconditionBanner.tsx**
- Create: **apps/desktop/src/chat/SkillPreconditionBanner.test.tsx**
- Modify: **apps/desktop/src/chat/Composer/SkillChip.tsx**
- Modify: **apps/desktop/src/chat/Composer/SkillChip.test.tsx**
- Modify: `apps/desktop/src/chat/Composer/Composer.tsx`
- Modify: `apps/desktop/src/chat/ChatView.tsx`
- Modify: `apps/desktop/src/chat/ChatView.test.tsx`
- Modify: `apps/desktop/src/chat/NewThreadView.tsx`
- Modify: **apps/desktop/src/hooks/useSkillCatalog.ts**
- Modify: `apps/desktop/src/i18n/messages.ts`
- Modify: `docs/user/guide.md`
- Modify: `docs/user/concepts.md`
- Modify: `docs/user/configuration.md`
- Modify: `docs/developer/issues/2026-07-11-product-readiness-audit.md`
- Modify: `docs/product/status.md`

**Interfaces:**

- Consumes: Task 11 `InvalidSkillSelection`/`ApiError.details.invalidSelections`、Task 12 accepted flag、
  Task 13/14 refresh。
- Produces:

```ts
type SkillPreconditionBannerProps = {
  invalidSelections: readonly InvalidSkillSelection[];
  refreshing: boolean;
  onRefresh(): void;
  onRemove(path: string): void;
  onOpenSettings(): void;
};
```

- [ ] **Step 1: 写 blocked flow 失败测试**

分别模拟 `session_busy`、`skill_precondition_failed`、`skill_payload_too_large`、401 和普通
`run_started → run_failed`：

- precondition/401/413 不追加 bubble、不清 text/files/chips、不显示普通 Retry；
- invalidSelections 只标红 matching canonical chips；
- Refresh 后保留 chips，移除只删指定 path，Open Settings 切 view 后返回仍恢复 draft；
- `session_busy` 不触发 Catalog refresh；
- 只有已 accepted 的 run failure 显示普通 Retry，Retry 带原 text/files/skills 并重新 preflight。

```ts
expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
expect(screen.getByTestId("skill-chip-/old/pdf")).toHaveAttribute("data-invalid", "true");
expect(store.getTurnDraft("session:s1")).toEqual(originalTurn);
```

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
pnpm --filter @marginalia/desktop test -- SkillPreconditionBanner SkillChip ChatView NewThreadView useStreamingChat
```

Expected: FAIL，所有错误仍被压成 string 并进入同一 retry UI。

- [ ] **Step 3: 在 ChatView 保留 typed failure state**

```ts
type BlockedTurn =
  | { code: "skill_precondition_failed"; invalidSelections: InvalidSkillSelection[] }
  | { code: "skill_payload_too_large" | "session_busy" | "unauthorized"; message: string };
```

`onError(error, accepted)`：accepted=true 才写普通 stream error/Retry；accepted=false 且 error 是
ApiError 时按 code 写 BlockedTurn。Skill failure 同时将 invalid path Set 下传 chips。普通 Error 在
started 前作为 non-retry composer banner，仍不清 draft。

- [ ] **Step 4: 实现三种修复动作**

- Refresh：调用当前 workspace 的 `useSkillCatalog.refresh()`；成功后根据最新 candidate status
  清除已恢复 path 的红色标记，但不自动替换/删除 chip；最终发送仍 server preflight。
- Remove：调用 scoped store `removeTurnSkill(owner, path)` 并从 invalid set 删除。
- Open Settings：`setView("settings")`；Settings/ChatView 互斥 unmount 由 scoped store 保留现场。

为让 banner 与 picker 共用 refresh state，把 `useSkillCatalog` owner 提升到 NewThreadView/ChatView，
再以 controller props 传 Composer；不得创建两个会互相覆盖的 UI cache。

- [ ] **Step 5: 完成 Retry 与 first-turn 回归**

`lastSent` 只在 `onAccepted` 设置；Retry 前删除上一 accepted attempt 的 optimistic bubbles，再发送
完整 frozen turn。New Thread 的 `pendingTurn` 已由 Task 12 在首次 claim 时清空，因此自动提交失败
不会 loop；`session:<newId>` draft 保留，用户修复后手动 Send 使用同一 turn。

- [ ] **Step 6: 同步 user/status/issue 正式文档**

- `docs/user/guide.md`：`$`/`/`、多 chips、Settings 管理、Refresh、blocked send、Retry 和 read-only 限制。
- `docs/user/concepts.md`：隐式 metadata 与显式完整正文、Pi session/history display 边界。
- `docs/user/configuration.md`：六级 root、preference、token 自动管理、16/512 KiB/2 MiB/256 KiB 限制。
- `docs/product/status.md`：`CAP-SKILLS-001` 从 disabled 改 `partial`，evidence 指向 Catalog/API/UI；
  `P1-EXTENSIONS-001` 继续 open，但摘要改为 MCP 仍不可用且 Skills v1 不含安装/编辑生态。
- readiness audit 的 `P1-EXTENSIONS-001` evidence/修复目标同步；`P0-SEC-001` 仍 open，并明确局部
  capability 未保护其余 loopback routes。

- [ ] **Step 7: focused 验证**

Run:

```bash
pnpm --filter @marginalia/desktop test -- SkillPreconditionBanner SkillChip ChatView NewThreadView Composer useSkillCatalog useStreamingChat
pnpm --filter @marginalia/desktop typecheck
pnpm docs:check
```

Expected: PASS；所有 blocked path 都保留完整 draft，普通 accepted failure 的 Retry 不回归。

- [ ] **Step 8: 提交**

```bash
git add apps/desktop docs/user docs/product/status.md docs/developer/issues/2026-07-11-product-readiness-audit.md
git commit -m "feat(desktop): recover blocked Skill turns"
```

---

### Task 16: Electron 视觉覆盖、仓库门禁与记录归档

**Files:**

- Modify: `apps/desktop/scripts/verify-screenshots.mjs`
- Modify: `apps/desktop/scripts/verify-screenshots.test.ts`
- Modify: `apps/desktop/scripts/README.md`
- Create: **apps/desktop/screenshots-baseline/skills-flow/skills-settings.png**
- Create: **apps/desktop/screenshots-baseline/skills-flow/skill-picker-dollar.png**
- Create: **apps/desktop/screenshots-baseline/skills-flow/slash-skills.png**
- Create: **apps/desktop/screenshots-baseline/skills-flow/skill-chips.png**
- Create: **apps/desktop/screenshots-baseline/skills-flow/skills-global-only.png**
- Create: **apps/desktop/screenshots-baseline/skills-flow/skill-diagnostics.png**
- Create: **apps/desktop/screenshots-baseline/skills-flow/skill-precondition-blocked.png**
- Modify then move: `docs/superpowers/specs/2026-07-18-skills-integration-design.md`
- Modify then move: `docs/superpowers/plans/2026-07-18-skills-integration.md`
- Modify: `docs/superpowers/README.md`
- Modify: `docs/internal/README.md`

**Interfaces:**

- Consumes: 全部功能、正式文档与既有 screenshot harness。
- Produces: deterministic `skills-flow` default scenario、clean `pnpm verify`、人工裁决后的 visual baseline、
  archived spec/plan with Implementation Outcome。

- [ ] **Step 1: 写 screenshot scenario contract 失败测试**

新增 default `skills-flow`，expected labels 精确为：

```js
[
  "skills-settings",
  "skill-picker-dollar",
  "slash-skills",
  "skill-chips",
  "skills-global-only",
  "skill-diagnostics",
  "skill-precondition-blocked"
];
```

测试还断言 fixture HOME/workspace 只写入 `.marginalia/skills`、`.pi/skills`、`.agents/skills`，不
读取开发者真实 HOME；scenario 使用 `MARGINALIA_FAKE_AGENT=1`。

- [ ] **Step 2: 运行 scenario unit test 确认失败**

Run:

```bash
pnpm --filter @marginalia/desktop test -- verify-screenshots
```

Expected: FAIL，scenario 和 labels 不存在。

- [ ] **Step 3: 实现 deterministic Skills fixture/scenario**

在 isolated `runRoot/home` 与 seed workspace 写至少这些 fixtures：effective、同名 shadowed、disabled、
invalid missing description、warning invalid-name、explicit-only、body >512 KiB。通过真实 UI 完成
Settings 搜索/选行、toggle、`$`、`/`、多 chips；blocked shot 在选择后删除对应 fixture，再 Send，
等待 409 UI。global-only shot 使用 stale/cleared workspace context，不修改开发者状态。

`waitForPiServerUrl` 改为返回 `{ url, capabilityToken }`，只有 screenshot harness 的 Skills API helper
需要 bearer；token 不写 summary/manifest。

- [ ] **Step 4: 运行 focused screenshot capture 并检查每张图**

Run:

```bash
pnpm --filter @marginalia/desktop verify:screenshots -- --scenario skills-flow
pnpm --filter @marginalia/desktop compare:screenshots
```

Expected: report 中七张均为 `new`（第一次）或 intentional `changed`；人工打开
`output/visual-diff/report.md` 和每张 PNG，检查信息层级、截断、hover-independent controls、中文/英文
不混杂、blocked 修复动作可见。发现问题先改 UI/测试并重跑，不直接 bless。

- [ ] **Step 5: 带具体理由更新七张 baseline**

```bash
pnpm --filter @marginalia/desktop compare:screenshots \
  --update-baseline skills-flow \
  --reason "Add the approved read-only Skills management, dual picker, chips, diagnostics, and blocked-turn states"
```

Expected: 七张 baseline 写入 **apps/desktop/screenshots-baseline/skills-flow/**，无 orphan。

- [ ] **Step 6: 调用 required completion skills 并运行完整门禁**

执行者在声称完成前必须调用 `check` 与 `superpowers:verification-before-completion`，然后运行：

```bash
pnpm verify
pnpm verify:visual
```

Expected: `pnpm verify` 全绿；visual report 为 `changed=0 new=0 orphan=0 errors=0`。即使命令 exit 0，
也再次打开 report 确认七张 skills-flow 和所有既有 scenario 都是 unchanged。

- [ ] **Step 7: 写 Implementation Outcome 并归档 active records**

先收集本计划实际实现 commits：

```bash
git log --reverse --format='%h %s' b97d789..HEAD
```

在 spec/plan 记录实际完成项、任何 Deviation、两条完整验证命令与结果、更新过的 formal docs、上面
输出的 7–40 位 commit SHAs、remaining issues（至少保留 MCP 与整体 `P0-SEC-001`）。把状态改为
`archived`、`outcome: completed`、写 `archived_at: 2026-07-18`，再：

```bash
git mv docs/superpowers/specs/2026-07-18-skills-integration-design.md docs/internal/specs/2026-07-18-skills-integration-design.md
git mv docs/superpowers/plans/2026-07-18-skills-integration.md docs/internal/plans/2026-07-18-skills-integration.md
```

同一 change 从 active index 删除两条记录，并在 `docs/internal/README.md` 增加 stable IDs 的 archive
entries。再次运行 `pnpm docs:check`。

- [ ] **Step 8: 提交 closeout**

```bash
git add apps/desktop/scripts apps/desktop/screenshots-baseline docs
git commit -m "feat(desktop): verify and close out Skills integration"
```

- [ ] **Step 9: 最终证据检查**

Run:

```bash
git status --short
git log --oneline -16
pnpm docs:check
```

Expected: worktree clean；任务 commits 与归档引用一致；docs check PASS。不要 push、开 PR 或发布，
除非用户另行明确要求。
