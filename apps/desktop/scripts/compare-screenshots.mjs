#!/usr/bin/env node

import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { composeTriptych, diffPngBuffers, readPngSize } from "./lib/image-diff.mjs";
import { SCENARIOS } from "./verify-screenshots.mjs";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopRoot, "../..");
const shotsRoot = path.join(repoRoot, "output/desktop-screenshots");
const baselineRoot = path.join(desktopRoot, "screenshots-baseline");
const outRoot = path.join(repoRoot, "output/visual-diff");

// ≤0.05% pixel difference is treated as anti-aliasing noise → unchanged (initial, tunable)
const NOISE_FLOOR_RATIO = 0.0005;

export function parseCompareArgs(argv) {
  const options = {
    mode: "regression",
    design: null,
    impl: null,
    updateBaseline: [],
    reason: null,
    failOnDiff: false,
    maxDiffPercent: null
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (
      arg === "--design" ||
      arg === "--impl" ||
      arg === "--reason" ||
      arg === "--max-diff-percent"
    ) {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      if (arg === "--design") options.design = value;
      else if (arg === "--impl") options.impl = value;
      else if (arg === "--reason") options.reason = value;
      else {
        const num = Number(value);
        if (!Number.isFinite(num) || num < 0) {
          throw new Error(`--max-diff-percent requires a non-negative number, got: ${value}`);
        }
        options.maxDiffPercent = num;
      }
      i += 1;
    } else if (arg === "--update-baseline") {
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) {
        options.updateBaseline.push(argv[i + 1]);
        i += 1;
      }
      if (options.updateBaseline.length === 0)
        throw new Error("--update-baseline requires selectors");
    } else if (arg === "--fail-on-diff") {
      options.failOnDiff = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (options.updateBaseline.length > 0 && !options.reason) {
    throw new Error('--update-baseline requires --reason "<why>"');
  }
  if ((options.design === null) !== (options.impl === null)) {
    throw new Error(options.design ? "--design requires --impl" : "--impl requires --design");
  }
  if (options.design) options.mode = "design";
  return options;
}

export function classifyShots({ manifest, scenarios, baselineLabels }) {
  const ranScenarios = (manifest.scenarios ?? []).filter(
    (id) => scenarios[id] && !scenarios[id].live
  );
  const entries = [];
  for (const id of ranScenarios) {
    const shots = (manifest.screenshots ?? []).filter((shot) => shot.scenario === id);
    const captured = new Set(shots.map((shot) => shot.label));
    for (const shot of shots) {
      const hasBaseline = (baselineLabels[id] ?? []).includes(shot.label);
      entries.push({
        scenario: id,
        label: shot.label,
        path: shot.path,
        status: hasBaseline ? "pending-diff" : "new"
      });
    }
    for (const label of baselineLabels[id] ?? []) {
      if (!captured.has(label)) entries.push({ scenario: id, label, status: "orphan" });
    }
  }
  const notCovered = Object.keys(baselineLabels)
    .filter((id) => !ranScenarios.includes(id))
    .sort();
  return { entries, notCovered };
}

export function buildSummaryLine(counts) {
  return `changed=${counts.changed} new=${counts.new} unchanged=${counts.unchanged} orphan=${counts.orphan} errors=${counts.errors}`;
}

// maxChangedRatioPercent: largest diff ratio among changed shots, as a percent (0–100)
export function resolveExitCode(counts, { failOnDiff, maxDiffPercent }, maxChangedRatioPercent) {
  if (counts.errors > 0) return 1;
  if (failOnDiff && (counts.changed > 0 || counts.orphan > 0)) return 1;
  if (maxDiffPercent !== null && maxChangedRatioPercent > maxDiffPercent) return 1;
  return 0;
}

async function readBaselineLabels() {
  const labels = {};
  const scenarioDirs = await readdir(baselineRoot, { withFileTypes: true }).catch(() => []);
  for (const dir of scenarioDirs) {
    if (!dir.isDirectory()) continue;
    const files = await readdir(path.join(baselineRoot, dir.name));
    labels[dir.name] = files.filter((f) => f.endsWith(".png")).map((f) => f.slice(0, -4));
  }
  return labels;
}

function baselinePath(scenario, label) {
  return path.join(baselineRoot, scenario, `${label}.png`);
}

async function runRegression(options) {
  const manifest = JSON.parse(await readFile(path.join(shotsRoot, "manifest.json"), "utf8"));
  const baselineLabels = await readBaselineLabels();
  const { entries, notCovered } = classifyShots({ manifest, scenarios: SCENARIOS, baselineLabels });

  await rm(outRoot, { recursive: true, force: true });
  await mkdir(path.join(outRoot, "diff"), { recursive: true });

  const counts = { changed: 0, new: 0, unchanged: 0, orphan: 0, errors: 0 };
  let maxChangedRatio = 0;
  const shots = [];
  for (const entry of entries) {
    const record = { ...entry, diffRatio: null, diffPath: null, baselinePath: null, error: null };
    if (entry.status === "pending-diff") {
      record.baselinePath = path.relative(repoRoot, baselinePath(entry.scenario, entry.label));
      try {
        const current = await readFile(path.join(repoRoot, entry.path));
        const baseline = await readFile(baselinePath(entry.scenario, entry.label));
        const result = diffPngBuffers(baseline, current);
        record.diffRatio = result.diffRatio;
        record.width = result.width;
        record.height = result.height;
        if (result.diffRatio <= NOISE_FLOOR_RATIO) {
          record.status = "unchanged";
          counts.unchanged += 1;
        } else {
          record.status = "changed";
          counts.changed += 1;
          maxChangedRatio = Math.max(maxChangedRatio, result.diffRatio);
          const diffFile = path.join(outRoot, "diff", `${entry.scenario}--${entry.label}.png`);
          await writeFile(diffFile, result.diffPngBuffer);
          record.diffPath = path.relative(repoRoot, diffFile);
        }
      } catch (error) {
        record.status = "error";
        record.error = error instanceof Error ? error.message : String(error);
        counts.errors += 1;
      }
    } else {
      counts[entry.status] += 1;
    }
    shots.push(record);
  }

  if (options.updateBaseline.length > 0) {
    await applyBaselineUpdates(options, manifest, shots);
  }

  const report = {
    createdAt: new Date().toISOString(),
    mode: "regression",
    summary: counts,
    notCovered,
    updateBaseline: options.updateBaseline,
    reason: options.reason,
    shots
  };
  await writeFile(path.join(outRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(path.join(outRoot, "report.md"), renderReportMd(report));
  console.log(buildSummaryLine(counts));
  console.log(`report: ${path.relative(repoRoot, path.join(outRoot, "report.md"))}`);
  return resolveExitCode(counts, options, maxChangedRatio * 100);
}

// selector "scenario" syncs a whole scenario (copy all captured shots + prune orphan baselines);
// "scenario/label" updates a single shot.
async function applyBaselineUpdates(options, manifest, shots) {
  for (const selector of options.updateBaseline) {
    const [scenario, label] = selector.split("/");
    if (!SCENARIOS[scenario] || SCENARIOS[scenario].live) {
      throw new Error(`cannot bless baseline for unknown/live scenario: ${selector}`);
    }
    const candidates = (manifest.screenshots ?? []).filter(
      (shot) => shot.scenario === scenario && (!label || shot.label === label)
    );
    if (candidates.length === 0) throw new Error(`no captured shots match selector: ${selector}`);
    await mkdir(path.join(baselineRoot, scenario), { recursive: true });
    for (const shot of candidates) {
      await copyFile(path.join(repoRoot, shot.path), baselinePath(scenario, shot.label));
    }
    if (!label) {
      for (const record of shots) {
        if (record.scenario === scenario && record.status === "orphan") {
          await rm(baselinePath(scenario, record.label), { force: true });
        }
      }
    }
    console.log(`[baseline] updated ${selector} (${candidates.length} shots) — ${options.reason}`);
  }
}

function renderReportMd(report) {
  const order = { error: 0, changed: 1, new: 2, orphan: 3, unchanged: 4 };
  const sorted = [...report.shots].sort(
    (a, b) =>
      (order[a.status] ?? 99) - (order[b.status] ?? 99) || a.scenario.localeCompare(b.scenario)
  );
  const lines = [
    "# Visual diff report",
    "",
    `- created: ${report.createdAt}`,
    `- summary: ${buildSummaryLine(report.summary)}`,
    report.reason ? `- baseline update reason: ${report.reason}` : null,
    report.notCovered.length > 0 ? `- not covered this run: ${report.notCovered.join(", ")}` : null,
    "",
    "| status | scenario/label | diff % | current | baseline | diff |",
    "| --- | --- | --- | --- | --- | --- |"
  ].filter((line) => line !== null);
  for (const shot of sorted) {
    const pct = shot.diffRatio === null ? "—" : `${(shot.diffRatio * 100).toFixed(3)}%`;
    const link = (p) => (p ? `[png](../../${p})` : "—");
    lines.push(
      `| ${shot.status} | ${shot.scenario}/${shot.label} | ${pct} | ${link(shot.path)} | ${link(shot.baselinePath)} | ${link(shot.diffPath)} |`
    );
  }
  const changed = sorted.filter((shot) => shot.status === "changed");
  if (changed.length > 0) {
    lines.push("", "## Changed diffs", "");
    for (const shot of changed) {
      lines.push(`### ${shot.scenario}/${shot.label} (${(shot.diffRatio * 100).toFixed(3)}%)`, "");
      lines.push(`![${shot.label}](../../${shot.diffPath})`, "");
    }
  }
  return `${lines.join("\n")}\n`;
}

export function slugifyImpl(value) {
  return value
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function designSourceKind(input) {
  if (/^https?:\/\//.test(input)) return "url";
  if (input.endsWith(".png")) return "png";
  if (input.endsWith(".html")) return "html";
  if (input.endsWith(".jsx") || input.endsWith(".tsx")) {
    throw new Error(
      "pre-render JSX prototypes to HTML or PNG first (compare does not infer frameworks)"
    );
  }
  throw new Error(`Unsupported design input: ${input} (expected .png, .html or http(s) URL)`);
}

// --impl accepts "scenario/label" (looked up in the manifest) or a direct .png path
async function resolveImplPng(impl) {
  if (impl.endsWith(".png")) {
    return { buffer: await readFile(path.resolve(repoRoot, impl)), source: impl };
  }
  const [scenario, label] = impl.split("/");
  const manifest = JSON.parse(await readFile(path.join(shotsRoot, "manifest.json"), "utf8"));
  const shot = (manifest.screenshots ?? []).find(
    (s) => s.scenario === scenario && s.label === label
  );
  if (!shot)
    throw new Error(`no captured shot matches --impl ${impl}; run verify:screenshots first`);
  return { buffer: await readFile(path.join(repoRoot, shot.path)), source: shot.path };
}

async function renderDesignToPng(design, kind, { width, height }) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ args: ["--force-device-scale-factor=1"] });
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    const target = kind === "url" ? design : `file://${path.resolve(repoRoot, design)}`;
    await page.goto(target, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    return await page.screenshot({ fullPage: false, scale: "css" });
  } finally {
    await browser.close();
  }
}

async function runDesignCompare(options) {
  const impl = await resolveImplPng(options.impl);
  const implSize = readPngSize(impl.buffer);
  const kind = designSourceKind(options.design);
  const designBuffer =
    kind === "png"
      ? await readFile(path.resolve(repoRoot, options.design))
      : await renderDesignToPng(options.design, kind, implSize);

  const designSize = readPngSize(designBuffer);
  if (designSize.width !== implSize.width || designSize.height !== implSize.height) {
    throw new Error(
      `design size ${designSize.width}x${designSize.height} != impl ${implSize.width}x${implSize.height}; ` +
        "export the design at the implementation's size (window is 1280x800 css px)"
    );
  }

  const result = diffPngBuffers(designBuffer, impl.buffer);
  const slugName = slugifyImpl(options.impl);
  const designDir = path.join(outRoot, "design");
  await mkdir(designDir, { recursive: true });
  const triptychFile = path.join(designDir, `${slugName}.triptych.png`);
  await writeFile(triptychFile, composeTriptych([designBuffer, impl.buffer, result.diffPngBuffer]));

  const report = {
    createdAt: new Date().toISOString(),
    mode: "design",
    design: { input: options.design, kind, width: designSize.width, height: designSize.height },
    impl: {
      input: options.impl,
      source: impl.source,
      width: implSize.width,
      height: implSize.height
    },
    diffRatio: result.diffRatio,
    diffPercent: result.diffRatio * 100,
    triptych: path.relative(repoRoot, triptychFile)
  };
  await writeFile(
    path.join(designDir, `${slugName}.report.json`),
    `${JSON.stringify(report, null, 2)}\n`
  );
  // Trend signal, NOT a gate (spec): the judge decides via the triptych by layout/spacing/color tokens.
  console.log(`design-diff: ${report.diffPercent.toFixed(3)}% (trend signal, not a gate)`);
  console.log(`triptych: ${report.triptych}`);
  return 0;
}

async function main() {
  const options = parseCompareArgs(process.argv.slice(2));
  if (options.mode === "design") return runDesignCompare(options);
  return runRegression(options);
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main()
    .then((code) => process.exit(code ?? 0))
    .catch((error) => {
      console.error(error instanceof Error ? error.stack || error.message : String(error));
      process.exit(1);
    });
}
