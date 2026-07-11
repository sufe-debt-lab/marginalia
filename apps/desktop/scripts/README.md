# Desktop Screenshot Verification

Two scripts power UI verification, split by responsibility: `verify-screenshots.mjs`
**captures** Electron screenshots, and `compare-screenshots.mjs` **diffs** them
against committed baselines (regression) or against a design artifact. Keep UI
capture/compare scripts in this directory; root scripts should only expose
package-level aliases.

## Commands

- `pnpm verify:screenshots` runs local, deterministic scenarios.
- `pnpm verify:screenshots:live` runs the opt-in MiniMax scenario.
- `pnpm --filter @marginalia/desktop verify:screenshots -- --list` lists scenarios.
- `pnpm --filter @marginalia/desktop verify:screenshots -- --scenario core-ui` runs one scenario.
- `pnpm --filter @marginalia/desktop verify:screenshots -- --scenario minimax-live` runs the
  MiniMax scenario directly (the same thing the `verify:screenshots:live` alias does).

## Ad-hoc capture (verify a feature you just built)

The fixed scenarios above only re-capture known screens. To verify a **new**
feature, use ad-hoc mode — it launches the same isolated Electron harness, leaves
the window open, and lets you snap whatever you navigate to:

- `pnpm verify:screenshots:shot` (or `pnpm --filter @marginalia/desktop verify:screenshots -- --shot`)
  opens Electron and prompts for a label; navigate to your screen, type a label +
  Enter to capture, empty line or `q` to finish.
- `pnpm --filter @marginalia/desktop verify:screenshots -- --shot first-look`
  also takes one capture immediately on launch using the given label.

Ad-hoc shots land in `output/desktop-screenshots/adhoc/` and are not part of the
scenario contract, so they neither require nor update the expected-screenshot list.

Ad-hoc is throwaway. To put a new feature under **ongoing regression protection**,
add it to a scenario and bless a baseline instead — see "Regression baselines".

## Regression baselines

`compare-screenshots.mjs` diffs the latest capture against committed baselines in
`apps/desktop/screenshots-baseline/<scenario>/<label>.png`.

- `pnpm verify:visual` captures the default scenarios, then diffs — the standard
  gate for any UI change. It prints `changed=N new=N unchanged=N orphan=N errors=N`
  and writes `output/visual-diff/report.md` (+ per-shot diff PNGs under
  `output/visual-diff/diff/`).
- `pnpm --filter @marginalia/desktop compare:screenshots` diffs the **existing**
  capture without re-shooting (fast iteration once `output/desktop-screenshots/` is
  populated).
- `pnpm --filter @marginalia/desktop compare:design <design> --impl <scenario/label | png>`
  renders a design artifact (PNG / HTML / URL) and emits a `design | impl | diff`
  triptych under `output/visual-diff/design/` for pixel-matching a mockup. The diff
  percent is a trend signal, not a gate.

Per-shot status: `unchanged` (≤ noise floor), `changed` (diff PNG written — judge
it), `new` (no baseline yet), `orphan` (baseline exists but the shot wasn't
captured this run).

### Adding / updating a baseline

1. Add the new UI state to a scenario's `expected` + `run` in `verify-screenshots.mjs`.
2. `pnpm verify:visual` → the new label shows as `new`.
3. Inspect it in `output/visual-diff/report.md`, then bless it:
   `pnpm --filter @marginalia/desktop compare:screenshots --update-baseline <scenario/label> --reason "<why>"`.
4. Commit the new baseline PNG. Future `verify:visual` runs now regression-check it.

`--update-baseline` requires `--reason`; a whole-scenario selector (`<scenario>`)
also prunes `orphan` baselines. `--fail-on-diff` / `--max-diff-percent <n>` turn
diffs into a hard failure for CI (default is a soft report). `minimax-live` and
ad-hoc shots are never baselined. The full implement → capture → compare → iterate
loop is codified in the `design-loop` skill.

## Scenarios

- `core-ui`: first run, new thread, composer controls, settings, locale switch,
  and sidebar collapse.
- `seeded-workspace`: seeded workspace/session state, recent threads, sidebar
  session timestamps, chat rendering, the save-to-workspace dialog (file name
  input and overwrite-confirm steps), attachment picker, and mention flow. Uses a
  fixed, content-controlled seed directory (not the real repo) so file-listing
  shots stay deterministic as the repo changes.
- `minimax-live`: real MiniMax prompt/stream/result capture. This is not part of
  the default gate and requires `MINIMAX_CN_API_KEY`.

## Output

Captures and reports are written under `output/` (gitignored):

- `output/desktop-screenshots/summary.md` links all captured PNGs.
- `output/desktop-screenshots/manifest.json` records scenarios, labels, output
  paths, and failure details (the compare step reads this).
- `output/desktop-screenshots/.run/` contains the isolated test database, HOME,
  Electron userData, and the fixed `seed-workspace/` used by `seeded-workspace`.
- `output/visual-diff/` holds the regression report (`report.json` / `report.md`),
  per-shot diff PNGs, and design triptychs.

Only baselines under `apps/desktop/screenshots-baseline/` are committed; everything
under `output/` is disposable.

The runner sets `MARGINALIA_DB_PATH`, `HOME`, and `MARGINALIA_USER_DATA_DIR` so
it does not use the developer's real `~/.marginalia` state or previous Electron
localStorage.

Before launching Electron, the runner calls `pnpm --filter @marginalia/pi-server
run ensure:native` to verify the pi-server `better-sqlite3` native binary matches
the current dev/test Node ABI. It intentionally does not use broad pnpm rebuilds.
