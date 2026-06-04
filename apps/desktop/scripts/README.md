# Desktop Screenshot Verification

Use `verify-screenshots.mjs` as the only screenshot verification entrypoint for
the Electron desktop UI. Keep UI capture scripts in this directory; root scripts
should only expose package-level aliases.

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

## Scenarios

- `core-ui`: first run, new thread, composer controls, settings, locale switch,
  and sidebar collapse.
- `seeded-workspace`: seeded workspace/session state, recent threads, sidebar
  session timestamps, chat rendering, attachment picker, and mention flow.
- `minimax-live`: real MiniMax prompt/stream/result capture. This is not part of
  the default gate and requires `MINIMAX_CN_API_KEY`.

## Output

Screenshots and reports are written to `output/desktop-screenshots/`:

- `summary.md` links all captured PNGs.
- `manifest.json` records scenarios, labels, output paths, and failure details.
- `.run/` contains the isolated test database, HOME, and Electron userData.

The runner sets `MARGINALIA_DB_PATH`, `HOME`, and `MARGINALIA_USER_DATA_DIR` so
it does not use the developer's real `~/.marginalia` state or previous Electron
localStorage.
