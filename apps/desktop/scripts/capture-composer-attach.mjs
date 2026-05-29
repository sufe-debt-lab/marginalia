// Captures the Composer "+" attachment picker open on the New thread view.
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
  await page.waitForLoadState("domcontentloaded");
  await page
    .getByRole("main")
    .waitFor({ timeout: 15000 })
    .catch(() => {});
  await page.waitForTimeout(1200);

  const plus = page.getByRole("button", { name: /add attachment|添加附件/i });
  if ((await plus.count()) > 0) {
    await plus
      .first()
      .click({ timeout: 4000 })
      .catch(() => {});
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(outDir, "04-composer-attach-picker.png") });
    console.log("  ✓ 04-composer-attach-picker.png");
  } else {
    console.log("  – attach button not found");
  }

  await appE.close();
  vite.kill("SIGTERM");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
