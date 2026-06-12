# 视觉回归 + 设计稿对比 loop · 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给现有 Electron 截图 harness 补上基线视觉回归（pixel diff）和设计稿对比（三联图 + 趋势分数），并把 Claude 自主迭代 loop 固化为项目 skill。

**Architecture:** 捕获/比对分离（spec 方案 B）。`verify-screenshots.mjs` 保持纯捕获职责，仅做确定性加固并导出 `SCENARIOS` 注册表；新增独立的 `compare-screenshots.mjs` 读取 capture manifest 与入库基线比对，diff 逻辑抽 `scripts/lib/image-diff.mjs`。退出码语义二分：capture/contract 坏 = 硬 fail，像素漂移 = 软报告（`--fail-on-diff` 留给 CI）。

**Tech Stack:** pixelmatch + pngjs（纯 JS，无原生 ABI）、playwright（已有依赖，chromium 渲染 HTML 设计稿）、Vitest（node 侧测试，不起 Electron）。

**Spec:** `docs/internal/specs/2026-06-12-visual-regression-design-loop-design.md`

**全局约束（每个 task 的 commit 前都适用）：**

- commit 前运行 `pnpm --filter @marginalia/desktop typecheck && pnpm --filter @marginalia/desktop test`，以及 repo 级 `pnpm lint && pnpm format:check`（脏了就 `pnpm format`）。
- commit 前按用户惯例先跑 `/simplify`。
- ⚠️ `verify-screenshots.test.ts` 有一条源码扫描测试断言 `verify-screenshots.mjs` 中**不得出现 "settle" 字样**——所有新代码用 "stable"/"burst" 措辞。
- `.mjs` 脚本被 `.test.ts` import 时沿用现有先例：`// @ts-expect-error -- plain ESM script without type declarations`。

## 文件结构

| 文件                                                                                  | 职责                                                                                   |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `apps/desktop/scripts/lib/image-diff.mjs`（新建）                                     | 纯函数：PNG 解码、pixelmatch diff（尺寸不一致硬错误）、三联横拼图                      |
| `apps/desktop/scripts/lib/image-diff.test.ts`（新建)                                  | 程序化构造小 PNG 的单测                                                                |
| `apps/desktop/scripts/compare-screenshots.mjs`（新建）                                | 回归模式 + 设计稿模式 + `--update-baseline`；report.json / report.md / 摘要行 / 退出码 |
| `apps/desktop/scripts/compare-screenshots.test.ts`（新建）                            | 参数解析、分类（new/orphan/not-covered/live 排除）、报告结构                           |
| `apps/desktop/scripts/verify-screenshots.mjs`（改）                                   | 导出 `SCENARIOS`；capture 前 fonts.ready + 连拍稳定重试                                |
| `apps/desktop/scripts/verify-screenshots.test.ts`（改）                               | 新导出与新行为的契约/源码扫描测试                                                      |
| `apps/desktop/electron/main.ts`（改）                                                 | 截图模式注入：冻结时钟全局 + `caret-color: transparent`                                |
| `apps/desktop/src/lib/relative-time.ts`（改）                                         | 默认 `now` 读取冻结时钟全局（存在时）                                                  |
| `apps/desktop/src/lib/relative-time.test.ts`（改）                                    | 冻结时钟行为单测                                                                       |
| `apps/desktop/screenshots-baseline/<scenario>/<label>.png`（新建）                    | 入库基线（core-ui 18 + seeded-workspace 7）                                            |
| `apps/desktop/package.json` / root `package.json`（改）                               | `compare:screenshots` / `compare:design` / `verify:visual` 接线                        |
| `.claude/skills/design-loop/SKILL.md`（新建）、`.claude/skills/verify/SKILL.md`（改） | loop 协议与 gate 措辞                                                                  |
| `docs/developer/development.md`、`CLAUDE.md`（改）                                    | 文档与 commit gate                                                                     |

---

### Task 1: 依赖安装

**Files:**

- Modify: `apps/desktop/package.json`（devDependencies）

- [ ] **Step 1: 安装依赖**

```bash
pnpm --filter @marginalia/desktop add -D pixelmatch pngjs
```

- [ ] **Step 2: 验证可加载**

Run: `pnpm --filter @marginalia/desktop exec node -e "import('pixelmatch').then(m=>console.log(typeof m.default)); import('pngjs').then(m=>console.log(typeof m.PNG))"`
Expected: 输出 `function` 两行。

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/package.json pnpm-lock.yaml
git commit -m "chore(desktop): add pixelmatch + pngjs for visual diff"
```

---

### Task 2: `image-diff.mjs` 纯函数库

**Files:**

- Create: `apps/desktop/scripts/lib/image-diff.mjs`
- Test: `apps/desktop/scripts/lib/image-diff.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";

// @ts-expect-error -- plain ESM script without type declarations
import { composeTriptych, diffPngBuffers, readPngSize } from "./image-diff.mjs";

function solidPng(width: number, height: number, rgba: [number, number, number, number]): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i += 1) {
    png.data[i * 4] = rgba[0];
    png.data[i * 4 + 1] = rgba[1];
    png.data[i * 4 + 2] = rgba[2];
    png.data[i * 4 + 3] = rgba[3];
  }
  return PNG.sync.write(png);
}

const WHITE: [number, number, number, number] = [255, 255, 255, 255];
const BLACK: [number, number, number, number] = [0, 0, 0, 255];

describe("diffPngBuffers", () => {
  it("reports zero diff for identical images", () => {
    const a = solidPng(4, 4, WHITE);
    const result = diffPngBuffers(a, solidPng(4, 4, WHITE));
    expect(result).toMatchObject({
      width: 4,
      height: 4,
      diffPixels: 0,
      totalPixels: 16,
      diffRatio: 0
    });
    expect(PNG.sync.read(result.diffPngBuffer).width).toBe(4);
  });

  it("reports full diff for opposite images", () => {
    const result = diffPngBuffers(solidPng(4, 4, WHITE), solidPng(4, 4, BLACK));
    expect(result.diffPixels).toBe(16);
    expect(result.diffRatio).toBe(1);
  });

  it("throws a hard error on size mismatch instead of resizing", () => {
    expect(() => diffPngBuffers(solidPng(4, 4, WHITE), solidPng(4, 8, WHITE))).toThrow(
      /size mismatch: 4x4 vs 4x8/
    );
  });
});

describe("readPngSize", () => {
  it("returns width and height", () => {
    expect(readPngSize(solidPng(6, 3, WHITE))).toEqual({ width: 6, height: 3 });
  });
});

describe("composeTriptych", () => {
  it("concatenates three equal-size panels horizontally with gaps", () => {
    const buf = composeTriptych([
      solidPng(4, 4, WHITE),
      solidPng(4, 4, BLACK),
      solidPng(4, 4, WHITE)
    ]);
    const out = PNG.sync.read(buf);
    expect(out.height).toBe(4);
    expect(out.width).toBe(4 * 3 + 8 * 2); // 8px gap between panels
  });

  it("rejects panels of different sizes", () => {
    expect(() => composeTriptych([solidPng(4, 4, WHITE), solidPng(4, 8, WHITE)])).toThrow(
      /share dimensions/
    );
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @marginalia/desktop test -- image-diff`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 `scripts/lib/image-diff.mjs`**

```js
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const TRIPTYCH_GAP = 8;

export function readPngSize(buffer) {
  const { width, height } = PNG.sync.read(buffer);
  return { width, height };
}

export function diffPngBuffers(aBuffer, bBuffer, { threshold = 0.1 } = {}) {
  const a = PNG.sync.read(aBuffer);
  const b = PNG.sync.read(bBuffer);
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`image size mismatch: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
  const diff = new PNG({ width: a.width, height: a.height });
  const diffPixels = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold });
  const totalPixels = a.width * a.height;
  return {
    width: a.width,
    height: a.height,
    diffPixels,
    totalPixels,
    diffRatio: diffPixels / totalPixels,
    diffPngBuffer: PNG.sync.write(diff)
  };
}

export function composeTriptych(buffers) {
  const images = buffers.map((buffer) => PNG.sync.read(buffer));
  const [first, ...rest] = images;
  if (rest.some((image) => image.width !== first.width || image.height !== first.height)) {
    throw new Error("triptych panels must share dimensions");
  }
  const out = new PNG({
    width: first.width * images.length + TRIPTYCH_GAP * (images.length - 1),
    height: first.height
  });
  out.data.fill(255);
  images.forEach((image, index) => {
    PNG.bitblt(
      image,
      out,
      0,
      0,
      image.width,
      image.height,
      index * (first.width + TRIPTYCH_GAP),
      0
    );
  });
  return PNG.sync.write(out);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @marginalia/desktop test -- image-diff`
Expected: PASS（6 个用例）。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/scripts/lib/image-diff.mjs apps/desktop/scripts/lib/image-diff.test.ts
git commit -m "feat(desktop): image-diff library (pixelmatch wrapper + triptych compose)"
```

---

### Task 3: 导出 `SCENARIOS` 注册表

**Files:**

- Modify: `apps/desktop/scripts/verify-screenshots.mjs`（文件末尾的 `export` 行）
- Test: `apps/desktop/scripts/verify-screenshots.test.ts`

- [ ] **Step 1: 写失败测试**（追加到 `verify-screenshots.test.ts`，import 行加上 `SCENARIOS`）

```ts
describe("SCENARIOS registry export", () => {
  it("exposes scenario metadata for the compare tool", () => {
    expect(Object.keys(SCENARIOS)).toEqual(["core-ui", "seeded-workspace", "minimax-live"]);
    expect(SCENARIOS["minimax-live"].live).toBe(true);
    expect(SCENARIOS["core-ui"].expected).toContain("first-run");
    expect(SCENARIOS["seeded-workspace"].expected).toContain("recent-threads");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @marginalia/desktop test -- verify-screenshots`
Expected: FAIL（`SCENARIOS` 未导出）。

- [ ] **Step 3: 实现** — `verify-screenshots.mjs` 最后一行改为：

```js
export { assertScreenshotMotionOff, parseArgs, SCENARIOS };
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @marginalia/desktop test -- verify-screenshots`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/scripts/verify-screenshots.mjs apps/desktop/scripts/verify-screenshots.test.ts
git commit -m "feat(desktop): export SCENARIOS registry for the compare tool"
```

---

### Task 4: 渲染侧确定性 —— 冻结时钟 + 隐藏 caret

**Files:**

- Modify: `apps/desktop/src/lib/relative-time.ts`
- Modify: `apps/desktop/electron/main.ts`（`installScreenshotMotionGate`）
- Test: `apps/desktop/src/lib/relative-time.test.ts`、`apps/desktop/scripts/verify-screenshots.test.ts`

设计：截图模式下 main 进程在 `dom-ready` 时注入 `window.__MARGINALIA_FROZEN_NOW__ = Date.now()`（与现有 `data-motion=off` 同一注入点；harness 在每张截图前已断言该注入完成，时序有保障）。`relativeTime` 的默认 `now` 优先读冻结值——seeded 会话在启动后几秒内创建，冻结后所有相对时间恒为「now/现在」，跨分钟/跨天重跑不漂移。caret 用注入 CSS 隐藏。

- [ ] **Step 1: 写失败测试**（`relative-time.test.ts` 追加；该测试跑在 jsdom 下，`window` 可用）

```ts
describe("frozen clock for screenshot verification", () => {
  afterEach(() => {
    delete (window as { __MARGINALIA_FROZEN_NOW__?: number }).__MARGINALIA_FROZEN_NOW__;
  });

  it("uses window.__MARGINALIA_FROZEN_NOW__ as the default now when present", () => {
    (window as { __MARGINALIA_FROZEN_NOW__?: number }).__MARGINALIA_FROZEN_NOW__ = NOW;
    expect(relativeTime(NOW - 5_000, "en")).toBe("now");
    expect(relativeTime(NOW - 3 * MIN, "zh")).toBe("3分钟");
  });

  it("falls back to Date.now() when the frozen clock is absent", () => {
    expect(relativeTime(Date.now() - 1_000, "en")).toBe("now");
  });
});
```

（`NOW`/`MIN` 常量沿用该测试文件现有定义；若 `3分钟` 与现有 zh 文案不符，以 `relativeTime(NOW - 3 * MIN, "zh", NOW)` 的现有断言文案为准。）

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @marginalia/desktop test -- relative-time`
Expected: 第一条 FAIL（默认 now 仍是真实时钟，5 秒前可能仍是 "now"——为使失败可观察，第一条断言改用 `NOW` 为非当前时刻：把 `__MARGINALIA_FROZEN_NOW__` 设为 `NOW`，而 `NOW` 是测试文件里固定的历史时间戳，真实时钟下 `NOW - 5_000` 距今很远，必然不是 "now"）。

- [ ] **Step 3: 实现 `relative-time.ts`** —— 在函数默认参数处接入：

```ts
function frozenNow(): number | null {
  if (typeof window === "undefined") return null;
  const value = (window as { __MARGINALIA_FROZEN_NOW__?: unknown }).__MARGINALIA_FROZEN_NOW__;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function relativeTime(
  value: number,
  locale: Locale,
  now: number = frozenNow() ?? Date.now()
) {
  // 函数体不变
}
```

（签名/类型名以现有文件为准，只改默认值表达式并新增 `frozenNow`。）

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @marginalia/desktop test -- relative-time`
Expected: PASS。

- [ ] **Step 5: 写 main.ts 注入的失败测试**（源码扫描，追加到 `verify-screenshots.test.ts`，沿用该文件 `readFileSync` 模式）

```ts
describe("screenshot determinism injection (electron main)", () => {
  const mainSource = readFileSync(path.resolve(process.cwd(), "electron/main.ts"), "utf8");

  it("freezes the renderer clock in screenshot mode", () => {
    expect(mainSource).toContain("__MARGINALIA_FROZEN_NOW__");
  });

  it("hides the text caret in screenshot mode", () => {
    expect(mainSource).toContain("caret-color: transparent");
  });
});
```

- [ ] **Step 6: 跑测试确认失败**

Run: `pnpm --filter @marginalia/desktop test -- verify-screenshots`
Expected: 两条新增 FAIL。

- [ ] **Step 7: 实现 main.ts** —— `installScreenshotMotionGate` 扩展为：

```ts
function installScreenshotMotionGate(window: BrowserWindow) {
  if (!isScreenshotVerify) return;
  window.webContents.on("dom-ready", () => {
    void window.webContents.executeJavaScript(
      'document.documentElement.setAttribute("data-motion", "off");' +
        "window.__MARGINALIA_FROZEN_NOW__ = Date.now();",
      true
    );
    void window.webContents.insertCSS("* { caret-color: transparent !important; }");
  });
}
```

- [ ] **Step 8: 跑全部相关测试确认通过**

Run: `pnpm --filter @marginalia/desktop typecheck && pnpm --filter @marginalia/desktop test -- verify-screenshots && pnpm --filter @marginalia/desktop test -- relative-time`
Expected: PASS。

- [ ] **Step 9: Commit**

```bash
git add apps/desktop/src/lib/relative-time.ts apps/desktop/src/lib/relative-time.test.ts apps/desktop/electron/main.ts apps/desktop/scripts/verify-screenshots.test.ts
git commit -m "feat(desktop): freeze renderer clock + hide caret under screenshot verify"
```

---

### Task 5: capture 连拍稳定重试 + fonts.ready

**Files:**

- Modify: `apps/desktop/scripts/verify-screenshots.mjs`（`capture()`）
- Test: `apps/desktop/scripts/verify-screenshots.test.ts`

⚠️ 措辞禁用 "settle"（现有源码扫描测试会红）。

- [ ] **Step 1: 写失败测试**（源码扫描，追加）

```ts
it("waits for fonts and takes burst-stable screenshots", () => {
  const source = readFileSync(
    path.resolve(process.cwd(), "scripts/verify-screenshots.mjs"),
    "utf8"
  );
  expect(source).toContain("document.fonts.ready");
  expect(source).toContain("captureStablePng");
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @marginalia/desktop test -- verify-screenshots`
Expected: FAIL。

- [ ] **Step 3: 实现** —— `verify-screenshots.mjs` 新增函数，并把 `capture()` 中的 `page.screenshot({ path: file, ... })` 替换为先取稳定 buffer 再写盘：

```js
const STABLE_RETRY_LIMIT = 3;
const STABLE_RETRY_DELAY_MS = 120;

async function captureStablePng(page) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  let previous = await page.screenshot({ fullPage: false, scale: "css" });
  for (let attempt = 0; attempt < STABLE_RETRY_LIMIT; attempt += 1) {
    await page.waitForTimeout(STABLE_RETRY_DELAY_MS);
    const next = await page.screenshot({ fullPage: false, scale: "css" });
    if (next.equals(previous)) return next;
    previous = next;
  }
  throw new Error(`screenshot did not become stable after ${STABLE_RETRY_LIMIT} retries`);
}
```

`capture()` 内：

```js
const buffer = await captureStablePng(ctx.page);
await writeFile(file, buffer);
```

（`writeFile` 已在文件头部 import。）

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @marginalia/desktop test -- verify-screenshots`
Expected: PASS（含既有 "no settle" 测试）。

- [ ] **Step 5: 端到端冒烟** —— 真实跑一遍默认场景确认 harness 没被弄坏：

Run: `pnpm verify:screenshots`
Expected: `status: passed`，25 张截图，`output/desktop-screenshots/summary.md` 生成。

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/scripts/verify-screenshots.mjs apps/desktop/scripts/verify-screenshots.test.ts
git commit -m "feat(desktop): burst-stable capture with fonts.ready gate"
```

---

### Task 6: `compare-screenshots.mjs` · 参数解析与分类（纯函数）

**Files:**

- Create: `apps/desktop/scripts/compare-screenshots.mjs`（本 task 只写纯函数 + 导出）
- Test: `apps/desktop/scripts/compare-screenshots.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, expect, it } from "vitest";

// @ts-expect-error -- plain ESM script without type declarations
import { classifyShots, parseCompareArgs } from "./compare-screenshots.mjs";

describe("parseCompareArgs", () => {
  it("defaults to regression mode with soft exit semantics", () => {
    expect(parseCompareArgs([])).toEqual({
      mode: "regression",
      design: null,
      impl: null,
      updateBaseline: [],
      reason: null,
      failOnDiff: false,
      maxDiffPercent: null
    });
  });

  it("collects update-baseline selectors until the next flag and requires a reason", () => {
    const opts = parseCompareArgs([
      "--update-baseline",
      "core-ui",
      "seeded-workspace/recent-threads",
      "--reason",
      "intentional emerald tone change"
    ]);
    expect(opts.updateBaseline).toEqual(["core-ui", "seeded-workspace/recent-threads"]);
    expect(opts.reason).toBe("intentional emerald tone change");
    expect(() => parseCompareArgs(["--update-baseline", "core-ui"])).toThrow(/--reason/);
  });

  it("enters design mode only when both --design and --impl are present", () => {
    const opts = parseCompareArgs(["--design", "docs/mock.png", "--impl", "core-ui/first-run"]);
    expect(opts.mode).toBe("design");
    expect(() => parseCompareArgs(["--design", "docs/mock.png"])).toThrow(/--impl/);
    expect(() => parseCompareArgs(["--impl", "core-ui/first-run"])).toThrow(/--design/);
  });

  it("parses CI gates and rejects unknown arguments", () => {
    expect(parseCompareArgs(["--fail-on-diff"]).failOnDiff).toBe(true);
    expect(parseCompareArgs(["--max-diff-percent", "0.5"]).maxDiffPercent).toBe(0.5);
    expect(() => parseCompareArgs(["--bogus"])).toThrow(/Unknown argument/);
  });
});

describe("classifyShots", () => {
  const scenarios = {
    "core-ui": { expected: ["first-run", "model-menu"], default: true },
    "seeded-workspace": { expected: ["recent-threads"], default: true },
    "minimax-live": { live: true, expected: ["minimax-result"] }
  };

  it("classifies captured/new/orphan and excludes live scenarios", () => {
    const manifest = {
      scenarios: ["core-ui", "minimax-live"],
      screenshots: [
        { scenario: "core-ui", label: "first-run", path: "output/x/01-first-run.png" },
        { scenario: "core-ui", label: "model-menu", path: "output/x/02-model-menu.png" },
        { scenario: "minimax-live", label: "minimax-result", path: "output/x/03.png" }
      ]
    };
    const baselineLabels = {
      "core-ui": ["first-run", "stale-label"],
      "seeded-workspace": ["recent-threads"]
    };
    const { entries, notCovered } = classifyShots({ manifest, scenarios, baselineLabels });
    expect(entries).toEqual([
      {
        scenario: "core-ui",
        label: "first-run",
        path: "output/x/01-first-run.png",
        status: "pending-diff"
      },
      {
        scenario: "core-ui",
        label: "model-menu",
        path: "output/x/02-model-menu.png",
        status: "new"
      },
      { scenario: "core-ui", label: "stale-label", status: "orphan" }
    ]);
    expect(notCovered).toEqual(["seeded-workspace"]); // 本次未跑 ≠ 孤儿
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @marginalia/desktop test -- compare-screenshots`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现纯函数部分**（`compare-screenshots.mjs` 骨架；runner 在 Task 7/8 补）

```js
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

// ≤0.05% 像素差 = 抗锯齿噪声层，视为 unchanged（spec：初始值，可调）
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
      else options.maxDiffPercent = Number(value);
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
    const shots = manifest.screenshots.filter((shot) => shot.scenario === id);
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @marginalia/desktop test -- compare-screenshots`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/scripts/compare-screenshots.mjs apps/desktop/scripts/compare-screenshots.test.ts
git commit -m "feat(desktop): compare-screenshots arg parsing + shot classification"
```

---

### Task 7: 回归模式 runner（diff、报告、基线更新、退出码）

**Files:**

- Modify: `apps/desktop/scripts/compare-screenshots.mjs`
- Test: `apps/desktop/scripts/compare-screenshots.test.ts`

- [ ] **Step 1: 写失败测试**（报告与摘要为纯函数可测；追加）

```ts
// import 行追加 buildSummaryLine, resolveExitCode
describe("report + exit semantics", () => {
  it("formats the summary line in fixed key order", () => {
    expect(buildSummaryLine({ changed: 3, new: 1, unchanged: 21, orphan: 0, errors: 0 })).toBe(
      "changed=3 new=1 unchanged=21 orphan=0 errors=0"
    );
  });

  it("exits 0 on diffs by default, non-zero only for errors or explicit gates", () => {
    const counts = { changed: 5, new: 2, unchanged: 0, orphan: 1, errors: 0 };
    expect(resolveExitCode(counts, { failOnDiff: false, maxDiffPercent: null }, 0.02)).toBe(0);
    expect(resolveExitCode(counts, { failOnDiff: true, maxDiffPercent: null }, 0.02)).toBe(1);
    expect(resolveExitCode(counts, { failOnDiff: false, maxDiffPercent: 1 }, 2)).toBe(1);
    expect(
      resolveExitCode(
        { ...counts, changed: 0, errors: 1 },
        { failOnDiff: false, maxDiffPercent: null },
        0
      )
    ).toBe(1);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @marginalia/desktop test -- compare-screenshots`
Expected: FAIL。

- [ ] **Step 3: 实现 runner 与导出**（追加到 `compare-screenshots.mjs`）

```js
export function buildSummaryLine(counts) {
  return `changed=${counts.changed} new=${counts.new} unchanged=${counts.unchanged} orphan=${counts.orphan} errors=${counts.errors}`;
}

// maxChangedRatio: 本次所有 changed 截图里最大的 diffRatio（百分比，0-100 量纲见调用处）
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

// selector: "scenario" 同步整个场景（复制全部本次截图 + 删除孤儿基线）；
// "scenario/label" 只更新单张。
async function applyBaselineUpdates(options, manifest, shots) {
  for (const selector of options.updateBaseline) {
    const [scenario, label] = selector.split("/");
    if (!SCENARIOS[scenario] || SCENARIOS[scenario].live) {
      throw new Error(`cannot bless baseline for unknown/live scenario: ${selector}`);
    }
    const candidates = manifest.screenshots.filter(
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
    (a, b) => order[a.status] - order[b.status] || a.scenario.localeCompare(b.scenario)
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
```

文件末尾加 main 入口（与 verify-screenshots.mjs 同模式）：

```js
async function main() {
  const options = parseCompareArgs(process.argv.slice(2));
  if (options.mode === "design") return runDesignCompare(options); // Task 8 实现
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
```

（Task 8 前先放一个 `async function runDesignCompare() { throw new Error("design mode not implemented yet"); }` 占位以保证文件可加载——Task 8 必须替换它。）

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @marginalia/desktop test -- compare-screenshots`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/scripts/compare-screenshots.mjs apps/desktop/scripts/compare-screenshots.test.ts
git commit -m "feat(desktop): regression compare runner with report + baseline bless"
```

---

### Task 8: 设计稿模式（PNG / HTML / URL → 三联图）

**Files:**

- Modify: `apps/desktop/scripts/compare-screenshots.mjs`（替换 `runDesignCompare` 占位）
- Test: `apps/desktop/scripts/compare-screenshots.test.ts`

- [ ] **Step 1: 写失败测试**（输入类型判定为纯函数可测；追加）

```ts
// import 行追加 designSourceKind
describe("designSourceKind", () => {
  it("recognizes png, html and url design inputs", () => {
    expect(designSourceKind("docs/mock.png")).toBe("png");
    expect(designSourceKind("docs/proto.html")).toBe("html");
    expect(designSourceKind("http://127.0.0.1:5173/proto")).toBe("url");
    expect(designSourceKind("https://example.test/proto")).toBe("url");
    expect(() => designSourceKind("docs/proto.jsx")).toThrow(/pre-render JSX/);
    expect(() => designSourceKind("docs/spec.md")).toThrow(/Unsupported design input/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @marginalia/desktop test -- compare-screenshots`
Expected: FAIL。

- [ ] **Step 3: 实现**（追加/替换）

```js
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

// --impl 接受 "scenario/label"（查 manifest）或直接 png 路径
async function resolveImplPng(impl) {
  if (impl.endsWith(".png")) {
    return { buffer: await readFile(path.resolve(repoRoot, impl)), source: impl };
  }
  const [scenario, label] = impl.split("/");
  const manifest = JSON.parse(await readFile(path.join(shotsRoot, "manifest.json"), "utf8"));
  const shot = manifest.screenshots.find((s) => s.scenario === scenario && s.label === label);
  if (!shot)
    throw new Error(`no captured shot matches --impl ${impl}; run verify:screenshots first`);
  return { buffer: await readFile(path.join(repoRoot, shot.path)), source: shot.path };
}

async function renderDesignToPng(design, { width, height }) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ args: ["--force-device-scale-factor=1"] });
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    const kind = designSourceKind(design);
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
      : await renderDesignToPng(options.design, implSize);

  // PNG 设计稿尺寸必须与实现一致（diffPngBuffers 内部硬错误兜底，这里提前给出可行动的提示）
  const designSize = readPngSize(designBuffer);
  if (designSize.width !== implSize.width || designSize.height !== implSize.height) {
    throw new Error(
      `design size ${designSize.width}x${designSize.height} != impl ${implSize.width}x${implSize.height}; ` +
        "export the design at the implementation's size (window is 1280x800 css px)"
    );
  }

  const result = diffPngBuffers(designBuffer, impl.buffer);
  const slugName = options.impl.replace(/[^a-z0-9_-]+/gi, "-");
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
  // 趋势信号，不门控（spec）：达标与否由读图者按布局/间距/颜色 token 裁决
  console.log(`design-diff: ${report.diffPercent.toFixed(3)}% (trend signal, not a gate)`);
  console.log(`triptych: ${report.triptych}`);
  return 0;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm --filter @marginalia/desktop test -- compare-screenshots`
Expected: PASS。

- [ ] **Step 5: 端到端冒烟（手动一次）** —— 用上一次 capture 的产物自比 + PNG 自比：

```bash
node apps/desktop/scripts/compare-screenshots.mjs --design output/desktop-screenshots/core-ui/01-first-run.png --impl core-ui/first-run
```

Expected: `design-diff: 0.000% (trend signal, not a gate)`，三联图生成于 `output/visual-diff/design/`。

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/scripts/compare-screenshots.mjs apps/desktop/scripts/compare-screenshots.test.ts
git commit -m "feat(desktop): design-vs-impl compare with triptych output"
```

---

### Task 9: npm 脚本接线 + 初始基线入库

**Files:**

- Modify: `apps/desktop/package.json`、root `package.json`
- Create: `apps/desktop/screenshots-baseline/**/*.png`（25 张）

- [ ] **Step 1: 加脚本** —— `apps/desktop/package.json` scripts 追加：

```json
"compare:screenshots": "node scripts/compare-screenshots.mjs",
"compare:design": "node scripts/compare-screenshots.mjs --design",
"verify:visual": "node scripts/verify-screenshots.mjs && node scripts/compare-screenshots.mjs"
```

root `package.json` scripts 追加：

```json
"verify:visual": "pnpm --filter @marginalia/desktop verify:visual"
```

- [ ] **Step 2: 生成并审查初始基线**

```bash
pnpm verify:screenshots
node apps/desktop/scripts/compare-screenshots.mjs --update-baseline core-ui seeded-workspace --reason "initial baselines from current branch state"
node apps/desktop/scripts/compare-screenshots.mjs
```

Expected: 第二条输出 `[baseline] updated ...` 两行；第三条输出 `changed=0 new=0 unchanged=25 orphan=0 errors=0`、退出码 0。**逐张目检 `apps/desktop/screenshots-baseline/` 的 25 张图**确认状态正确后再入库。

- [ ] **Step 3: 验证退出码语义**

```bash
node apps/desktop/scripts/compare-screenshots.mjs --fail-on-diff; echo "exit=$?"
```

Expected: `exit=0`（当前无 changed）。

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/package.json package.json apps/desktop/screenshots-baseline
git commit -m "feat(desktop): wire verify:visual scripts + commit initial baselines"
```

---

### Task 10: skills（design-loop 新建 + verify 更新）

**Files:**

- Create: `.claude/skills/design-loop/SKILL.md`
- Modify: `.claude/skills/verify/SKILL.md`（第 4 步）

- [ ] **Step 1: 写 `design-loop/SKILL.md`**

```markdown
---
name: design-loop
description: Iterate a desktop UI implementation against a design artifact (PNG / HTML prototype) using Electron screenshots and triptych diffs until the design is faithfully reproduced. Use when implementing from a spec/design mockup or when asked to pixel-match a design.
---

# Design loop (marginalia)

Iterate implementation → screenshot → compare → judge → fix until the UI matches the design artifact.

## Inputs

- Design artifact: `.png` (must be 1280×800 css px), `.html`, or an http(s) URL. JSX prototypes must be pre-rendered to HTML/PNG first — the compare tool does not infer frameworks.
- The implementation state must be reachable in a screenshot scenario, or capture it ad hoc with `pnpm verify:screenshots:shot`.

## Loop

1. Implement (or adjust) the UI.
2. Capture: `pnpm verify:screenshots -s <scenario>` (or `pnpm verify:screenshots:shot` for states not in a fixture yet).
3. Compare: `pnpm --filter @marginalia/desktop compare:design <design-path> --impl <scenario/label | png-path>`.
4. Read the triptych (`output/visual-diff/design/*.triptych.png`) and judge by layout, spacing and color tokens. The diff percent is a **trend signal only** (lower than last round = converging) — cross-renderer font rasterization makes sub-pixel text noise unavoidable; never chase it.
5. Mismatch → go to 1. Match → continue.
6. If this is a new UI state, extend the relevant scenario in `apps/desktop/scripts/verify-screenshots.mjs` (per CLAUDE.md), re-capture, then bless the baseline:
   `pnpm --filter @marginalia/desktop compare:screenshots --update-baseline <scenario/label> --reason "<why>"`.
7. Finish with the `verify` skill (typecheck / test / lint / i18n / regression compare).

## Judging rules

- Judge layout structure, spacing rhythm, typography hierarchy and design tokens (`text-muted`, `border-soft`, `brand`, …) — not anti-aliased text pixels.
- For each `changed` regression shot you must classify: intentional change (bless with `--reason`) / unintended regression (fix) / unsure (do **not** bless; report to the user).
```

- [ ] **Step 2: 更新 `verify/SKILL.md` 第 4 步** —— 替换为：

````markdown
4. **UI changes → Electron screenshots + visual regression**: if anything user-visible in
   `apps/desktop` changed, run the visual gate:
   ```bash
   pnpm verify:visual
   ```
   This captures the default scenarios in real Electron and diffs them against
   `apps/desktop/screenshots-baseline/`. The compare step prints
   `changed=N new=N unchanged=N orphan=N errors=N` and writes `output/visual-diff/report.md`.
   For every `changed` shot, read the diff image and classify: intentional (bless via
   `pnpm --filter @marginalia/desktop compare:screenshots --update-baseline <scenario/label> --reason "<why>"`),
   unintended regression (fix it), or unsure (do not bless — surface to the user).
   `new` shots from added fixtures must be blessed; `orphan` baselines must be pruned via a
   whole-scenario bless. Opening the Vite page in a plain browser does **not** satisfy the gate.
   For i18n-affecting changes capture both English and 中文 states.
````

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/design-loop/SKILL.md .claude/skills/verify/SKILL.md
git commit -m "chore: add design-loop skill and fold visual regression into verify gate"
```

---

### Task 11: 文档与 commit gate

**Files:**

- Modify: `docs/developer/development.md`（新章节）
- Modify: `CLAUDE.md`（commit gate 第 5 条）

- [ ] **Step 1: `development.md` 追加「Visual regression & design diff」章节**，内容必须覆盖：

- 命令表：`pnpm verify:visual`（capture + 回归比对）、`pnpm --filter @marginalia/desktop compare:screenshots`（只比不拍）、`compare:design <path> --impl <scenario/label|png>`、`--update-baseline <selector> --reason "<why>"`、`--fail-on-diff` / `--max-diff-percent <n>`（CI 用，默认软报告）。
- 基线纪律：基线在 `apps/desktop/screenshots-baseline/`，只能显式 bless 且必附理由；`minimax-live` 与 adhoc 不进基线；不确定的 changed 不 bless。
- 设计稿输入类型：PNG（须 1280×800）、独立 HTML、http(s) URL；JSX 须先预渲染；diff 百分比是趋势信号不是门控。
- 输出位置：`output/visual-diff/report.{json,md}`、`output/visual-diff/design/*.triptych.png`（均不入库）。
- 确定性机制一句话说明：截图模式冻结渲染端时钟、隐藏 caret、fonts.ready + 连拍稳定重试。

- [ ] **Step 2: `CLAUDE.md` commit gate 第 5 条** —— 在现有第 5 条末尾追加一句：

```markdown
Run the visual gate via `pnpm verify:visual`; every `changed` shot in the regression
report must be explicitly judged (bless with `--update-baseline … --reason` for intentional
changes, fix unintended ones) before committing.
```

并把第 5 条正文中的 `pnpm verify:screenshots` 措辞保留（adhoc/场景扩展规则不变）。

- [ ] **Step 3: Commit**

```bash
git add docs/developer/development.md CLAUDE.md
git commit -m "docs: document visual regression workflow and extend commit gate"
```

---

### Task 12: 全量收尾验证

- [ ] **Step 1: 全量 gate**

```bash
pnpm --filter @marginalia/desktop typecheck
pnpm --filter @marginalia/desktop test
pnpm lint
pnpm format:check
```

Expected: 全绿（format 脏了就 `pnpm format` 后重查）。

- [ ] **Step 2: 端到端验证视觉 gate 本身**

```bash
pnpm verify:visual
```

Expected: capture `status: passed` + `changed=0 new=0 unchanged=25 orphan=0 errors=0`、退出码 0。

- [ ] **Step 3: 阴性用例验证（确认回归真的能抓到）** —— 临时改一个可见样式（如把某个组件的 `text-muted` 改成 `text-red-500`），跑 `pnpm verify:visual`，确认对应截图变为 `changed` 且 diff 图标红了变更区域；**然后撤销改动**，再跑一遍回到全绿。这一步不产生 commit。

- [ ] **Step 4: 如有零散修正，最后一次 commit**

```bash
git add -A && git commit -m "polish(desktop): visual gate finishing touches"
```

---

## Self-Review 结果（已执行）

- **Spec 覆盖**：capture 加固（Task 4/5）、SCENARIOS 导出（3）、回归模式含 orphan/not-covered/退出码/摘要行/report（6/7）、设计稿三模式输入 + 三联图 + 趋势定位（8）、基线入库与 bless 纪律（9）、loop skill 与 verify gate（10）、文档（11）、TDD 全程、阴性用例（12.3）。无缺口。
- **占位符**：无 TBD/TODO；Task 7 的 `runDesignCompare` 占位在 Task 8 被明确替换。
- **类型一致性**：`diffPngBuffers`/`composeTriptych`/`readPngSize`/`parseCompareArgs`/`classifyShots`/`buildSummaryLine`/`resolveExitCode`/`designSourceKind` 名称在测试与实现间一致；`__MARGINALIA_FROZEN_NOW__` 全局名在 main.ts、relative-time.ts、测试三处一致。
