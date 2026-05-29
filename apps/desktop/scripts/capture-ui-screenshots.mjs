import { _electron as electron } from "playwright";
import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const desktopRoot = path.resolve(__dirname, "..");
const outDir = path.join(repoRoot, "output/codex-ui-verification");
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

async function shot(page, label) {
  const file = path.join(outDir, `${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  saved ${path.relative(repoRoot, file)}`);
}

async function main() {
  await mkdir(outDir, { recursive: true });

  console.log("starting vite dev server…");
  const vite = spawn("pnpm", ["vite", "--host", "127.0.0.1"], {
    cwd: desktopRoot,
    stdio: ["ignore", "pipe", "pipe"]
  });
  vite.stdout.on("data", () => {});
  vite.stderr.on("data", () => {});
  await waitForUrl(VITE_URL);
  console.log("vite up at", VITE_URL);

  console.log("launching electron with VITE_DEV_SERVER_URL…");
  const app = await electron.launch({
    args: [path.resolve(desktopRoot, "dist-electron/main.js")],
    cwd: repoRoot,
    env: { ...process.env, VITE_DEV_SERVER_URL: VITE_URL }
  });
  const page = await app.firstWindow();

  page.on("console", (msg) => {
    if (msg.type() === "error") console.log("  [renderer error]", msg.text());
  });

  // Wait for either "Starting" / health-ok / failure to appear
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(3000);
  await shot(page, "01-initial");

  // Try to collapse left sidebar
  const collapse = page.getByRole("button", { name: /toggle left sidebar/i });
  if (await collapse.count()) {
    await collapse.first().click();
    await page.waitForTimeout(500);
    await shot(page, "02-sidebar-collapsed");
    await collapse.first().click();
    await page.waitForTimeout(500);
  } else {
    console.log("  no toggle left sidebar button found");
  }

  // Settings view
  const settings = page.getByRole("button", { name: /^(settings|设置)$/i });
  if (await settings.count()) {
    await settings.first().click();
    await page.waitForTimeout(400);
    await shot(page, "03-settings");
  }

  // Back to new chat
  const newChat = page.getByRole("button", { name: /new chat|新建聊天/i });
  if (await newChat.count()) {
    await newChat.first().click();
    await page.waitForTimeout(400);
    await shot(page, "04-new-thread");
  }

  // Switch language
  const lang = page.getByRole("button", { name: /中文|english/i });
  if (await lang.count()) {
    await lang.first().click();
    await page.waitForTimeout(400);
    await shot(page, "05-language-toggled");
  }

  await app.close();
  vite.kill("SIGTERM");
  console.log(`done. screenshots in: ${outDir}`);
}

main().catch((err) => {
  console.error("capture failed:", err);
  process.exit(1);
});
