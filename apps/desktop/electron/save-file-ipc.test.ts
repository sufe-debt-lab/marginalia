import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// electron/main.ts drives real Electron dialog/fs APIs (dialog.showSaveDialog, fs writeFile),
// which aren't meaningfully exercisable outside a running Electron process. Like
// scripts/verify-screenshots.test.ts's checks on verify-screenshots.mjs, we assert on the
// source text that the IPC handler and the save dialog call are actually wired up.
describe("marginalia:save-text-file IPC handler (electron main)", () => {
  const mainSource = readFileSync(path.resolve(process.cwd(), "electron/main.ts"), "utf8");

  it("registers the save-text-file IPC handler", () => {
    expect(mainSource).toContain("marginalia:save-text-file");
  });

  it("opens a native save dialog", () => {
    expect(mainSource).toContain("showSaveDialog");
  });

  it("returns a failure result instead of rejecting the IPC call when the write fails", () => {
    const handler = mainSource.slice(mainSource.indexOf("marginalia:save-text-file"));
    expect(handler).toMatch(/catch[\s\S]{0,400}saved:\s*false/);
  });
});
