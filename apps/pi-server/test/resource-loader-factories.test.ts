import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";

describe("DefaultResourceLoader extensionFactories", () => {
  it("invokes inline extension factories with discovery disabled", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "loader-smoke-"));
    let invoked = false;
    const loader = new DefaultResourceLoader({
      cwd: dir,
      agentDir: path.join(dir, "agent"),
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: [
        (pi: { on(type: string, handler: unknown): void }) => {
          invoked = true;
          pi.on("agent_start", () => {});
        }
      ]
    });
    await loader.reload();
    expect(invoked).toBe(true);
  });
});
