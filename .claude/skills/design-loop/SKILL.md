---
name: design-loop
description: Iterate a desktop UI implementation against a design artifact (PNG / HTML prototype) using Electron screenshots and triptych diffs until the design is faithfully reproduced. Use when implementing from a spec/design mockup or when asked to pixel-match a design.
---

# Design loop (marginalia)

Iterate implementation → screenshot → compare → judge → fix until the UI matches the design artifact.

## Inputs

- Design artifact: `.png` (must be 1280×800 css px), `.html`, or an http(s) URL. JSX prototypes must be pre-rendered to HTML/PNG first — the compare tool does not infer frameworks.
- The implementation state must be reachable in a screenshot scenario, or capture it ad hoc with `pnpm verify:screenshots:shot`.

## Loop

1. Implement (or adjust) the UI.
2. Capture: `pnpm verify:screenshots -s <scenario>` (or `pnpm verify:screenshots:shot` for states not in a fixture yet).
3. Compare: `pnpm --filter @marginalia/desktop compare:design <design-path> --impl <scenario/label | png-path>`.
4. Read the triptych (`output/visual-diff/design/*.triptych.png`) and judge by layout, spacing and color tokens. The diff percent is a **trend signal only** (lower than last round = converging) — cross-renderer font rasterization makes sub-pixel text noise unavoidable; never chase it.
5. Mismatch → go to 1. Match → continue.
6. If this is a new UI state, extend the relevant scenario in `apps/desktop/scripts/verify-screenshots.mjs` (per CLAUDE.md), re-capture, then bless the baseline:
   `pnpm --filter @marginalia/desktop compare:screenshots --update-baseline <scenario/label> --reason "<why>"`.
7. Finish with the `verify` skill (typecheck / test / lint / i18n / regression compare).

## Judging rules

- Judge layout structure, spacing rhythm, typography hierarchy and design tokens (`text-muted`, `border-soft`, `brand`, …) — not anti-aliased text pixels.
- For each `changed` regression shot you must classify: intentional change (bless with `--reason`) / unintended regression (fix) / unsure (do **not** bless; report to the user).
