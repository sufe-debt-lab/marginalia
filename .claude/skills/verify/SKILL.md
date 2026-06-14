---
name: verify
description: Run this project's pre-commit verification gate. Use before committing or when asked to verify changes — runs typecheck + tests for the touched package(s) and walks the Electron screenshot check for UI changes.
---

# Verify (marginalia commit gate)

Run the repository's standing commit gate before claiming work is done or committing.

## Steps

1. **Determine touched packages** from the diff (`git status` / `git diff --name-only`):
   - changes under `apps/desktop/**` → `@marginalia/desktop`
   - changes under `apps/pi-server/**` → `@marginalia/pi-server`
   - both → run both.

2. **Typecheck + test** the touched package(s):

   ```bash
   pnpm --filter @marginalia/desktop typecheck && pnpm --filter @marginalia/desktop test
   pnpm --filter @marginalia/pi-server typecheck && pnpm --filter @marginalia/pi-server test
   ```

   Report failures with the actual output. Do not proceed past a red result.

3. **TDD check**: confirm new/changed behavior has a test that was written first (failing → passing). If a change shipped without a test, flag it.

4. **UI changes → Electron screenshots + visual regression**: if anything user-visible in
   `apps/desktop` changed, run the visual gate:

   ```bash
   pnpm verify:visual
   ```

   This captures the default scenarios in real Electron and diffs them against
   `apps/desktop/screenshots-baseline/`. The compare step prints
   `changed=N new=N unchanged=N orphan=N errors=N` and writes `output/visual-diff/report.md`.
   For every `changed` shot, read the diff image and classify: intentional (bless via
   `pnpm --filter @marginalia/desktop compare:screenshots --update-baseline <scenario/label> --reason "<why>"`),
   unintended regression (fix it), or unsure (do not bless — surface to the user).
   `new` shots from added fixtures must be blessed; `orphan` baselines must be pruned via a
   whole-scenario bless. Opening the Vite page in a plain browser does **not** satisfy the gate.
   For i18n-affecting changes capture both English and 中文 states.

5. **i18n scan** (desktop): confirm no hardcoded user-facing strings were introduced — every label/placeholder/aria-label/toast goes through `t()` with matching `en` + `zh` keys.

Report a concise pass/fail summary. Only call the work verified when typecheck + tests are green and (for UI) the Electron screenshot was taken.

> Note: this is a project-specific gate. Claude Code's bundled `/verify` skill still exists; this one adds marginalia's TDD + Electron-screenshot + i18n constraints on top.
