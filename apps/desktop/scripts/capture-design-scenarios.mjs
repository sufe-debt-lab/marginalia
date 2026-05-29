// Scenario-by-scenario UI capture against the approved pi-cowork design.
// Launches Vite + Electron via Playwright, drives the real renderer, and shoots
// each design artboard scenario it can reach. Defensive: never throws on a
// missing element — logs and moves on so partial runs still produce evidence.
import { _electron as electron } from "playwright";
import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const desktopRoot = path.resolve(__dirname, "..");
const outDir = path.join(repoRoot, "output/design-scenarios");
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
  const shots = [];
  const shot = async (page, label) => {
    const file = path.join(outDir, `${label}.png`);
    await page.screenshot({ path: file, fullPage: false });
    shots.push(label);
    console.log(`  ✓ ${label}.png`);
  };
  const click = async (page, locator, label) => {
    try {
      if ((await locator.count()) > 0) {
        await locator.first().click({ timeout: 4000 });
        return true;
      }
      console.log(`  – skip ${label}: not found`);
    } catch (e) {
      console.log(`  – skip ${label}: ${e.message.split("\n")[0]}`);
    }
    return false;
  };

  console.log("starting vite…");
  const vite = spawn("pnpm", ["vite", "--host", "127.0.0.1"], {
    cwd: desktopRoot,
    stdio: ["ignore", "ignore", "ignore"]
  });
  await waitForUrl(VITE_URL);

  console.log("launching electron…");
  const appE = await electron.launch({
    args: [path.resolve(desktopRoot, "dist-electron/main.js")],
    cwd: repoRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: VITE_URL }
  });
  const page = await appE.firstWindow();
  page.on("console", (m) => m.type() === "error" && console.log("  [renderer]", m.text()));
  await page.waitForLoadState("domcontentloaded");

  // Wait for the shell (main) to mount past the "starting pi-server" splash.
  try {
    await page.getByRole("main").waitFor({ timeout: 15000 });
  } catch {
    console.log("  main never mounted (pi-server may have failed) — capturing splash");
  }
  await page.waitForTimeout(1500);

  // 01 — New thread (empty), English
  await shot(page, "01-new-thread-empty");

  // 02 — New thread with a typed draft
  const box = page.getByRole("textbox", { name: /message|消息/i });
  if ((await box.count()) > 0) {
    await box.first().click();
    await box
      .first()
      .fill(
        "Rewrite the PR schedule in docs/rewrite-plan.md as a weekly checklist with verification commands."
      );
    await page.waitForTimeout(300);
    await shot(page, "02-new-thread-typed");
  }

  // 03 — Composer model + reasoning menu
  if (await click(page, page.getByRole("button", { name: /·|select model/i }), "model menu")) {
    await page.waitForTimeout(300);
    await shot(page, "03-composer-model-reasoning-menu");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  }

  // 04 — Composer permission menu
  if (
    await click(
      page,
      page.getByRole("button", { name: /tool permission|工具权限/i }),
      "permission menu"
    )
  ) {
    await page.waitForTimeout(300);
    await shot(page, "04-composer-permission-menu");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  }

  // 05 — Settings · General
  if (await click(page, page.getByRole("button", { name: /^(settings|设置)$/i }), "settings")) {
    await page.waitForTimeout(400);
    await shot(page, "05-settings-general");

    // 06 — Settings · Providers
    if (
      await click(page, page.getByRole("button", { name: /providers|服务商/i }), "providers tab")
    ) {
      await page.waitForTimeout(400);
      await shot(page, "06-settings-providers");
    }

    // 07 — Locale switch to 中文 (General pane is the canonical switch now)
    await click(page, page.getByRole("button", { name: /providers|服务商/i }), "back? n/a");
    await click(page, page.getByRole("button", { name: /general|通用/i }), "general tab");
    await page.waitForTimeout(200);
    if (await click(page, page.getByRole("button", { name: "中文" }), "zh toggle")) {
      await page.waitForTimeout(400);
      await shot(page, "07-settings-general-zh");
    }
  }

  // Back to new chat (zh now) then collapse sidebar
  await click(page, page.getByRole("button", { name: /new chat|新建聊天/i }), "new chat");
  await page.waitForTimeout(300);
  if (
    await click(
      page,
      page.getByRole("button", { name: /toggle left sidebar|切换左侧边栏/i }),
      "collapse"
    )
  ) {
    await page.waitForTimeout(400);
    await shot(page, "08-sidebar-collapsed");
    await click(
      page,
      page.getByRole("button", { name: /toggle left sidebar|切换左侧边栏/i }),
      "expand"
    );
    await page.waitForTimeout(300);
  }

  // 09 — Best-effort chat + doc panel: open first workspace → first session.
  const wsButtons = page.locator("aside[aria-label='Sidebar'] button");
  try {
    // expand the first workspace tree row (folder button)
    const folders = page.locator("aside[aria-label='Sidebar'] button", { hasText: /.+/ });
    if ((await folders.count()) > 0) {
      // click rows until a session appears, then open it
      const count = await folders.count();
      for (let i = 0; i < count; i++) {
        await folders
          .nth(i)
          .click({ timeout: 2000 })
          .catch(() => {});
        await page.waitForTimeout(250);
        if ((await page.getByRole("main").locator("text=assistant").count()) > 0) break;
        if (
          (await page.getByRole("complementary", { name: /document panel|文档面板/i }).count()) > 0
        )
          break;
      }
    }
    await page.waitForTimeout(800);
    if ((await page.getByRole("complementary", { name: /document panel|文档面板/i }).count()) > 0) {
      await shot(page, "09-chat-with-doc-panel");
    } else {
      console.log("  – no chat session reachable (empty DB) — skipping chat/doc-panel shots");
    }
  } catch (e) {
    console.log("  – chat/doc-panel skipped:", e.message.split("\n")[0]);
  }
  void wsButtons;

  await appE.close();
  vite.kill("SIGTERM");
  console.log(`\ndone — ${shots.length} screenshots in output/design-scenarios/`);
}

main().catch((err) => {
  console.error("capture failed:", err);
  process.exit(1);
});
