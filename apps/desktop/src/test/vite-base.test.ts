import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("vite build config", () => {
  // Electron loads the packaged renderer via loadFile() → file:// origin.
  // Without a relative base, Vite emits absolute "/assets/..." URLs that
  // resolve to the filesystem root under file://, so the JS/CSS 404
  // (net::ERR_FILE_NOT_FOUND), React never mounts and the static splash
  // hangs forever. A relative base keeps the packaged build loadable.
  // (Read as source text: importing the config pulls in esbuild, which
  // is unusable in the jsdom test environment.)
  it("sets a relative base so file:// assets resolve in the packaged build", () => {
    const source = readFileSync(path.resolve(process.cwd(), "vite.config.ts"), "utf8");
    expect(source).toMatch(/base:\s*["']\.\/["']/);
  });
});
