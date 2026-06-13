import { describe, expect, it } from "vitest";

// @ts-expect-error -- plain ESM script without type declarations
import { classifyShots, parseCompareArgs } from "./compare-screenshots.mjs";

describe("parseCompareArgs", () => {
  it("defaults to regression mode with soft exit semantics", () => {
    expect(parseCompareArgs([])).toEqual({
      mode: "regression",
      design: null,
      impl: null,
      updateBaseline: [],
      reason: null,
      failOnDiff: false,
      maxDiffPercent: null
    });
  });

  it("collects update-baseline selectors until the next flag and requires a reason", () => {
    const opts = parseCompareArgs([
      "--update-baseline",
      "core-ui",
      "seeded-workspace/recent-threads",
      "--reason",
      "intentional emerald tone change"
    ]);
    expect(opts.updateBaseline).toEqual(["core-ui", "seeded-workspace/recent-threads"]);
    expect(opts.reason).toBe("intentional emerald tone change");
    expect(() => parseCompareArgs(["--update-baseline", "core-ui"])).toThrow(/--reason/);
  });

  it("enters design mode only when both --design and --impl are present", () => {
    const opts = parseCompareArgs(["--design", "docs/mock.png", "--impl", "core-ui/first-run"]);
    expect(opts.mode).toBe("design");
    expect(() => parseCompareArgs(["--design", "docs/mock.png"])).toThrow(/--impl/);
    expect(() => parseCompareArgs(["--impl", "core-ui/first-run"])).toThrow(/--design/);
  });

  it("parses CI gates and rejects unknown arguments", () => {
    expect(parseCompareArgs(["--fail-on-diff"]).failOnDiff).toBe(true);
    expect(parseCompareArgs(["--max-diff-percent", "0.5"]).maxDiffPercent).toBe(0.5);
    expect(() => parseCompareArgs(["--bogus"])).toThrow(/Unknown argument/);
  });

  it("validates --max-diff-percent is a non-negative number", () => {
    expect(parseCompareArgs(["--max-diff-percent", "0"]).maxDiffPercent).toBe(0);
    expect(() => parseCompareArgs(["--max-diff-percent", "abc"])).toThrow(/non-negative number/);
    expect(() => parseCompareArgs(["--max-diff-percent", "-1"])).toThrow(/non-negative number/);
  });
});

describe("classifyShots", () => {
  const scenarios = {
    "core-ui": { expected: ["first-run", "model-menu"], default: true },
    "seeded-workspace": { expected: ["recent-threads"], default: true },
    "minimax-live": { live: true, expected: ["minimax-result"] }
  };

  it("classifies captured/new/orphan and excludes live scenarios", () => {
    const manifest = {
      scenarios: ["core-ui", "minimax-live"],
      screenshots: [
        { scenario: "core-ui", label: "first-run", path: "output/x/01-first-run.png" },
        { scenario: "core-ui", label: "model-menu", path: "output/x/02-model-menu.png" },
        { scenario: "minimax-live", label: "minimax-result", path: "output/x/03.png" }
      ]
    };
    const baselineLabels = {
      "core-ui": ["first-run", "stale-label"],
      "seeded-workspace": ["recent-threads"]
    };
    const { entries, notCovered } = classifyShots({ manifest, scenarios, baselineLabels });
    expect(entries).toEqual([
      {
        scenario: "core-ui",
        label: "first-run",
        path: "output/x/01-first-run.png",
        status: "pending-diff"
      },
      {
        scenario: "core-ui",
        label: "model-menu",
        path: "output/x/02-model-menu.png",
        status: "new"
      },
      { scenario: "core-ui", label: "stale-label", status: "orphan" }
    ]);
    expect(notCovered).toEqual(["seeded-workspace"]); // ran ≠ orphan
  });
});
