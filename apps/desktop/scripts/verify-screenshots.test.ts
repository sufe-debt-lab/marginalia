import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PNG } from "pngjs";

// @ts-expect-error -- plain ESM script without type declarations
import {
  assertScreenshotMotionOff,
  assessFramePair,
  ensureFixtureProvider,
  parseArgs,
  SCENARIOS,
  writeSkillsFixture
} from "./verify-screenshots.mjs";

/** A solid-gray PNG buffer with optional per-pixel overrides for noise/regions. */
function grayPng(width: number, height: number, overrides: Array<[number, number, number]> = []) {
  const png = new PNG({ width, height });
  png.data.fill(200);
  for (let i = 3; i < png.data.length; i += 4) png.data[i] = 255;
  for (const [x, y, value] of overrides) {
    const k = (y * width + x) * 4;
    png.data[k] = png.data[k + 1] = png.data[k + 2] = value;
  }
  return PNG.sync.write(png);
}

const DEFAULTS = [
  "core-ui",
  "seeded-workspace",
  "approval-flow",
  "workspace-access",
  "skills-flow",
  "desktop-panels"
];
const SKILLS_FLOW_LABELS = [
  "skills-settings",
  "skill-picker-dollar",
  "slash-skills",
  "skill-chips",
  "skills-global-only",
  "skill-diagnostics",
  "skill-precondition-blocked"
];

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

  it("waits for fonts and takes burst-stable screenshots", () => {
    const source = readFileSync(
      path.resolve(process.cwd(), "scripts/verify-screenshots.mjs"),
      "utf8"
    );
    expect(source).toContain("document.fonts.ready");
    expect(source).toContain("captureStablePng");
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

describe("assessFramePair capture stability", () => {
  it("treats byte-identical frames as stable", () => {
    const frame = grayPng(20, 20);
    expect(assessFramePair(frame, Buffer.from(frame))).toEqual({ stable: true, diffPixels: 0 });
  });

  it("tolerates sub-threshold compositor raster noise (±1 gray level)", () => {
    // The real-world signature this guards: identical page content whose
    // antialiased edges re-rasterize a hair differently per captured frame.
    const a = grayPng(20, 20, [[10, 10, 245]]);
    const b = grayPng(20, 20, [[10, 10, 246]]);
    expect(a.equals(b)).toBe(false);
    expect(assessFramePair(a, b)).toEqual({ stable: true, diffPixels: 0 });
  });

  it("still rejects real content changes", () => {
    const a = grayPng(20, 20);
    const b = grayPng(20, 20, [
      [5, 5, 0],
      [6, 5, 0],
      [7, 5, 0]
    ]);
    const result = assessFramePair(a, b);
    expect(result.stable).toBe(false);
    expect(result.diffPixels).toBeGreaterThan(0);
  });

  it("treats undecodable or mismatched captures as unstable instead of throwing", () => {
    const result = assessFramePair(grayPng(20, 20), grayPng(10, 10));
    expect(result.stable).toBe(false);
    expect(result.diffPixels).toBeNull();
  });
});

describe("ensureFixtureProvider", () => {
  it("reuses an existing fixture provider instead of creating a duplicate", async () => {
    const existing = { id: "p1", name: "OpenAI", defaultModel: "gpt-5.1" };
    const request = vi.fn(async () => [existing]);
    await expect(ensureFixtureProvider("http://x", request)).resolves.toEqual(existing);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("http://x", "/providers");
  });

  it("creates the fixture provider when none exists", async () => {
    const request = vi.fn(async (_base: string, _endpoint: string, init?: { method?: string }) =>
      init?.method === "POST" ? { id: "p2", name: "OpenAI" } : []
    );
    await ensureFixtureProvider("http://x", request);
    expect(request).toHaveBeenCalledTimes(2);
    const [, , init] = request.mock.calls[1] as [string, string, { method: string; body: string }];
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body) as { name: string; defaultModel: string };
    expect(body.name).toBe("OpenAI");
    expect(body.defaultModel).toBe("gpt-5.1");
  });
});

describe("scenario hermeticity (source contracts)", () => {
  const source = readFileSync(
    path.resolve(process.cwd(), "scripts/verify-screenshots.mjs"),
    "utf8"
  );

  it("seeded-workspace provisions its own provider before its first capture", () => {
    // Solo runs and the shared default pass must render the same composer state;
    // piggybacking on core-ui's provider made baselines depend on run grouping.
    const provision = source.indexOf("ensureFixtureProvider(ctx.apiBase, ctx.apiJson)");
    expect(provision).toBeGreaterThan(-1);
    expect(provision).toBeLessThan(
      source.indexOf('capture(ctx, "seeded-workspace", "recent-threads")')
    );
  });

  it("approval-flow shares the same idempotent provisioning helper", () => {
    const scenarioStart = source.indexOf("async function scenarioApprovalFlow");
    const scenarioEnd = source.indexOf("async function scenarioMinimaxLive");
    const body = source.slice(scenarioStart, scenarioEnd);
    expect(body).toContain("ensureFixtureProvider(ctx.apiBase, ctx.apiJson)");
  });

  it("capture stability uses the tolerant frame comparison, not raw byte equality", () => {
    expect(source).toContain("assessFramePair");
  });

  it("resets isolated harness state without deleting screenshots from earlier passes", () => {
    const start = source.indexOf("async function withHarness");
    const end = source.indexOf("async function runAdhocSession");
    const body = source.slice(start, end);
    expect(body).toContain("if (clean) await rm(outRoot");
    expect(body).toContain("else await rm(runRoot");
  });

  it("keeps Skills fixture writes inside the isolated harness home and workspace", async () => {
    const root = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const os = await vi.importActual<typeof import("node:os")>("node:os");
    const fixtureRoot = await root.mkdtemp(path.join(os.tmpdir(), "marginalia-skills-shot-"));
    const home = path.join(fixtureRoot, "home");
    const workspace = path.join(fixtureRoot, "workspace");
    try {
      const fixture = await writeSkillsFixture({ root: fixtureRoot, home, workspace });
      expect(fixture.writtenPaths.length).toBeGreaterThan(0);
      expect(
        fixture.writtenPaths.every((file: string) => file.startsWith(`${fixtureRoot}${path.sep}`))
      ).toBe(true);
      expect(
        fixture.writtenPaths.every((file: string) =>
          [".marginalia/skills", ".pi/skills", ".agents/skills"].some((directory) =>
            file.split(path.sep).join("/").includes(`/${directory}/`)
          )
        )
      ).toBe(true);
      expect(
        fixture.writtenPaths.some((file: string) => file.includes(process.env.HOME ?? ""))
      ).toBe(false);
    } finally {
      await root.rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("rejects a Skills fixture root that escapes the isolated harness run", async () => {
    const root = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const os = await vi.importActual<typeof import("node:os")>("node:os");
    const fixtureRoot = await root.mkdtemp(path.join(os.tmpdir(), "marginalia-skills-boundary-"));
    const escapedWorkspace = `${fixtureRoot}-escape`;
    try {
      await expect(
        writeSkillsFixture({
          root: fixtureRoot,
          home: path.join(fixtureRoot, "home"),
          workspace: escapedWorkspace
        })
      ).rejects.toThrow(/outside isolated run root/i);
    } finally {
      await root.rm(fixtureRoot, { recursive: true, force: true });
      await root.rm(escapedWorkspace, { recursive: true, force: true });
    }
  });

  it("keeps bearer authentication out of the renderer harness", () => {
    expect(source).toContain("window.marginalia.requestPiServer");
    expect(source).not.toMatch(/manifest\.(?:capabilityToken|token)|capabilityToken.*summary/);
  });
});

describe("screenshot determinism injection (electron main)", () => {
  const mainSource = readFileSync(path.resolve(process.cwd(), "electron/main.ts"), "utf8");

  it("freezes the renderer clock in screenshot mode", () => {
    expect(mainSource).toContain("__MARGINALIA_FROZEN_NOW__");
  });

  it("hides the text caret in screenshot mode", () => {
    expect(mainSource).toContain("caret-color: transparent");
  });
});

describe("SCENARIOS registry export", () => {
  it("exposes scenario metadata for the compare tool", () => {
    expect(Object.keys(SCENARIOS)).toEqual([
      "core-ui",
      "seeded-workspace",
      "approval-flow",
      "workspace-access",
      "skills-flow",
      "desktop-panels",
      "minimax-live"
    ]);
    expect(SCENARIOS["minimax-live"].live).toBe(true);
    expect(SCENARIOS["core-ui"].expected).toContain("first-run");
    expect(SCENARIOS["seeded-workspace"].expected).toContain("recent-threads");
    expect(SCENARIOS["approval-flow"].expected).toContain("approval-command-pending");
    expect(SCENARIOS["skills-flow"].expected).toEqual(SKILLS_FLOW_LABELS);
  });

  it("isolates env-declaring scenarios (e.g. approval-flow's fake agent) from the shared harness pass", () => {
    expect(SCENARIOS["approval-flow"].env).toEqual({ MARGINALIA_FAKE_AGENT: "1" });
    expect(SCENARIOS["skills-flow"].env).toEqual({ MARGINALIA_FAKE_AGENT: "1" });
    expect(SCENARIOS["core-ui"].env).toBeUndefined();
    expect(SCENARIOS["seeded-workspace"].env).toBeUndefined();
  });
});
