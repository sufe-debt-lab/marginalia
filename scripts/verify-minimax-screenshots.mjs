#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const outDir = path.resolve(root, "output/verify-minimax");
await fs.mkdir(outDir, { recursive: true });

function spawnSilent(label, cmd, args, env) {
  const proc = spawn(cmd, args, {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...env }
  });
  proc.stdout.on("data", (chunk) => process.stdout.write(`[${label}] ${chunk}`));
  proc.stderr.on("data", (chunk) => process.stderr.write(`[${label}] ${chunk}`));
  return proc;
}

function awaitServerReady(proc) {
  return new Promise((resolve, reject) => {
    let buf = "";
    proc.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      for (const line of buf.split("\n")) {
        if (!line.trim().startsWith("{")) continue;
        try {
          const evt = JSON.parse(line.trim());
          if (evt.type === "ready" && typeof evt.port === "number") return resolve(evt.port);
        } catch {}
      }
    });
    proc.on("exit", (code) => reject(new Error(`pi-server exited (${code})`)));
    setTimeout(() => reject(new Error("pi-server timeout")), 30000);
  });
}

async function waitForUrl(url, ms = 30000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const r = await fetch(url);
      if (r.ok || r.status === 404) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`url ${url} did not become ready`);
}

let serverProc = null;
let viteProc = null;
let browser = null;
let exitCode = 0;

try {
  console.log("Starting pi-server...");
  serverProc = spawn("pnpm", ["--filter", "@marginalia/pi-server", "start"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"]
  });
  serverProc.stderr.on("data", (chunk) => process.stderr.write(`[pi-server stderr] ${chunk}`));
  const port = await awaitServerReady(serverProc);
  const apiBase = `http://127.0.0.1:${port}`;
  console.log("pi-server on", apiBase);

  // Verify provider/workspace exist.
  const providers = await fetch(`${apiBase}/providers`).then((r) => r.json());
  const minimax = providers.find((p) => /minimax/i.test(p.name));
  if (!minimax) throw new Error("Minimax provider missing in ~/.marginalia/db.sqlite");
  const workspaces = await fetch(`${apiBase}/workspaces`).then((r) => r.json());
  let workspace = workspaces[0];
  if (!workspace) {
    workspace = await fetch(`${apiBase}/workspaces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "verify-default", rootDir: outDir })
    }).then((r) => r.json());
  }
  // Mark workspace opened so /quick-chat succeeds.
  await fetch(`${apiBase}/workspaces/${workspace.id}/open`, { method: "PATCH" });
  console.log("workspace:", workspace.name, "provider:", minimax.name);

  console.log("Starting Vite dev server...");
  viteProc = spawnSilent("vite", "pnpm", ["--filter", "@marginalia/desktop", "exec", "vite", "--host", "127.0.0.1"]);
  await waitForUrl("http://127.0.0.1:5173");
  console.log("Vite ready");

  browser = await chromium.launch({ headless: true, args: ["--headless=new"] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.on("console", (msg) => console.log("[page]", msg.type(), msg.text()));

  page.on("requestfailed", (req) => console.log("[REQFAIL]", req.url(), req.failure()?.errorText));
  page.on("request", (req) => {
    if (req.url().includes("/runs")) console.log("[REQ]", req.method(), req.url(), req.postData()?.slice(0, 200));
  });
  page.on("response", (resp) => {
    const url = resp.url();
    if (url.includes("/runs") || url.includes("/messages") || url.includes("/providers")) {
      console.log("[RESP]", resp.status(), url);
    }
  });
  await page.goto(`http://127.0.0.1:5173/?serverUrl=${encodeURIComponent(apiBase)}`);
  await page.waitForLoadState("networkidle");

  async function shoot(label) {
    const file = path.join(outDir, `${label}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log("screenshot:", path.relative(root, file));
    return file;
  }

  // Wait for either the workspace shell or the failed screen.
  await page.waitForSelector("main", { timeout: 15000 });
  await page.waitForTimeout(500);
  await shoot("01-startup");

  // Open Quick chat to create a session and reach ChatView.
  const quickChat = page.getByRole("button", { name: /Quick chat/i });
  if (await quickChat.count()) {
    await quickChat.first().click();
    await page.waitForTimeout(800);
  }

  // Provider label only renders after a session is active (Quick chat creates one and mounts ChatView).
  await page.waitForSelector('select', { timeout: 15000 });
  await shoot("02-chat-empty");

  // Choose Minimax provider.
  const providerSelect = page.getByLabel("Provider");
  const options = providerSelect.locator("option");
  const optionCount = await options.count();
  let minimaxValue = null;
  for (let i = 0; i < optionCount; i++) {
    const txt = (await options.nth(i).textContent()) ?? "";
    if (/minimax/i.test(txt)) {
      minimaxValue = await options.nth(i).getAttribute("value");
      break;
    }
  }
  if (minimaxValue) await providerSelect.selectOption(minimaxValue);

  // Type and send first message. The ChatView's Message textarea is the only "Message" labeled
  // element; WorkspaceShell uses "Saved message" instead. Use exact match to avoid the Messages list.
  const message = page.getByLabel("Message", { exact: true });
  await message.fill("用一句话介绍你自己。");
  await shoot("03-typed");

  await page.getByRole("button", { name: "Send" }).first().click();
  // Snapshot DOM state right after click and again after a brief wait to diagnose hangs.
  await page.waitForTimeout(2000);
  const domDump = await page.evaluate(() => {
    const containers = Array.from(document.querySelectorAll('[aria-label="Messages"]'));
    return containers.map((c, i) => ({
      idx: i,
      html: c.outerHTML.slice(0, 600),
      assistantTexts: Array.from(c.querySelectorAll('[data-role="assistant"]')).map((p) => p.textContent)
    }));
  });
  console.log("[DOM after 2s]", JSON.stringify(domDump, null, 2));
  await shoot("04a-after-click");

  await page.waitForFunction(
    () => {
      const containers = Array.from(document.querySelectorAll('[aria-label="Messages"]'));
      return containers.some((c) =>
        Array.from(c.querySelectorAll('[data-role="assistant"]')).some(
          (p) => (p.textContent || "").trim().length > 0
        )
      );
    },
    null,
    { timeout: 120_000 }
  );
  await page.waitForTimeout(500);
  await shoot("04-first-reply");

  // Second turn for context continuity.
  await message.fill("再讲一个冷笑话。");
  await shoot("04b-second-typed");
  await page.getByRole("button", { name: "Send" }).first().click();
  await page.waitForTimeout(3000);
  const dump2 = await page.evaluate(() => {
    const containers = Array.from(document.querySelectorAll('[aria-label="Messages"]'));
    return containers.map((c, i) => ({
      idx: i,
      texts: Array.from(c.children).map((p) => ({ role: p.getAttribute("data-role"), text: p.textContent }))
    }));
  });
  console.log("[DOM after 2nd click +3s]", JSON.stringify(dump2, null, 2));
  await shoot("04c-after-second-click");
  await page.waitForFunction(
    () => {
      const containers = Array.from(document.querySelectorAll('[aria-label="Messages"]'));
      return containers.some(
        (c) =>
          Array.from(c.querySelectorAll('[data-role="assistant"]')).filter(
            (p) => (p.textContent || "").trim().length > 0
          ).length >= 2
      );
    },
    null,
    { timeout: 120_000 }
  );
  await page.waitForTimeout(500);
  await shoot("05-multi-turn");

  // Append screenshot section to summary md.
  const mdPath = path.join(outDir, "2026-05-26.md");
  if (await fs.stat(mdPath).then(() => true).catch(() => false)) {
    const md = await fs.readFile(mdPath, "utf-8");
    if (!md.includes("## Screenshots")) {
      const append =
        "\n## Screenshots\n\n" +
        ["01-startup", "02-chat-empty", "03-typed", "04-first-reply", "05-multi-turn"]
          .map((label) => `- ![${label}](./${label}.png)`)
          .join("\n") +
        "\n";
      await fs.writeFile(mdPath, md + append);
    }
  }

  console.log("verify-minimax-screenshots: OK");
} catch (error) {
  console.error("screenshots failed:", error);
  exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (viteProc) viteProc.kill();
  if (serverProc) serverProc.kill();
  process.exit(exitCode);
}
