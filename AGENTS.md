# Repository agent rules

This file is the single repository-wide instruction source for coding agents. `CLAUDE.md` must remain a symlink to this file.

## Working style

- Prefer simple, maintainable, production-friendly solutions.
- Keep APIs small, behavior explicit, and naming clear. Do not add layers or dependencies without a concrete need.
- Preserve unrelated user changes. Commit, push, open a PR, or publish only when the user asks.
- Use Conventional Commits. Code changes normally use a package scope, such as `feat(desktop): ...`; documentation-only changes may use `docs: ...`.

## Monorepo layout

This is a pnpm workspace (`apps/*`, `packages/*`) using Node 22.19 or newer, pnpm 9.15.4, and ESM.

- `apps/desktop`: Electron, React 18, Vite, Tailwind, Vitest, jsdom, and Testing Library.
- `apps/pi-server`: Hono HTTP server around `@earendil-works/pi-coding-agent`, with Vitest tests.
- `packages/chat-core`: shared pi-shaped chat types and small rendering helpers.

## Commands

- `pnpm verify`: required repository gate. It runs documentation checks, formatting, lint, typecheck, tests, and build.
- `pnpm docs:check`: current-tree documentation and contract checks.
- `pnpm docs:check -- --base <git-ref> --declaration <json-file>`: local diff-impact check.
- `pnpm --filter @marginalia/desktop <test|typecheck|build>`: one package; the same pattern applies to `@marginalia/pi-server` and `@marginalia/chat-core`.
- `pnpm --filter @marginalia/desktop test -- <pattern>`: run a focused Vitest test.
- `pnpm dev`: build pi-server, start its watcher, and launch the Electron app. Opening the Vite page in a browser is not an equivalent runtime.
- `pnpm verify:visual`: capture Electron screenshots and compare them with the committed baseline. Screenshot differences still require human or agent judgment.

See `docs/developer/development.md` for setup and focused commands.

## Documentation lifecycle

- `docs/product/status.md` is the current product-status source.
- `docs/user/` describes behavior users can rely on now.
- `docs/developer/` describes current engineering contracts, APIs, development, and release behavior.
- `docs/superpowers/` contains only active specs and plans. Completed, cancelled, or superseded records require an Implementation Outcome and move to `docs/internal/`.
- Update affected formal docs in the same change as user workflows, APIs, configuration, storage, permissions, packaging, verification commands, or contributor rules.
- Follow `docs/developer/documentation-lifecycle.md` for docs-impact declarations, route inventory rules, closeout, and the Definition of Done.
- Do not use `path:line` references in formal docs. Use a repository-relative `path` or `path#stable-symbol`.

## Code conventions

- TypeScript ESM imports include `.js` extensions, even when the source file is `.ts` or `.tsx`.
- In desktop code, prefer the `@/` alias for cross-directory imports.
- Every user-facing desktop string, including accessibility labels and errors, goes through `t()` from `@/i18n/useTranslation.js`. Add matching English and Chinese keys to `apps/desktop/src/i18n/messages.ts`.
- Use the existing mono, serif, and emerald design tokens from `apps/desktop/src/styles.css` and `apps/desktop/tailwind.config.ts`; do not introduce ad-hoc colors.

## Chat model conventions

- pi-server forwards raw pi `agent_event` payloads plus run-level envelopes. Do not create desktop-only delta or tool-event shapes.
- Chat history uses `ChatEntry = { id, message }` from `@marginalia/chat-core`, with pi-shaped message bodies.
- Keep `packages/chat-core` as a thin bridge over pi types and small render helpers.
- Desktop rendering attaches matching tool results by `toolCallId`; tool results are not separate chat bubbles.
- Live streaming and reopened-session rendering must agree. Assistant bubble boundaries come from pi `message_start` events.

## Development and verification

1. For behavior changes, write or adjust a test first and confirm the intended failure before implementation.
2. During development, run the focused test and typecheck for touched packages.
3. Before handoff, run `pnpm verify` and resolve every failure.
4. For UI-visible changes, run `pnpm verify:visual`. Inspect every `changed` or `new` screenshot; update a baseline only for an intentional change and include a reason.
5. Update the active plan as work proceeds. Before closing it, record actual results, deviations, verification evidence, formal docs, and remaining issues.

## Native module notes

- Development and tests load pi-server with the system Node; packaged pi-server runs under Electron's bundled Node. Their native ABIs differ.
- Root tests, pi-server tests, desktop development, and screenshot verification already run `ensure:native` where required.
- On `better-sqlite3` ABI mismatch, use `pnpm --filter @marginalia/pi-server run ensure:native`. Use `pnpm --filter @marginalia/desktop run rebuild:server-native` only if the guard cannot recover.
- Do not run packaging in parallel with development or tests because packaging temporarily rebuilds the shared native module for Electron.

## Git

- Branch from the maintainer-designated integration branch; do not assume a `main` branch exists.
- Never commit directly to a protected integration branch.
- Do not commit, push, create a PR, or publish unless the user explicitly asks.
