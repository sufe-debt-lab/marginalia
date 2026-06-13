# PR-1: 让 UI 不再撒谎 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让"启动时打开上次会话"开关真正生效、移除空壳的 slash 命令菜单、移除无 onClick 的顶栏 ⓘ 按钮——消除三处 UI 与实际行为不符的"摆设"控件。

**Architecture:** 纯 `apps/desktop` 前端改动。续传逻辑落在 `AppShell` 挂载时的一次性校验 effect（读 persist 的 `activeSessionId`，经 `listSessions` 校验仍存在则切到 chat，否则清空回 New chat）；`activeSessionId` 加入 zustand persist 白名单。Slash 与 ⓘ 都是删除多余代码 + i18n key。

**Tech Stack:** React 18 + TypeScript（ESM，import 带 `.js` 后缀）、Zustand（`persist` middleware）、Vitest + jsdom + Testing Library。i18n 走 `t()`，en/zh 双写（zh 用 `satisfies` 强校验）。

来源 spec：`docs/internal/specs/2026-06-12-design-review-and-fixes-design.md` → PR-1，覆盖问题 1、2、3。

---

## File Structure

会修改的文件及职责：

- `apps/desktop/src/store/app-store.ts` — 把 `activeSessionId` 加入 `partialize` 白名单（续传的前提）。
- `apps/desktop/src/app/AppShell.tsx` — 新增一次性续传校验 effect。
- `apps/desktop/src/app/AppShell.test.tsx` — 续传三态测试。
- `apps/desktop/src/chat/Composer/Composer.tsx` — `detectTrigger` 只保留 `@`；删除 slash 分支、`slashQuery` state、`SlashMenu` 渲染。
- `apps/desktop/src/chat/Composer/Composer.test.tsx` — 删除"`/` 弹菜单"测试。
- `apps/desktop/src/chat/Composer/SlashMenu.tsx` — 删除整个文件。
- `apps/desktop/src/chat/Composer/SlashMenu.test.tsx` — 删除整个文件。
- `apps/desktop/src/chat/Composer/useMenuNav.ts` — 保留（`MentionMenu` 仍在用）。
- `apps/desktop/src/app/Topbar.tsx` — 删除 chat 视图的 ⓘ 按钮及其 `Info` import。
- `apps/desktop/src/app/Topbar.test.tsx` — 无需改（未断言 ⓘ）；跑通即可。
- `apps/desktop/src/i18n/messages.ts` — 删除 `composer.slashClear/slashHelp/slashModel`、`common.sessionInfo`；改 `composer.chatPlaceholder` 文案（不再提 `/`）。

---

## Task 1: `activeSessionId` 进入 persist 白名单

**Files:**

- Modify: `apps/desktop/src/store/app-store.ts`（`partialize`，约 138-151 行）
- Test: `apps/desktop/src/store/app-store.test.ts`

- [ ] **Step 1: 写失败测试**

在 `apps/desktop/src/store/app-store.test.ts` 末尾（最后一个 `});` 之前的合适位置）追加。先看文件顶部已有的 import 与 reset 方式，复用同样的 `useAppStore` import。新增：

```ts
it("persists activeSessionId so a session can be resumed after restart", () => {
  localStorage.clear();
  useAppStore.getState().setActiveSession("session-xyz");
  const stored = JSON.parse(localStorage.getItem("marginalia-app") || "{}");
  expect(stored.state?.activeSessionId).toBe("session-xyz");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @marginalia/desktop test -- app-store`
Expected: FAIL — `stored.state.activeSessionId` 为 `undefined`（当前不在白名单）。

- [ ] **Step 3: 实现**

在 `app-store.ts` 的 `partialize` 返回对象里加入 `activeSessionId`（放在 `activeWorkspaceId` 下一行）：

```ts
partialize: (s) => ({
  activeWorkspaceId: s.activeWorkspaceId,
  activeSessionId: s.activeSessionId,
  locale: s.locale,
  leftSidebarCollapsed: s.leftSidebarCollapsed,
  rightPanelCollapsed: s.rightPanelCollapsed,
  pinnedWorkspaceIds: s.pinnedWorkspaceIds,
  leftSidebarWidth: s.leftSidebarWidth,
  rightPanelWidth: s.rightPanelWidth,
  permission: s.permission,
  reasoning: s.reasoning,
  composerProviderId: s.composerProviderId,
  composerModel: s.composerModel,
  resumeLastSession: s.resumeLastSession
});
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @marginalia/desktop test -- app-store`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/store/app-store.ts apps/desktop/src/store/app-store.test.ts
git commit -m "fix(desktop): persist activeSessionId for session resume"
```

---

## Task 2: AppShell 续传校验

`AppShell` 挂载时若 `resumeLastSession` 开启、且 persist 的 `activeSessionId` 经当前 workspace 的 `listSessions` 校验仍存在，则切到 chat；否则清掉 `activeSessionId` 落 New chat。只跑一次（用 ref 防重入）。`view` 不持久化，默认仍是 `new-thread`，所以续传完全由这个 effect 驱动。

**Files:**

- Modify: `apps/desktop/src/app/AppShell.tsx`
- Test: `apps/desktop/src/app/AppShell.test.tsx`

- [ ] **Step 1: 写失败测试**

在 `AppShell.test.tsx` 的 `describe("AppShell", …)` 内追加三个用例。注意现有 `beforeEach` 的 fetch mock 默认对所有非 `/health` 返回 `"[]"`；这些用例需要覆盖 `listSessions`（路径 `/workspaces/:id/sessions`）。

```ts
it("resumes the last session on launch when the toggle is on and the session still exists", async () => {
  useAppStore.setState({
    resumeLastSession: true,
    activeWorkspaceId: "ws-1",
    activeSessionId: "s-1",
    view: "new-thread"
  });
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : (input as URL).toString();
    if (url.endsWith("/health"))
      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { "content-type": "application/json" }
      });
    if (url.endsWith("/workspaces/ws-1/sessions"))
      return new Response(
        JSON.stringify([{ id: "s-1", workspaceId: "ws-1", title: "Prior", origin: "desktop" }]),
        { headers: { "content-type": "application/json" } }
      );
    return new Response("[]", { headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  render(<AppShell serverUrl="http://x" />);
  await waitFor(() => expect(useAppStore.getState().view).toBe("chat"));
  expect(useAppStore.getState().activeSessionId).toBe("s-1");
});

it("does not resume when the stored session no longer exists", async () => {
  useAppStore.setState({
    resumeLastSession: true,
    activeWorkspaceId: "ws-1",
    activeSessionId: "gone",
    view: "new-thread"
  });
  // beforeEach fetch returns "[]" for sessions → session not found
  render(<AppShell serverUrl="http://x" />);
  await waitFor(() => expect(useAppStore.getState().activeSessionId).toBeNull());
  expect(useAppStore.getState().view).toBe("new-thread");
});

it("does not resume when the toggle is off", async () => {
  useAppStore.setState({
    resumeLastSession: false,
    activeWorkspaceId: "ws-1",
    activeSessionId: "s-1",
    view: "new-thread"
  });
  render(<AppShell serverUrl="http://x" />);
  await waitFor(() => expect(useAppStore.getState().view).toBe("new-thread"));
  expect(useAppStore.getState().activeSessionId).toBe("s-1");
});
```

确保测试文件顶部 import 里有 `waitFor`：把第 1 行改为
`import { cleanup, render, screen, waitFor } from "@testing-library/react";`

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @marginalia/desktop test -- AppShell`
Expected: FAIL — 续传用例里 `view` 仍是 `new-thread`（尚无续传逻辑）。

- [ ] **Step 3: 实现续传 effect**

在 `AppShell.tsx` 中：

1. 顶部 import 增加 `useRef`：`import { useEffect, useMemo, useRef, useState } from "react";`
2. 读取所需 store 字段（在已有 `useAppStore` 选择器附近添加）：

```ts
const resumeLastSession = useAppStore((s) => s.resumeLastSession);
const setView = useAppStore((s) => s.setView);
const setActiveSession = useAppStore((s) => s.setActiveSession);
```

3. 在 `const workspaces = useWorkspaces(api);` 之后加入一次性续传 effect：

```ts
// One-shot session resume on launch: only when the toggle is on and the
// persisted session is still present in its workspace. Otherwise clear the
// stale id and fall back to New chat. Guarded so it runs at most once.
const resumeTriedRef = useRef(false);
useEffect(() => {
  if (resumeTriedRef.current) return;
  resumeTriedRef.current = true;
  if (!resumeLastSession || !activeSessionId || !activeWorkspaceId) return;
  let active = true;
  void api
    .listSessions(activeWorkspaceId)
    .then((sessions) => {
      if (!active) return;
      if (sessions.some((s) => s.id === activeSessionId)) setView("chat");
      else setActiveSession(null);
    })
    .catch(() => {
      if (active) setActiveSession(null);
    });
  return () => {
    active = false;
  };
}, [api, resumeLastSession, activeSessionId, activeWorkspaceId, setView, setActiveSession]);
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @marginalia/desktop test -- AppShell`
Expected: PASS（三个续传用例 + 既有用例全绿）。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/app/AppShell.tsx apps/desktop/src/app/AppShell.test.tsx
git commit -m "fix(desktop): resume last session on launch when enabled"
```

---

## Task 3: 移除 slash 命令菜单

Slash 命令是空壳（`pickSlash` 丢弃选择）。删除 `SlashMenu`、Composer 的 slash 分支、相关 i18n key，并把 `detectTrigger` 收窄为只识别 `@`。

**Files:**

- Delete: `apps/desktop/src/chat/Composer/SlashMenu.tsx`、`apps/desktop/src/chat/Composer/SlashMenu.test.tsx`
- Modify: `apps/desktop/src/chat/Composer/Composer.tsx`
- Modify: `apps/desktop/src/chat/Composer/Composer.test.tsx`
- Modify: `apps/desktop/src/i18n/messages.ts`

- [ ] **Step 1: 改测试（删除 slash 用例 + 调整断言）**

在 `Composer.test.tsx` 删除整个 `it("opens the slash menu when '/' is typed mid-sentence", …)`（约 90-109 行）。

- [ ] **Step 2: 运行确认现状（基线）**

Run: `pnpm --filter @marginalia/desktop test -- Composer`
Expected: 删除该用例后其余 PASS（此时 Composer 仍 import SlashMenu，但运行通过）。这一步只为确认删用例没误伤其它断言。

- [ ] **Step 3: 删除 SlashMenu 文件与 Composer 内的 slash 逻辑**

删除两个文件：

```bash
git rm apps/desktop/src/chat/Composer/SlashMenu.tsx apps/desktop/src/chat/Composer/SlashMenu.test.tsx
```

在 `Composer.tsx` 中：

a) 删除 import 行 `import { SlashMenu } from "./SlashMenu.js";`

b) `detectTrigger` 收窄为只匹配 `@`（替换整个函数）：

```ts
/** The `@` token immediately before the caret, anywhere in the text. */
interface Trigger {
  kind: "mention";
  query: string;
  start: number; // index of the trigger symbol
  end: number; // caret position
}

function detectTrigger(value: string, caret: number): Trigger | null {
  const before = value.slice(0, caret);
  const m = /(^|\s)@(\S*)$/.exec(before);
  if (!m) return null;
  const query = m[2] ?? "";
  return {
    kind: "mention",
    query,
    start: caret - query.length - 1,
    end: caret
  };
}
```

c) 删除 `slashQuery` state：删掉 `const [slashQuery, setSlashQuery] = useState<string | null>(null);`

d) `closeMenus` 去掉 slash：

```ts
function closeMenus() {
  setTrigger(null);
  setMentionSuggestions([]);
}
```

e) `handleChange` 去掉 slash 分支（替换 `if (!next) … else { … }` 整段尾部逻辑）：

```ts
async function handleChange(value: string, caret: number) {
  setDraft(value);
  requestAnimationFrame(autoSize);
  const next = detectTrigger(value, caret);
  setTrigger(next);
  if (!next) {
    setMentionSuggestions([]);
    return;
  }
  setPickerMode("mention");
  if (props.workspaceId) {
    const items = await props.api.searchFiles(props.workspaceId, next.query);
    setMentionSuggestions(Array.isArray(items) ? items : []);
  }
}
```

f) 删除 `pickSlash` 函数整段。

g) `openAttachPicker` 内删掉 `setSlashQuery(null);` 一行。

h) JSX 中删除 SlashMenu 渲染块：

```tsx
{
  slashQuery !== null && (
    <SlashMenu query={slashQuery} onSelect={pickSlash} onClose={() => setSlashQuery(null)} />
  );
}
```

- [ ] **Step 4: 删除 i18n slash key**

在 `messages.ts` 的 `en.composer` 与 `zh.composer` 中各删除三行 `slashClear` / `slashHelp` / `slashModel`。

- [ ] **Step 5: 运行测试 + typecheck 确认通过**

Run: `pnpm --filter @marginalia/desktop test -- Composer`
Expected: PASS（`@` mention 用例仍绿，slash 用例已不存在）。

Run: `pnpm --filter @marginalia/desktop typecheck`
Expected: PASS（无 `SlashMenu` / `slashQuery` / 已删 i18n key 的悬空引用）。

- [ ] **Step 6: 提交**

```bash
git add -A apps/desktop/src/chat/Composer apps/desktop/src/i18n/messages.ts
git commit -m "fix(desktop): remove placeholder slash command menu"
```

---

## Task 4: 移除顶栏 ⓘ 按钮 + 更新 composer placeholder 文案

ⓘ 按钮无 onClick（纯装饰）；composer placeholder 仍提示"输入 / 调用技能"，slash 已删需同步改文案。

**Files:**

- Modify: `apps/desktop/src/app/Topbar.tsx`
- Modify: `apps/desktop/src/i18n/messages.ts`
- Test: `apps/desktop/src/app/Topbar.test.tsx`

- [ ] **Step 1: 写失败测试**

在 `Topbar.test.tsx` 的 `describe` 内追加：

```ts
it("does not render a session info button in chat view", () => {
  useAppStore.setState({ view: "chat" });
  render(<Topbar title="" />);
  expect(screen.queryByRole("button", { name: /session info|会话信息/i })).toBeNull();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @marginalia/desktop test -- Topbar`
Expected: FAIL — 当前 chat 视图渲染了 `aria-label={t("common.sessionInfo")}` 的按钮。

- [ ] **Step 3: 删除 ⓘ 按钮**

在 `Topbar.tsx`：

a) import 行去掉 `Info`：`import { PanelLeft, PanelRight } from "lucide-react";`

b) 删除中间标题区的整段 ⓘ 按钮：

```tsx
{
  view === "chat" && (
    <Button
      variant="ghost"
      size="icon"
      className="app-no-drag h-6 w-6 text-text-faint active:scale-95"
      aria-label={t("common.sessionInfo")}
    >
      <Info className="h-3.5 w-3.5" />
    </Button>
  );
}
```

删除后标题区简化为：

```tsx
<div className="flex min-w-0 flex-1 items-center justify-center gap-1 px-3 text-center">
  <span className="truncate text-xs font-medium text-text-muted">{title}</span>
</div>
```

- [ ] **Step 4: 删除 `common.sessionInfo` i18n key**

在 `messages.ts` 的 `en.common` 删除 `sessionInfo: "Session info",`，`zh.common` 删除 `sessionInfo: "会话信息",`。

- [ ] **Step 5: 改 composer placeholder 文案（不再提 `/`）**

在 `messages.ts`：

- `en.composer.chatPlaceholder` 改为 `"Type @ to reference a file…"`
- `zh.composer.chatPlaceholder` 改为 `"输入 @ 引用文件…"`

- [ ] **Step 6: 运行测试 + typecheck 确认通过**

Run: `pnpm --filter @marginalia/desktop test -- Topbar`
Expected: PASS。

Run: `pnpm --filter @marginalia/desktop typecheck`
Expected: PASS（无 `Info` / `common.sessionInfo` 悬空引用）。

- [ ] **Step 7: 提交**

```bash
git add apps/desktop/src/app/Topbar.tsx apps/desktop/src/app/Topbar.test.tsx apps/desktop/src/i18n/messages.ts
git commit -m "fix(desktop): drop decorative topbar info button; update composer hint"
```

---

## Task 5: 全量验证 + 截图核对

**Files:** 无新增改动，只跑门禁。

- [ ] **Step 1: 全包 typecheck + test**

Run: `pnpm --filter @marginalia/desktop typecheck && pnpm --filter @marginalia/desktop test`
Expected: 全 PASS。

- [ ] **Step 2: 仓库级 lint + format**

Run: `pnpm lint && pnpm format:check`
Expected: 干净。若 format 报问题，先 `pnpm format` 再复跑，并把改动并入相应提交。

- [ ] **Step 3: Electron 截图核对**

Run: `pnpm verify:screenshots`
Expected: 退出码 0。人工检查以下产物，确认设计意图：

- `output/desktop-screenshots/core-ui/05-settings-general.png` —"启动时打开上次会话"开关存在且文案正常。
- `output/desktop-screenshots/seeded-workspace/04-chat-seeded-session.png` — 顶栏标题右侧**不再有** ⓘ 图标。
- `output/desktop-screenshots/core-ui/02-new-thread-empty.png` 与 chat composer — placeholder 文案不再出现 `/`。

注：`verify-screenshots.mjs` 现有 `core-ui` / `seeded-workspace` 场景已覆盖本 PR 的 UI 状态，无需新增场景。续传是启动期一次性逻辑，已由单测覆盖，不强制加截图场景。

- [ ] **Step 4: 终验提交（仅当上面有 format/lint 自动修复时）**

```bash
git add -A
git commit -m "chore(desktop): lint/format after PR-1"
```

---

## Self-Review（已对照 spec PR-1）

- **覆盖**：问题 1（续传开关 → Task 1+2）、问题 2（slash 空壳 → Task 3）、问题 3（ⓘ 按钮 → Task 4）全部有对应任务；placeholder 文案随 slash 删除同步（Task 4 Step 5）。
- **边缘场景**：spec 失败表的"续传但 session/workspace 已删除"→ Task 2 的两条 catch/不存在分支均 `setActiveSession(null)` 落 New chat，已被测试覆盖。
- **i18n**：删 key（slashClear/slashHelp/slashModel、sessionInfo）与改 key（chatPlaceholder）en/zh 同步；zh 的 `satisfies` 会在 typecheck 捕获遗漏。
- **类型一致**：`Trigger.kind` 收窄为 `"mention"` 单值后，Composer 内 `next.kind === "slash"` 分支已全部移除，无悬空判断。
- **保留项**：`useMenuNav.ts` 不删（`MentionMenu` 仍用）；legacy 逻辑无涉及。
