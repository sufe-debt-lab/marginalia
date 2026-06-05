# Code Review Findings - 2026-06-04

Scope: current working tree review of `apps/desktop`, `apps/pi-server`, and `packages/chat-core`.
Method: static review plus parallel subagent review for Electron runtime, pi-server/chat-core contracts, and React renderer behavior.

## P1 - Unauthenticated Loopback API

Files:

- `apps/pi-server/src/app.ts`
- `apps/desktop/src/api/client.ts`

Problem: pi-server reflects any request origin via CORS and does not authenticate the localhost API. `127.0.0.1` is not an authorization boundary. A browser page or local process that discovers the random port can read API responses, mutate providers/workspaces, fetch files, or trigger model runs.

Fix direction:

- Generate a per-process secret in Electron main.
- Pass it to the renderer only through preload and attach it as an authorization header in `ApiClient`.
- Reject unauthenticated requests in pi-server middleware for all non-health routes.
- Restrict CORS to the Electron renderer/dev origin.
- Replace unauthenticated raw document URLs with authenticated blob fetches or short-lived tokenized URLs.

## P1 - Plaintext Provider Secrets

Files:

- `apps/pi-server/src/db/migrations.ts`
- `apps/pi-server/src/db/repositories.ts`

Problem: provider API keys are stored directly in `env_vars.value`.

Impact: local database inspection, backup sync, crash dumps, or another local process can expose all provider credentials. This is especially risky while the loopback API is unauthenticated.

Fix direction:

- Move provider secrets to OS-backed/encrypted storage.
- Keep SQLite rows as metadata or stable secret references.
- Decrypt only in trusted startup/update paths before registering runtime keys with pi-agent auth storage.

## P1 - Blank API Key Leaves Stale Runtime Secret

File: `apps/pi-server/src/app.ts`

Problem: `PATCH /providers/:id` can receive `apiKey: ""`. The DB value is cleared, but when the provider remains enabled the old runtime key can stay registered in `AuthStorage` until restart.

Fix direction:

- Reject blank API keys with `400`, or explicitly treat blank as key removal.
- Keep DB update and `AuthStorage` update/removal in one explicit path.
- Add regression coverage for clearing a key while a provider remains enabled.

## P2 - Renderer Sandbox Disabled

File: `apps/desktop/electron/main.ts`

Problem: the Electron renderer uses `sandbox: false`.

Impact: context isolation and `nodeIntegration: false` help, but the renderer process still has a larger attack surface than necessary for an app that can mostly communicate through preload and a local API.

Fix direction:

- Enable `sandbox: true`.
- Keep preload API narrow and validate all IPC inputs.
- Verify packaged launch after the sandbox change, not only Vite/browser rendering.

## P2 - pi-server Crash Is Not Reflected After Ready

Files:

- `apps/desktop/electron/pi-server-spawner.ts`
- `apps/desktop/electron/main.ts`

Problem: child-process exit is only handled while startup is unresolved. After `ready`, a later pi-server crash does not update `serverStatus`.

Impact: Electron can continue reporting `ready`, and the renderer then fails on arbitrary API calls instead of surfacing a clear server failure/restart state.

Fix direction:

- After storing a ready process, register an exit handler in main.
- Mark status failed, retain recent logs, clear process references, and expose a controlled restart path.
- Add a focused main/spawner test for post-ready process exit.

## P2 - Disabled Or Deleted Providers Remain Chat-Selectable

Files:

- `apps/desktop/src/chat/ChatView.tsx`
- `apps/desktop/src/chat/NewThreadView.tsx`
- `apps/desktop/src/chat/FirstRunView.tsx`
- `apps/desktop/src/chat/Composer/ModelPicker.tsx`

Problem: chat/new-thread flows use all providers and persisted provider IDs without validating that the provider exists and is enabled. The server later rejects disabled providers in `apps/pi-server/src/app.ts`.

Impact: disabling or deleting the selected/default provider leaves the UI in a state that looks usable but fails at send time with `provider disabled` or `provider not found`.

Fix direction:

- Derive `enabledProviders` for chat flows.
- Resolve persisted provider IDs against the enabled list and fall back to the first enabled provider.
- Show a clear no-enabled-provider state.
- Keep the management list separate from chat-eligible providers.

## P2 - Provider Deletion Erases Run History

File: `apps/pi-server/src/db/repositories.ts`

Problem: deleting a provider deletes associated `runs`.

Impact: session audit/debug data disappears, including run status, errors, and model metadata tied to previous conversations.

Fix direction:

- Prefer soft-delete/disable for providers.
- Or make `runs.provider_id` nullable with `ON DELETE SET NULL`.
- Denormalize provider/model display fields needed for historical run views.

## P3 - Markdown Link Handling Is Too Broad

Files:

- `apps/desktop/src/lib/markdown.tsx`
- `apps/desktop/src/lib/open-external.ts`

Problem: markdown links prevent default navigation for every `href`, while Electron main only opens `http` and `https`. Non-http links can be silently dropped. In browser/test fallback, `window.open` accepts any scheme.

Fix direction:

- Validate the scheme before preventing default.
- Only route `http`/`https` through the Electron external-open bridge.
- Render unsupported links inert or preserve normal anchor behavior where appropriate.

## P3 - Cached Document Hit Can Leave Loading True

File: `apps/desktop/src/hooks/useDocumentContent.ts`

Problem: cached document hits set content and error but do not clear `loading`. The null-path path also clears content without clearing loading/error.

Impact: after a previous uncached request set `loading=true`, switching to cached content can leave the viewer stuck showing a loading state over valid content.

Fix direction:

- Set `loading=false` and `error=null` when returning cached content.
- Reset loading/error when `path` becomes null.
- Add a regression test that switches from an uncached request to a cached document.

## Fixed Guardrail - better-sqlite3 ABI Drift

Files:

- `apps/desktop/scripts/build-pi-server.mjs`
- `apps/desktop/scripts/verify-screenshots.mjs`
- `apps/pi-server/package.json`
- `apps/pi-server/scripts/ensure-native-abi.mjs`
- `docs/developer/build-and-release.md`

Observed:

- Current system Node is `v26.0.0` with `NODE_MODULE_VERSION=147`.
- Electron `39.8.10` embeds Node `22.22.1` with `NODE_MODULE_VERSION=140`.
- `apps/pi-server/node_modules/better-sqlite3` resolves to the pnpm store copy under `node_modules/.pnpm/...`; when that copy drifted to ABI `137`, pi-server tests failed before business assertions ran.
- A separate root `node_modules/better-sqlite3` copy exists and reports ABI `140`, so root-level probes can be misleading.

Impact: without a guard, `pnpm --filter @marginalia/pi-server test` and repo-wide `pnpm test` can fail before business assertions run.

Guardrail:

- `apps/pi-server/scripts/ensure-native-abi.mjs` verifies through the pi-server package path and invokes `rebuild:server-native` only when a native ABI mismatch is detected.
- Root `pnpm test`, pi-server `pretest`, desktop `dev`, and screenshot verification now run `ensure:native` before paths that may load the native module.
- `pi-server start` runs the check-only native load script directly with `node`; it fails with recovery instructions instead of triggering a workspace rebuild during production-style startup.
- Do not use root-level `require("better-sqlite3")` probes; verify through the pi-server package path.
- Treat packaged Electron ABI and dev/test Node ABI as separate targets; packaged runtime should use Electron ABI, while dev/test must match the active system Node.
