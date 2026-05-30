// Real end-to-end test against the configured MiniMax provider.
// 1) screenshots FirstRunView (empty DB), 2) seeds a workspace via the live
// pi-server, 3) sends a real prompt and screenshots the streamed result.
import { _electron as electron } from "playwright";
import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const desktopRoot = path.resolve(__dirname, "..");
const outDir = path.join(repoRoot, "output/minimax-e2e");
const VITE_URL = "http://127.0.0.1:5173";

function waitForUrl(url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () =>
      fetch(url)
        .then(() => resolve(true))
        .catch(() =>
          Date.now() - start > timeoutMs ? reject(new Error("vite timeout")) : setTimeout(tick, 300)
        );
    tick();
  });
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const shot = async (page, label) => {
    await page.screenshot({ path: path.join(outDir, `${label}.png`) });
    console.log(`  ✓ ${label}.png`);
  };

  const vite = spawn("pnpm", ["vite", "--host", "127.0.0.1"], {
    cwd: desktopRoot,
    stdio: "ignore"
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
  await page
    .getByRole("main")
    .waitFor({ timeout: 15000 })
    .catch(() => {});
  await page.waitForTimeout(1500);

  // 01 — FirstRunView (no workspace yet)
  await shot(page, "01-first-run");

  // Seed a workspace pointing at the repo so the agent has files to read.
  const seed = await page.evaluate(async (rootDir) => {
    const status = await window.marginalia.getPiServerStatus();
    if (status.status !== "ready") return { ok: false };
    const ws = await fetch(`${status.url}/workspaces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "minimax-test", rootDir })
    }).then((r) => r.json());
    return { ok: true, workspaceId: ws.id };
  }, repoRoot);
  console.log("  seed:", JSON.stringify(seed));

  await page.reload();
  await page
    .getByRole("main")
    .waitFor({ timeout: 15000 })
    .catch(() => {});
  await page.waitForTimeout(1200);

  // Type a tool-triggering prompt and send.
  const box = page.getByRole("textbox", { name: /message|消息/i });
  await box.first().click();
  await box.first().fill("请阅读当前工作区根目录的 README.md，并用一句话总结它的内容。");
  await page.waitForTimeout(300);
  await shot(page, "02-prompt-typed");

  await page
    .getByRole("button", { name: /send|发送/i })
    .first()
    .click();
  console.log("  sent prompt, waiting for MiniMax response…");

  // Wait until the assistant produces text or an error row appears (max 90s).
  const deadline = Date.now() + 90_000;
  let done = false;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1500);
    const hasError = (await page.locator("text=run_failed").count()) > 0;
    const assistantText = await page
      .locator("main")
      .getByText(/MiniMax|README|总结|assistant/i)
      .count();
    if (hasError) {
      console.log("  run_failed surfaced");
      done = true;
      break;
    }
    // Heuristic: a tool card or a non-empty assistant bubble present
    const toolCards = await page.locator("main .dot").count();
    if (assistantText > 1 || toolCards > 0) {
      // give it a moment to stream more, then capture
      await page.waitForTimeout(4000);
      done = true;
      break;
    }
  }
  if (!done) console.log("  timed out waiting for response — capturing current state");
  await shot(page, "03-minimax-response");

  await appE.close();
  vite.kill("SIGTERM");
  console.log("\ndone — screenshots in output/minimax-e2e/");
}

main().catch((e) => {
  console.error("capture failed:", e);
  process.exit(1);
});
