// TODO: 需要规范化项目截图验证所需要的脚本，现在太随意了，@scripts 和 @apps/desktop/scripts 都有一些脚本

// Alignment verification capture: seeds a workspace + sessions + messages via
// the live pi-server (reached from the renderer), then screenshots the new
// P0 features — RecentThreads on New thread, sidebar session timestamps,
// chat assistant·model label — in both locales.
import { _electron as electron } from "playwright";
import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const desktopRoot = path.resolve(__dirname, "..");
const outDir = path.join(repoRoot, "output/align-verify");
const VITE_URL = "http://127.0.0.1:5173";

function waitForUrl(url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      fetch(url)
        .then(() => resolve(true))
        .catch(() => {
          if (Date.now() - start > timeoutMs) reject(new Error("vite did not start"));
          else setTimeout(tick, 300);
        });
    };
    tick();
  });
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const shot = async (page, label) => {
    await page.screenshot({ path: path.join(outDir, `${label}.png`), fullPage: false });
    console.log(`  ✓ ${label}.png`);
  };

  const vite = spawn("pnpm", ["vite", "--host", "127.0.0.1"], {
    cwd: desktopRoot,
    stdio: ["ignore", "ignore", "ignore"]
  });
  await waitForUrl(VITE_URL);

  const appE = await electron.launch({
    args: [path.resolve(desktopRoot, "dist-electron/main.js")],
    cwd: repoRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: VITE_URL }
  });
  const page = await appE.firstWindow();
  page.on("console", (m) => m.type() === "error" && console.log("  [renderer]", m.text()));
  await page.waitForLoadState("domcontentloaded");
  try {
    await page.getByRole("main").waitFor({ timeout: 15000 });
  } catch {
    console.log("  main never mounted — aborting");
  }

  // Seed data through the live pi-server (reached from the renderer context).
  const seed = await page.evaluate(async (rootDir) => {
    const status = await window.marginalia.getPiServerStatus();
    if (status.status !== "ready") return { ok: false, reason: status.status };
    const base = status.url;
    const j = (r) => r.json();
    const ws = await fetch(`${base}/workspaces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "align-verify", rootDir })
    }).then(j);
    const titles = ["设计三栏布局", "评审 pi-server spec", "梳理 i18n 字典结构"];
    const sessions = [];
    for (const title of titles) {
      const s = await fetch(`${base}/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workspaceId: ws.id, title })
      }).then(j);
      await fetch(`${base}/sessions/${s.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "gpt-5.1" })
      });
      sessions.push(s);
    }
    // give the first session a couple of messages so chat renders
    const first = sessions[0];
    await fetch(`${base}/sessions/${first.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "user", content: "帮我把 PR 排期重写为按周分块的清单。" })
    });
    await fetch(`${base}/sessions/${first.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        role: "assistant",
        content: "已按周拆好。整体保持 5 个 PR 的节奏，每个 PR 内部按准备/实现/收尾三步组织。"
      })
    });
    return { ok: true, workspaceId: ws.id, firstSessionId: first.id };
  }, repoRoot);

  console.log("  seed:", JSON.stringify(seed));
  if (!seed.ok) {
    console.log("  seeding failed — capturing whatever is visible");
  }

  // Reload so hooks pick up the seeded workspace/sessions.
  await page.reload();
  await page.getByRole("main").waitFor({ timeout: 15000 });
  await page.waitForTimeout(1200);

  // 01 — New thread with RecentThreads (EN default)
  await shot(page, "01-newthread-recent-threads");

  // 02 — Expand the workspace in the sidebar to show session timestamps + guide line
  const folder = page.locator("aside[aria-label='Sidebar'] button", { hasText: "align-verify" });
  if ((await folder.count()) > 0) {
    await folder
      .first()
      .click()
      .catch(() => {});
    await page.waitForTimeout(500);
    await shot(page, "02-sidebar-session-timestamps");
  }

  // 03 — Open the first session → chat with assistant·model label
  const sess = page.locator("aside[aria-label='Sidebar'] button", { hasText: "设计三栏布局" });
  if ((await sess.count()) > 0) {
    await sess
      .first()
      .click()
      .catch(() => {});
    await page.waitForTimeout(900);
    await shot(page, "03-chat-assistant-model-label");
  }

  await appE.close();
  vite.kill("SIGTERM");
  console.log("\ndone — screenshots in output/align-verify/");
}

main().catch((err) => {
  console.error("capture failed:", err);
  process.exit(1);
});
