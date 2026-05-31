import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("desktop dev script", () => {
  it("starts Vite and Electron together", () => {
    const packageJson = JSON.parse(
      readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")
    ) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts.dev).toContain("vite --host 127.0.0.1");
    expect(packageJson.scripts.dev).toContain("electron dist-electron/main.js");
  });

  it("uses a CommonJS preload artifact that Electron can require", () => {
    const mainSource = readFileSync(path.resolve(process.cwd(), "electron/main.ts"), "utf8");

    expect(mainSource).toContain("preload.cjs");
  });

  it("loads the built renderer (dist/index.html), not the source HTML, in production", () => {
    // main.js runs from dist-electron/, so the built renderer is at ../dist/index.html.
    // Loading "../index.html" (the source) under file:// would serve the dev HTML whose
    // <script src="/src/main.tsx"> never executes, leaving the app stuck on the splash.
    const mainSource = readFileSync(path.resolve(process.cwd(), "electron/main.ts"), "utf8");

    expect(mainSource).toContain("../dist/index.html");
    expect(mainSource).not.toMatch(/loadFile\([^)]*["'`][^"'`]*\.\.\/index\.html/);
  });

  it("defers pi-server boot until the renderer has loaded so the splash can paint", () => {
    // startPiServer() runs a synchronous spawnSync preflight before returning its
    // promise; calling bootServerInBackground() inline would block the Electron main
    // process (and the splash paint) on a slow cold start. Wire it to did-finish-load
    // so the static splash is already on screen before the blocking preflight runs.
    const mainSource = readFileSync(path.resolve(process.cwd(), "electron/main.ts"), "utf8");

    expect(mainSource).toMatch(
      /once\(\s*["']did-finish-load["'][\s\S]{0,80}bootServerInBackground/
    );
  });
});
