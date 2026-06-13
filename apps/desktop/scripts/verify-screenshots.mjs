#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(desktopRoot, "../..");
const outRoot = path.join(repoRoot, "output/desktop-screenshots");
const runRoot = path.join(outRoot, ".run");

// Single source of truth per scenario: metadata, default-gate membership,
// the expected screenshot labels (the capture contract) and the runner.
const SCENARIOS = {
  "core-ui": {
    description: "First-run, new thread, composer controls, settings, locale and sidebar.",
    default: true,
    expected: [
      "first-run",
      "new-thread-empty",
      "model-menu",
      "new-thread-typed",
      "settings-general",
      "settings-providers",
      "provider-preset-picker",
      "provider-add-form",
      "provider-toast",
      "settings-providers-connected",
      "provider-edit-dialog",
      "settings-providers-disabled",
      "provider-delete-confirm",
      "settings-general-zh",
      "home-connected",
      "model-dropdown",
      "permission-menu",
      "sidebar-collapsed"
    ],
    run: scenarioCoreUi
  },
  "seeded-workspace": {
    description:
      "Seeded workspace/session UI, sidebar sessions, chat, attachment and mention flows.",
    default: true,
    expected: [
      "recent-threads",
      "sidebar-session-timestamps",
      "sidebar-show-more-expanded",
      "chat-seeded-session",
      "attach-picker",
      "attachment-card",
      "mention-menu",
      "mention-inline-token"
    ],
    run: scenarioSeededWorkspace
  },
  "minimax-live": {
    live: true,
    description: "Opt-in real MiniMax run with prompt, streaming and final result screenshots.",
    expected: ["prompt-typed", "streaming-early", "minimax-result"],
    run: scenarioMinimaxLive
  }
};

const DEFAULT_SCENARIOS = Object.entries(SCENARIOS)
  .filter(([, scenario]) => scenario.default)
  .map(([id]) => id);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function parseArgs(argv) {
  const selected = [];
  let list = false;
  let clean = true;
  let adhoc = false;
  let shotName = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      continue;
    } else if (arg === "--list") {
      list = true;
    } else if (arg === "--no-clean") {
      clean = false;
    } else if (arg === "--shot" || arg.startsWith("--shot=")) {
      adhoc = true;
      if (arg.startsWith("--shot=")) {
        shotName = arg.slice("--shot=".length) || null;
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith("-")) {
          shotName = next;
          i += 1;
        }
      }
    } else if (arg === "--scenario" || arg === "-s") {
      const value = argv[i + 1];
      if (!value) throw new Error(`${arg} requires a scenario id`);
      selected.push(value);
      i += 1;
    } else if (arg.startsWith("--scenario=")) {
      selected.push(arg.slice("--scenario=".length));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return {
    list,
    clean,
    adhoc,
    shotName,
    scenarios: selected.length > 0 ? [...new Set(selected)] : DEFAULT_SCENARIOS
  };
}

function printScenarios() {
  console.log("Screenshot verification scenarios:");
  for (const [id, scenario] of Object.entries(SCENARIOS)) {
    const kind = scenario.live ? "live" : "local";
    console.log(`- ${id} (${kind}): ${scenario.description}`);
  }
}

function slug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => {
        if (port) resolve(port);
        else reject(new Error("failed to allocate a local port"));
      });
    });
  });
}

function runCommand(label, cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    console.log(`[${label}] ${cmd} ${args.join(" ")}`);
    const child = spawn(cmd, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env
    });
    child.stdout.on("data", (chunk) => process.stdout.write(`[${label}] ${chunk}`));
    child.stderr.on("data", (chunk) => process.stderr.write(`[${label}] ${chunk}`));
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} exited with ${code ?? signal}`));
    });
  });
}

async function waitForUrl(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {
      // keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${url} did not become ready within ${timeoutMs}ms`);
}

async function stopProcess(proc, label) {
  if (!proc) return;
  let exited = proc.exitCode !== null || proc.signalCode !== null;
  if (exited) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (!exited) proc.kill("SIGKILL");
      resolve();
    }, 3000);
    proc.once("exit", () => {
      exited = true;
      clearTimeout(timer);
      resolve();
    });
    proc.kill("SIGTERM");
  }).catch((error) => {
    console.warn(`[${label}] failed to stop cleanly: ${error.message}`);
  });
}

async function apiJson(baseUrl, endpoint, init = {}) {
  const signal = init.signal ?? AbortSignal.timeout(15000);
  const response = await fetch(`${baseUrl}${endpoint}`, {
    ...init,
    signal,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {})
    }
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => response.statusText);
    throw new Error(`${endpoint}: ${response.status} ${detail}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function waitForMain(page) {
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("main").waitFor({ timeout: 30000 });
}

async function assertScreenshotMotionOff(page) {
  // Real Playwright pages poll; unit tests stub a bare { evaluate } page.
  if (typeof page.waitForFunction === "function") {
    await page.waitForFunction(() => document.documentElement.dataset.motion === "off", null, {
      timeout: 5000
    });
    return;
  }
  const motion = await page.evaluate(() => document.documentElement.dataset.motion);
  if (motion !== "off") {
    throw new Error(
      `expected <html data-motion="off"> during screenshot verification, got ${motion}`
    );
  }
}

async function waitForPiServerUrl(page) {
  const start = Date.now();
  while (Date.now() - start < 30000) {
    const status = await page.evaluate(() => window.marginalia?.getPiServerStatus?.());
    if (status?.status === "ready") return status.url;
    if (status?.status === "failed") {
      const logs = Array.isArray(status.logs) ? `\n${status.logs.join("\n")}` : "";
      throw new Error(`pi-server failed: ${status.error}${logs}`);
    }
    await page.waitForTimeout(250);
  }
  throw new Error("pi-server did not become ready");
}

async function startHarness() {
  await runCommand(
    "ensure:native",
    "pnpm",
    ["--filter", "@marginalia/pi-server", "run", "ensure:native"],
    repoRoot
  );
  // pi-server and electron builds are independent of each other (electron's main
  // only spawns pi-server at runtime, it doesn't import its build output).
  await Promise.all([
    runCommand("build:pi-server", "pnpm", ["--filter", "@marginalia/pi-server", "build"], repoRoot),
    runCommand("build:electron", "pnpm", ["exec", "tsc", "-p", "tsconfig.node.json"], desktopRoot)
  ]);

  let vite = null;
  let app = null;
  let apiBase;
  const vitePort = await getFreePort();
  const viteUrl = `http://127.0.0.1:${vitePort}`;
  try {
    vite = spawn(
      "pnpm",
      ["exec", "vite", "--host", "127.0.0.1", "--port", String(vitePort), "--strictPort"],
      {
        cwd: desktopRoot,
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    vite.stdout.on("data", (chunk) => process.stdout.write(`[vite] ${chunk}`));
    vite.stderr.on("data", (chunk) => process.stderr.write(`[vite] ${chunk}`));
    const viteExit = new Promise((_, reject) => {
      vite.once("exit", (code, signal) => reject(new Error(`vite exited with ${code ?? signal}`)));
    });
    viteExit.catch(() => {});
    await Promise.race([waitForUrl(viteUrl), viteExit]);

    const env = {
      ...process.env,
      VITE_DEV_SERVER_URL: viteUrl,
      MARGINALIA_DB_PATH: path.join(runRoot, "db.sqlite"),
      MARGINALIA_SCREENSHOT_VERIFY: "1",
      MARGINALIA_USER_DATA_DIR: path.join(runRoot, "user-data"),
      HOME: path.join(runRoot, "home")
    };
    await mkdir(env.HOME, { recursive: true });
    await mkdir(env.MARGINALIA_USER_DATA_DIR, { recursive: true });

    app = await electron.launch({
      args: [path.join(desktopRoot, "dist-electron/main.js")],
      cwd: repoRoot,
      env
    });
    const page = await app.firstWindow();
    page.on("console", (message) => {
      if (message.type() === "error") console.log(`[renderer:error] ${message.text()}`);
    });
    page.on("pageerror", (error) => console.log(`[renderer:pageerror] ${error.message}`));
    await page.waitForLoadState("domcontentloaded");
    await assertScreenshotMotionOff(page);
    apiBase = await waitForPiServerUrl(page);
    await waitForMain(page);
    return { app, page, vite, viteUrl, apiBase };
  } catch (error) {
    await mkdir(outRoot, { recursive: true });
    const page = app ? await app.firstWindow().catch(() => null) : null;
    await page?.screenshot({ path: path.join(outRoot, "startup-failure.png") }).catch(() => {});
    if (app) await app.close().catch(() => {});
    if (vite) await stopProcess(vite, "vite");
    throw error;
  }
}

async function capture(ctx, scenarioId, label) {
  await assertScreenshotMotionOff(ctx.page);
  const scenarioDir = path.join(outRoot, scenarioId);
  await mkdir(scenarioDir, { recursive: true });
  const next = (ctx.captureCounts.get(scenarioId) ?? 0) + 1;
  ctx.captureCounts.set(scenarioId, next);
  const file = path.join(scenarioDir, `${String(next).padStart(2, "0")}-${slug(label)}.png`);
  await ctx.page.screenshot({ path: file, fullPage: false, scale: "css" });
  const relative = path.relative(repoRoot, file);
  ctx.manifest.screenshots.push({ scenario: scenarioId, label, path: relative });
  console.log(`[shot] ${relative}`);
}

async function ensureSidebarOpen(page) {
  // The sidebar stays mounted when collapsed (width animates to 0 + hidden).
  const sidebar = page.locator("aside[aria-label='Sidebar']");
  if (await sidebar.isVisible()) return;
  await page
    .getByRole("button", { name: /toggle left sidebar|切换左侧边栏/i })
    .first()
    .click({ timeout: 5000 });
  await sidebar.waitFor({ state: "visible", timeout: 5000 });
}

async function goNewChat(page) {
  await ensureSidebarOpen(page);
  await page
    .getByRole("button", { name: /new chat|新建聊天|新对话/i })
    .first()
    .click({ timeout: 5000 });
  await page
    .getByRole("textbox", { name: /message|消息/i })
    .first()
    .waitFor({ timeout: 10000 });
}

async function waitForDocumentPanelReady(page) {
  await page.locator("aside[aria-label='Document panel']").waitFor({ timeout: 10000 });
  await page.waitForFunction(
    () => {
      const panel = document.querySelector("aside[aria-label='Document panel']");
      const text = panel?.textContent ?? "";
      const hasNonZeroFileCount = /[1-9]\d*\s+files\b/.test(text) || /[1-9]\d*\s*个文件/.test(text);
      return hasNonZeroFileCount && !/Loading|加载中/.test(text);
    },
    null,
    { timeout: 15000 }
  );
}

function fileMenuOption(page, name) {
  return page.locator("div.absolute.bottom-full button", { hasText: name }).first();
}

async function resetUiState(page) {
  await page.evaluate(() => {
    const raw = window.localStorage.getItem("marginalia-app");
    if (!raw) return;
    const parsed = JSON.parse(raw);
    parsed.state = {
      ...parsed.state,
      view: "new-thread",
      locale: "en",
      leftSidebarCollapsed: false,
      rightPanelCollapsed: false,
      contextFiles: [],
      permission: "full",
      reasoning: "medium"
    };
    window.localStorage.setItem("marginalia-app", JSON.stringify(parsed));
  });
}

async function reloadApp(page) {
  await page.reload();
  await waitForMain(page);
}

async function ensureSeededWorkspace(ctx) {
  if (ctx.seed) return ctx.seed;

  const workspace = await apiJson(ctx.apiBase, "/workspaces", {
    method: "POST",
    body: JSON.stringify({ name: "screenshot-fixture", rootDir: repoRoot })
  });
  await apiJson(ctx.apiBase, `/workspaces/${workspace.id}/open`, { method: "PATCH" });

  // Seven sessions so the sidebar's five-row fold ("Show more") is exercised.
  const titles = [
    "Design review thread",
    "pi-server spec review",
    "i18n dictionary cleanup",
    "Screenshot harness notes",
    "Provider onboarding copy",
    "Release checklist draft",
    "Composer focus styles"
  ];
  const sessions = [];
  for (const title of titles) {
    const session = await apiJson(ctx.apiBase, "/sessions", {
      method: "POST",
      body: JSON.stringify({ workspaceId: workspace.id, title })
    });
    await apiJson(ctx.apiBase, `/sessions/${session.id}`, {
      method: "PATCH",
      body: JSON.stringify({ model: "visual-fixture" })
    });
    sessions.push(session);
  }

  const first = sessions[0];
  await apiJson(ctx.apiBase, `/sessions/${first.id}/messages`, {
    method: "POST",
    body: JSON.stringify({
      role: "user",
      content: "Rewrite the PR schedule as a weekly checklist."
    })
  });
  await apiJson(ctx.apiBase, `/sessions/${first.id}/messages`, {
    method: "POST",
    body: JSON.stringify({
      role: "assistant",
      content:
        "The schedule is grouped by week with implementation, verification and release notes separated."
    })
  });

  ctx.seed = { workspace, sessions };
  return ctx.seed;
}

async function scenarioCoreUi(ctx) {
  await ctx.page
    .getByText(/welcome to pi-cowork/i)
    .first()
    .waitFor({ timeout: 10000 });
  await capture(ctx, "core-ui", "first-run");

  await ensureSeededWorkspace(ctx);
  await reloadApp(ctx.page);
  await ctx.page
    .getByText(/what should we build/i)
    .first()
    .waitFor({ timeout: 10000 });
  await capture(ctx, "core-ui", "new-thread-empty");

  await ctx.page
    .getByRole("button", { name: /select model/i })
    .first()
    .click({ timeout: 5000 });
  await ctx.page.getByText("Reasoning").first().waitFor({ timeout: 5000 });
  await ctx.page
    .getByText(/no providers configured/i)
    .first()
    .waitFor({ timeout: 5000 });
  await capture(ctx, "core-ui", "model-menu");
  await ctx.page.keyboard.press("Escape");

  const box = ctx.page.getByRole("textbox", { name: /message|消息/i }).first();
  await box.fill("Rewrite the PR schedule as a weekly checklist with verification commands.");
  await ctx.page.waitForFunction(
    () => document.querySelector("textarea")?.value.includes("weekly checklist"),
    null,
    { timeout: 5000 }
  );
  await capture(ctx, "core-ui", "new-thread-typed");

  await ctx.page
    .getByRole("button", { name: /^(settings|设置)$/i })
    .first()
    .click({ timeout: 5000 });
  await ctx.page
    .getByText(/locale, startup behavior/i)
    .first()
    .waitFor({ timeout: 5000 });
  await capture(ctx, "core-ui", "settings-general");

  await ctx.page
    .getByRole("button", { name: /providers|服务商/i })
    .first()
    .click({ timeout: 5000 });
  await ctx.page
    .getByText(/providers & models/i)
    .first()
    .waitFor({ timeout: 5000 });
  await capture(ctx, "core-ui", "settings-providers");

  await ctx.page
    .getByRole("button", { name: /add provider|添加服务商/i })
    .first()
    .click({ timeout: 5000 });
  await ctx.page
    .getByText(/choose a provider/i)
    .first()
    .waitFor({ timeout: 5000 });
  await capture(ctx, "core-ui", "provider-preset-picker");

  // Walk the whole add flow and the connected-row management UI so each new state
  // (quick-add form, connected row, edit, disabled, delete confirm) is captured.
  const addDialog = ctx.page.getByRole("dialog");
  await addDialog.getByText("OpenAI", { exact: true }).first().click({ timeout: 5000 });
  const apiKeyField = addDialog.getByLabel(/api key/i);
  await apiKeyField.waitFor({ timeout: 5000 });
  await capture(ctx, "core-ui", "provider-add-form");
  await apiKeyField.fill("sk-screenshot-fixture");
  await addDialog.getByRole("button", { name: /save|保存/i }).click({ timeout: 5000 });
  await ctx.page
    .getByText(/Provider added|服务商已添加/i)
    .first()
    .waitFor({ timeout: 5000 });
  await capture(ctx, "core-ui", "provider-toast");
  await ctx.page
    .getByText(/Provider added|服务商已添加/i)
    .first()
    .waitFor({ state: "detached", timeout: 5000 });

  const deleteButton = ctx.page.getByRole("button", { name: /^(delete|删除)$/i }).first();
  await deleteButton.waitFor({ timeout: 5000 });
  await capture(ctx, "core-ui", "settings-providers-connected");

  // Edit dialog: fields prefilled, API key blank with the keep-current hint.
  await ctx.page
    .getByRole("button", { name: /^(edit|编辑)$/i })
    .first()
    .click({ timeout: 5000 });
  await ctx.page
    .getByText(/edit provider|编辑服务商/i)
    .first()
    .waitFor({ timeout: 5000 });
  await capture(ctx, "core-ui", "provider-edit-dialog");
  await ctx.page.keyboard.press("Escape");

  // Disabled state: toggling the switch off greys the row and drops its runtime key.
  const enableToggle = ctx.page.getByRole("switch", { name: /openai/i }).first();
  await enableToggle.click({ timeout: 5000 });
  await ctx.page.waitForFunction(
    () => document.querySelector("[role='switch']")?.getAttribute("aria-checked") === "false",
    null,
    { timeout: 5000 }
  );
  await capture(ctx, "core-ui", "settings-providers-disabled");
  await enableToggle.click({ timeout: 5000 });
  await ctx.page.waitForFunction(
    () => document.querySelector("[role='switch']")?.getAttribute("aria-checked") === "true",
    null,
    { timeout: 5000 }
  );

  // Delete confirmation (cancelled afterwards so the fixture state is preserved).
  await deleteButton.click({ timeout: 5000 });
  await ctx.page.getByRole("alertdialog").waitFor({ timeout: 5000 });
  await capture(ctx, "core-ui", "provider-delete-confirm");
  await ctx.page.keyboard.press("Escape");

  await ctx.page
    .getByRole("button", { name: /general|通用/i })
    .first()
    .click({ timeout: 5000 });
  await ctx.page.getByRole("button", { name: "中文" }).first().click({ timeout: 5000 });
  await ctx.page.getByText("通用").first().waitFor({ timeout: 5000 });
  await capture(ctx, "core-ui", "settings-general-zh");
  await ctx.page.getByRole("button", { name: "English" }).first().click({ timeout: 5000 });
  await ctx.page.getByText("General").first().waitFor({ timeout: 5000 });

  await goNewChat(ctx.page);
  await ctx.page
    .getByRole("button", { name: /OpenAI.*gpt-5\.1.*Medium/i })
    .first()
    .waitFor({ timeout: 10000 });
  await capture(ctx, "core-ui", "home-connected");

  await ctx.page
    .getByRole("button", { name: /OpenAI.*gpt-5\.1.*Medium/i })
    .first()
    .click({ timeout: 5000 });
  await ctx.page.getByText("Reasoning").first().waitFor({ timeout: 5000 });
  await capture(ctx, "core-ui", "model-dropdown");
  await ctx.page.keyboard.press("Escape");

  await ctx.page
    .getByRole("button", { name: /tool permission|工具权限/i })
    .first()
    .click({ timeout: 5000 });
  await ctx.page.getByRole("menuitem", { name: /ask each time|每次询问/i }).waitFor({
    timeout: 5000
  });
  await capture(ctx, "core-ui", "permission-menu");
  await ctx.page.keyboard.press("Escape");

  await ctx.page
    .getByRole("button", { name: /toggle left sidebar|切换左侧边栏/i })
    .first()
    .click({ timeout: 5000 });
  await ctx.page.locator("aside[aria-label='Sidebar']").waitFor({ state: "hidden", timeout: 5000 });
  await capture(ctx, "core-ui", "sidebar-collapsed");
}

async function scenarioSeededWorkspace(ctx) {
  await ensureSeededWorkspace(ctx);
  await resetUiState(ctx.page);
  await reloadApp(ctx.page);
  await goNewChat(ctx.page);
  await ctx.page.getByText("Design review thread").first().waitFor({ timeout: 10000 });
  await capture(ctx, "seeded-workspace", "recent-threads");

  // Sessions are visible under the workspace by default (no expand click needed).
  await ctx.page
    .locator("aside[aria-label='Sidebar'] button", { hasText: "Design review thread" })
    .first()
    .waitFor({ timeout: 10000 });
  await capture(ctx, "seeded-workspace", "sidebar-session-timestamps");

  // The five-row fold: reveal the remaining sessions via Show more.
  await ctx.page
    .locator("aside[aria-label='Sidebar'] button", { hasText: /show more|显示更多/i })
    .first()
    .click({ timeout: 5000 });
  await ctx.page
    .locator("aside[aria-label='Sidebar'] button", { hasText: "Composer focus styles" })
    .first()
    .waitFor({ timeout: 10000 });
  await capture(ctx, "seeded-workspace", "sidebar-show-more-expanded");

  await ctx.page
    .locator("aside[aria-label='Sidebar'] button", { hasText: "Design review thread" })
    .first()
    .click({ timeout: 5000 });
  await ctx.page.getByText(/implementation, verification and release notes/i).waitFor({
    timeout: 10000
  });
  await waitForDocumentPanelReady(ctx.page);
  await capture(ctx, "seeded-workspace", "chat-seeded-session");

  await ctx.page
    .getByRole("button", { name: /add attachment|添加附件/i })
    .first()
    .click({ timeout: 5000 });
  await fileMenuOption(ctx.page, /package\.json/i).waitFor({ timeout: 5000 });
  await capture(ctx, "seeded-workspace", "attach-picker");

  await fileMenuOption(ctx.page, /package\.json/i).click({ timeout: 5000 });
  await ctx.page.getByRole("button", { name: /remove .*package\.json/i }).waitFor({
    timeout: 5000
  });
  await capture(ctx, "seeded-workspace", "attachment-card");
  await ctx.page
    .getByRole("button", { name: /remove|移除/i })
    .first()
    .click({ timeout: 5000 });

  const box = ctx.page.getByRole("textbox", { name: /message|消息/i }).first();
  await box.fill("@packa");
  await fileMenuOption(ctx.page, /package\.json/i).waitFor({ timeout: 5000 });
  await capture(ctx, "seeded-workspace", "mention-menu");
  await fileMenuOption(ctx.page, /package\.json/i).click({ timeout: 5000 });
  await ctx.page.waitForFunction(
    () => {
      const value = document.querySelector("textarea")?.value ?? "";
      return value.includes("@") && value.includes("package.json");
    },
    null,
    { timeout: 5000 }
  );
  await capture(ctx, "seeded-workspace", "mention-inline-token");
}

async function scenarioMinimaxLive(ctx) {
  await ensureSeededWorkspace(ctx);
  await apiJson(ctx.apiBase, "/providers", {
    method: "POST",
    body: JSON.stringify({
      name: "MiniMax",
      apiKey: process.env.MINIMAX_CN_API_KEY,
      baseUrl: process.env.MINIMAX_CN_BASE_URL || undefined,
      defaultModel: process.env.MINIMAX_CN_MODEL || "MiniMax-M2.7"
    })
  });

  await resetUiState(ctx.page);
  await reloadApp(ctx.page);
  await goNewChat(ctx.page);

  const box = ctx.page.getByRole("textbox", { name: /message|消息/i }).first();
  await box.fill("Read the root package.json and summarize this project in one Chinese sentence.");
  await ctx.page.waitForTimeout(250);
  await capture(ctx, "minimax-live", "prompt-typed");

  await ctx.page
    .getByRole("button", { name: /send|发送/i })
    .first()
    .click({ timeout: 5000 });
  await ctx.page.waitForTimeout(1500);
  await capture(ctx, "minimax-live", "streaming-early");

  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    await ctx.page.waitForTimeout(1500);
    if ((await ctx.page.getByText("run_failed").count()) > 0) {
      await capture(ctx, "minimax-live", "run-failed");
      throw new Error("minimax-live surfaced run_failed");
    }
    const stopVisible = (await ctx.page.getByRole("button", { name: /stop|停止/i }).count()) > 0;
    const assistantVisible =
      (await ctx.page
        .locator("main")
        .getByText(/assistant/i)
        .count()) > 0;
    if (assistantVisible && !stopVisible) {
      await ctx.page.waitForTimeout(1000);
      await capture(ctx, "minimax-live", "minimax-result");
      return;
    }
  }

  await capture(ctx, "minimax-live", "timeout-state");
  throw new Error("minimax-live timed out waiting for a completed assistant response");
}

async function validateScreenshotContract(manifest) {
  const errors = [];
  for (const scenario of manifest.scenarios) {
    const expected = SCENARIOS[scenario]?.expected ?? [];
    const actual = manifest.screenshots.filter((s) => s.scenario === scenario);
    const actualLabels = actual.map((s) => s.label);
    const missing = expected.filter((label) => !actualLabels.includes(label));
    const extra = actualLabels.filter((label) => !expected.includes(label));
    if (missing.length > 0) errors.push(`${scenario} missing screenshots: ${missing.join(", ")}`);
    if (extra.length > 0) errors.push(`${scenario} unexpected screenshots: ${extra.join(", ")}`);

    for (const shot of actual) {
      const file = path.join(repoRoot, shot.path);
      try {
        const buffer = await readFile(file);
        if (buffer.length <= PNG_SIGNATURE.length) {
          errors.push(`${shot.path} is empty or too small`);
        } else if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
          errors.push(`${shot.path} is not a PNG`);
        }
      } catch (error) {
        errors.push(`${shot.path} is unreadable: ${error.message}`);
      }
    }
  }
  if (errors.length > 0) throw new Error(`screenshot contract failed:\n- ${errors.join("\n- ")}`);
}

function validateScenarioRequirements(scenarios) {
  if (scenarios.includes("minimax-live") && !process.env.MINIMAX_CN_API_KEY) {
    throw new Error("MINIMAX_CN_API_KEY is required for minimax-live");
  }
}

async function writeSummary(manifest) {
  const lines = [
    "# Desktop Screenshot Verification",
    "",
    `- created: ${manifest.createdAt}`,
    `- status: ${manifest.status}`,
    `- scenarios: ${manifest.scenarios.join(", ")}`,
    ""
  ];

  for (const scenario of manifest.scenarios) {
    lines.push(`## ${scenario}`, "");
    const shots = manifest.screenshots.filter((s) => s.scenario === scenario);
    if (shots.length === 0) {
      lines.push("_No screenshots captured._", "");
      continue;
    }
    for (const shot of shots) {
      const relativeToSummary = path.relative(outRoot, path.join(repoRoot, shot.path));
      lines.push(`- ${shot.label}: ![${shot.label}](./${relativeToSummary})`);
    }
    lines.push("");
  }

  if (manifest.error) {
    lines.push("## Error", "", "```", manifest.error, "```", "");
  }

  await writeFile(path.join(outRoot, "summary.md"), lines.join("\n"));
  await writeFile(path.join(outRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

// Owns the harness lifecycle shared by every mode: clean the output tree (which
// also resets the isolated runRoot db/home/user-data), launch, hand a ready ctx to
// the mode, and always tear the app + vite down. `manifest` is only the capture
// sink threaded onto ctx for capture() to append to; reading it back (status,
// contract validation, summary) is entirely the caller's job.
async function withHarness({ clean, manifest }, run) {
  if (clean) await rm(outRoot, { recursive: true, force: true });
  await mkdir(runRoot, { recursive: true });
  let harness = null;
  try {
    harness = await startHarness();
    await run({ ...harness, manifest, captureCounts: new Map(), seed: null });
  } finally {
    if (harness?.app) await harness.app.close().catch(() => {});
    if (harness?.vite) await stopProcess(harness.vite, "vite");
  }
}

// Interactive capture loop: the developer drives the open Electron window to the
// UI they just built, then types a label to snap it. Empty line or "q" finishes.
async function runAdhocSession(ctx) {
  console.log(
    "\n[adhoc] Electron is open. Navigate to the screen you want, then type a label + Enter to capture it."
  );
  console.log("[adhoc] Press Enter on an empty line (or type 'q') to finish.\n");
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "[adhoc] label> "
  });
  // stdin can hit EOF (piped input) and auto-close the interface while a capture
  // is still in flight, so track that and never prompt() a closed readline.
  let closed = false;
  rl.on("close", () => {
    closed = true;
  });
  rl.prompt();
  // Async iteration pulls one line at a time, so each capture finishes before the
  // next label is read — no races between an in-flight screenshot and a quit/close.
  for await (const line of rl) {
    const label = line.trim();
    if (label === "" || label === "q") break;
    try {
      await capture(ctx, "adhoc", label);
    } catch (error) {
      console.error(`[adhoc] capture failed: ${error.message}`);
    }
    if (!closed) rl.prompt();
  }
  if (!closed) rl.close();
}

async function runAdhocMode(options) {
  let exitCode = 0;
  try {
    await withHarness({ clean: options.clean, manifest: { screenshots: [] } }, async (ctx) => {
      if (options.shotName) await capture(ctx, "adhoc", options.shotName);
      await runAdhocSession(ctx);
    });
  } catch (error) {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    exitCode = 1;
  }

  console.log(`screenshots: ${path.relative(repoRoot, path.join(outRoot, "adhoc"))}`);
  return exitCode;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.list) {
    printScenarios();
    return 0;
  }
  if (options.adhoc) {
    return runAdhocMode(options);
  }

  for (const scenario of options.scenarios) {
    if (!SCENARIOS[scenario]) throw new Error(`Unknown scenario: ${scenario}`);
  }
  validateScenarioRequirements(options.scenarios);

  const manifest = {
    createdAt: new Date().toISOString(),
    status: "running",
    scenarios: options.scenarios,
    screenshots: []
  };

  let exitCode = 0;
  try {
    await withHarness({ clean: options.clean, manifest }, async (ctx) => {
      for (const scenario of options.scenarios) {
        console.log(`[scenario] ${scenario}`);
        await SCENARIOS[scenario].run(ctx);
      }
      await validateScreenshotContract(manifest);
      manifest.status = "passed";
    });
  } catch (error) {
    manifest.status = "failed";
    manifest.error = error instanceof Error ? error.stack || error.message : String(error);
    console.error(manifest.error);
    exitCode = 1;
  }

  await writeSummary(manifest).catch((error) => {
    console.error(`failed to write summary: ${error.message}`);
    exitCode = 1;
  });

  console.log(`screenshots: ${path.relative(repoRoot, outRoot)}`);
  return exitCode;
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main()
    .then((code) => process.exit(code ?? 0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export { assertScreenshotMotionOff, parseArgs };
