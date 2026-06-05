import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(path.resolve(testDir, "../package.json"), "utf8")) as {
  files?: string[];
  scripts?: Record<string, string>;
};

describe("package surface", () => {
  it("keeps production start native check deploy-safe", () => {
    expect(packageJson.files).toContain("scripts/ensure-native-abi.mjs");
    expect(packageJson.scripts?.start).toBe(
      "node scripts/ensure-native-abi.mjs --check-only && node dist/index.js"
    );
    expect(packageJson.scripts?.start).not.toContain("pnpm run");
  });
});
