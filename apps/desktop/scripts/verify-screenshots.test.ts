import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

// @ts-expect-error -- plain ESM script without type declarations
import { assertScreenshotMotionOff, parseArgs } from "./verify-screenshots.mjs";

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

  it("fails fast when screenshot motion is not disabled", async () => {
    await expect(
      assertScreenshotMotionOff({
        evaluate: vi.fn(async () => undefined)
      })
    ).rejects.toThrow(/data-motion="off"/);
  });

  it("does not use animation settle timeouts in fixed screenshot scenarios", () => {
    const source = readFileSync(
      path.resolve(process.cwd(), "scripts/verify-screenshots.mjs"),
      "utf8"
    );

    expect(source).not.toMatch(/settle/);
  });

  it("captures screenshots in CSS pixels for design comparisons", () => {
    const source = readFileSync(
      path.resolve(process.cwd(), "scripts/verify-screenshots.mjs"),
      "utf8"
    );

    expect(source).toContain('scale: "css"');
  });

  it("waits for the document panel before seeded chat screenshots", () => {
    const source = readFileSync(
      path.resolve(process.cwd(), "scripts/verify-screenshots.mjs"),
      "utf8"
    );

    expect(source).toContain("waitForDocumentPanelReady");
    expect(source).toContain("hasNonZeroFileCount");
    expect(source).toContain("!/Loading|加载中/");
    expect(source.indexOf("waitForDocumentPanelReady(ctx.page)")).toBeLessThan(
      source.indexOf('capture(ctx, "seeded-workspace", "chat-seeded-session")')
    );
  });
});
