# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Monorepo layout

pnpm workspace (`apps/*`, `packages/*`). Node ≥20.11, pnpm@9.15.4, ESM (`"type": "module"`).

- `apps/desktop` — `@marginalia/desktop`: Electron + React 18 + Vite + Tailwind UI. Tests: Vitest + jsdom + Testing Library.
- `apps/pi-server` — `@marginalia/pi-server`: Hono HTTP server wrapping `@earendil-works/pi-coding-agent`. Tests: Vitest.
- `packages/chat-core` — `@marginalia/chat-core`: shared chat types and small render helpers over pi message/tool types.

## Commands

- All packages: `pnpm test` / `pnpm typecheck` / `pnpm build` (run `-r`).
- One package: `pnpm --filter @marginalia/desktop <test|typecheck|build>` (or `@marginalia/pi-server`, `@marginalia/chat-core`).
- Single test by name/pattern: `pnpm --filter @marginalia/desktop test -- <pattern>` (Vitest `run`).
- `pnpm --filter @marginalia/desktop dev` launches the **Electron app** (Vite + Electron together), not just a browser page.
- Desktop `typecheck` runs two tsconfigs (`tsconfig.json` for src, `tsconfig.node.json` for vite/electron config) — both must pass.

## Code conventions

- **ESM import extensions**: TypeScript source imports use `.js` extensions even for `.ts`/`.tsx` files (e.g. `import { Foo } from "./Foo.js"`). Match this — omitting `.js` breaks the build.
- **`@/` alias** → `apps/desktop/src/` (configured in tsconfig + vite). Prefer it for cross-directory imports.
- **i18n is mandatory** in `apps/desktop`: every user-facing string (text, `aria-label`, placeholder, toast) goes through `t()` from `@/i18n/useTranslation.js`. Add keys to both `en` and `zh` in `src/i18n/messages.ts` — `zh` uses `satisfies` so a missing key fails typecheck. No hardcoded English in the UI.
- Visual design tokens are locked to **mono + serif + emerald** (see `src/styles.css` + `tailwind.config.ts`); use the design tokens (`text-muted`, `border-soft`, `brand`, `.dot`, `.h-display`, etc.) rather than ad-hoc colors.

## Chat model conventions

- `apps/pi-server` forwards raw pi `agent_event` payloads plus the run envelope (`run_started`, `run_failed`, `run_completed`). Do not re-map them into desktop-only delta/tool event shapes.
- Chat history uses `ChatEntry = { id, message }` from `@marginalia/chat-core`; keep message bodies pi-shaped. Do not reintroduce flattened `UiMessage`/`UiToolCall` types or fake roles such as `system`.
- `packages/chat-core` should stay a thin bridge over pi types and small render helpers. Prefer pi types from `@earendil-works/pi-ai` / `@earendil-works/pi-agent-core` instead of duplicating message or tool schemas.
- Desktop chat rendering derives UI state from entries: assistant `toolCall` content renders tool UI; matching `toolResult` messages attach by `toolCallId` and are not standalone chat bubbles.
- Live streaming and reopened session rendering must match. Use pi `message_start` boundaries for assistant bubbles.

## Commit gate (standing rule)

Before every commit:
1. **TDD** — write or adjust the test first; watch it fail, then implement to green.
2. Run the touched package's `typecheck` + relevant `test` and confirm they pass.
3. For UI changes, verify via an **Electron screenshot** (`pnpm --filter @marginalia/desktop dev`) — opening the Vite page in a browser does not count.

## Git conventions

- Conventional commits with package scope: `feat(desktop): …`, `fix(pi-server): …`, `refactor(chat-core): …`, `chore(desktop): …`, `polish(desktop): …`.
- Branch off `main`; never commit directly to `main`. Commit/push only when asked.
