import { describe, expect, it } from "vitest";

// @ts-expect-error -- plain ESM script without type declarations
import { parseArgs } from "./verify-screenshots.mjs";

const DEFAULTS = ["core-ui", "seeded-workspace"];

describe("verify-screenshots parseArgs", () => {
  it("defaults to the local scenarios with cleaning enabled", () => {
    expect(parseArgs([])).toEqual({
      list: false,
      clean: true,
      adhoc: false,
      shotName: null,
      scenarios: DEFAULTS
    });
  });

  it("parses --list and --no-clean", () => {
    expect(parseArgs(["--list"]).list).toBe(true);
    expect(parseArgs(["--no-clean"]).clean).toBe(false);
  });

  it("selects and de-duplicates scenarios across flag spellings", () => {
    expect(parseArgs(["--scenario", "core-ui"]).scenarios).toEqual(["core-ui"]);
    expect(parseArgs(["--scenario=core-ui"]).scenarios).toEqual(["core-ui"]);
    expect(parseArgs(["-s", "core-ui", "-s", "core-ui"]).scenarios).toEqual(["core-ui"]);
  });

  it("rejects unknown arguments", () => {
    expect(() => parseArgs(["--bogus"])).toThrow(/Unknown argument/);
  });

  it("requires a value after --scenario", () => {
    expect(() => parseArgs(["--scenario"])).toThrow(/requires a scenario id/);
  });

  // Ad-hoc screenshot mode: launch the real Electron app and capture the screen
  // the developer just built, without editing the fixed scenario scripts.
  it("enters ad-hoc mode with --shot and no label", () => {
    const opts = parseArgs(["--shot"]);
    expect(opts.adhoc).toBe(true);
    expect(opts.shotName).toBeNull();
  });

  it("takes an optional initial label as --shot <name> or --shot=<name>", () => {
    expect(parseArgs(["--shot", "my-feature"]).shotName).toBe("my-feature");
    expect(parseArgs(["--shot=my-feature"]).shotName).toBe("my-feature");
  });

  it("does not swallow a following flag as the --shot label", () => {
    const opts = parseArgs(["--shot", "--no-clean"]);
    expect(opts.adhoc).toBe(true);
    expect(opts.shotName).toBeNull();
    expect(opts.clean).toBe(false);
  });
});
