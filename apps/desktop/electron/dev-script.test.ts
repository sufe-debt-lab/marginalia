import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("desktop dev script", () => {
  it("starts Vite and Electron together", () => {
    const packageJson = JSON.parse(readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts.dev).toContain("vite --host 127.0.0.1");
    expect(packageJson.scripts.dev).toContain("electron dist-electron/main.js");
  });

  it("uses a CommonJS preload artifact that Electron can require", () => {
    const mainSource = readFileSync(path.resolve(process.cwd(), "electron/main.ts"), "utf8");

    expect(mainSource).toContain("preload.cjs");
  });
});
