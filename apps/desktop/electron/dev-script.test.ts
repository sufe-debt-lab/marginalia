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

  it("disables renderer motion in screenshot verification mode", () => {
    const mainSource = readFileSync(path.resolve(process.cwd(), "electron/main.ts"), "utf8");

    expect(mainSource).toContain("MARGINALIA_SCREENSHOT_VERIFY");
    expect(mainSource).toContain('setAttribute("data-motion", "off")');
  });

  it("forces a 1x device scale factor for screenshot verification", () => {
    const mainSource = readFileSync(path.resolve(process.cwd(), "electron/main.ts"), "utf8");

    expect(mainSource).toContain('appendSwitch("force-device-scale-factor", "1")');
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
    // Boot pi-server from did-finish-load so the static splash is already painted before
    // the (cold) server fork begins, keeping the window responsive during startup.
    const mainSource = readFileSync(path.resolve(process.cwd(), "electron/main.ts"), "utf8");

    expect(mainSource).toMatch(
      /once\(\s*["']did-finish-load["'][\s\S]{0,80}bootServerInBackground/
    );
  });

  it("runs the packaged server on Electron's Node and the dev server on system Node", () => {
    // Packaged: utilityProcess (Electron's own Node, no client Node install needed).
    // Dev: system `node` from PATH, whose ABI matches the better-sqlite3 that pnpm
    // install built — forking dev under Electron's different ABI would crash on boot.
    // Either way the old PATH-scanning / ABI-probing selectNodePath helper is gone.
    const spawnerSource = readFileSync(
      path.resolve(process.cwd(), "electron/pi-server-spawner.ts"),
      "utf8"
    );
    const mainSource = readFileSync(path.resolve(process.cwd(), "electron/main.ts"), "utf8");

    // Match specific tokens (not bare words) so an explanatory comment can't satisfy the
    // guardrail after the real call site is removed.
    expect(spawnerSource).not.toMatch(/selectNodePath/);
    expect(spawnerSource).toMatch(/utilityProcess\.fork/);
    expect(spawnerSource).toMatch(/import\("node:child_process"\)/);
    expect(mainSource).toMatch(/isPackaged/);
  });

  it("builds workspace packages before bundling so their dist exists", () => {
    // prepack:app feeds vite (desktop) and the pi-server deploy, both of which import
    // workspace libs (e.g. @marginalia/chat-core) via their dist/ exports, so a
    // topological `pnpm -r build` must run before bundling.
    const packageJson = JSON.parse(
      readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts["prepack:app"]).toMatch(/-r build/);
  });
});
