// Electron screenshot verification for the chat bugfix pass (PR-1..PR-4c).
// Captures: @mention inline token vs + attachment card, attachment-only send,
// live streaming (stop button + 思考中 indicator + tool cards), and the same
// session reopened — so live vs reopen tool/bubble rendering can be compared.
import { _electron as electron } from "playwright";
import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../..");
const desktopRoot = path.resolve(__dirname, "..");
const outDir = path.join(repoRoot, "output/chat-verify");
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
  const step = async (label, fn) => {
    try {
      await fn();
    } catch (e) {
      console.log(`  ! ${label} failed: ${e.message}`);
    }
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

  // Ensure a repo-root workspace is active so @ search + tool reads have files.
  await step("seed workspace", async () => {
    await page.evaluate(async (rootDir) => {
      const status = await window.marginalia.getPiServerStatus();
      if (status.status !== "ready") return;
      const list = await fetch(`${status.url}/workspaces`).then((r) => r.json());
      if (!list.some((w) => w.rootDir === rootDir)) {
        await fetch(`${status.url}/workspaces`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "chat-verify", rootDir })
        });
      }
    }, repoRoot);
    await page.reload();
    await page
      .getByRole("main")
      .waitFor({ timeout: 15000 })
      .catch(() => {});
    await page.waitForTimeout(1000);
  });

  // Select the repo-root workspace from the left sidebar so @ search + reads have files.
  await step("select workspace", async () => {
    await page.getByText("align-verify", { exact: true }).first().click({ timeout: 5000 });
    await page.waitForTimeout(800);
  });

  const box = () => page.getByRole("textbox", { name: /message|消息/i }).first();

  await shot(page, "01-new-thread");

  // PR-1: @ mention → inline token, no attachment card.
  await step("mention", async () => {
    await box().click();
    await box().fill("@packa");
    await page.waitForTimeout(900);
    await shot(page, "02-mention-menu");
    const opt = page.getByText(/package\.json/i).first();
    await opt.click({ timeout: 4000 });
    await page.waitForTimeout(500);
    await shot(page, "03-mention-inline-token");
    await box().fill("");
    await page.waitForTimeout(300);
  });

  // PR-1: + attachment → attachment card; send enabled with no text.
  await step("attachment", async () => {
    await page
      .getByRole("button", { name: /add attachment|添加附件/i })
      .first()
      .click({ timeout: 4000 });
    await page.waitForTimeout(800);
    await shot(page, "04-attach-picker");
    await page
      .getByText(/package\.json/i)
      .first()
      .click({ timeout: 4000 });
    await page.waitForTimeout(600);
    await shot(page, "05-attachment-card-send-enabled");
    // remove the card so it doesn't ride along with the live prompt
    await page
      .getByRole("button", { name: /remove|移除|删除/i })
      .first()
      .click({ timeout: 3000 })
      .catch(() => {});
    await page.waitForTimeout(300);
  });

  // PR-4b/4c: live streaming with a tool read → stop button, 思考中, tool cards.
  await step("live prompt", async () => {
    await box().click();
    await box().fill(
      "请阅读当前工作区根目录的 package.json，并用一句话中文总结这个项目是做什么的。"
    );
    await page.waitForTimeout(300);
    await page
      .getByRole("button", { name: /send|发送/i })
      .first()
      .click({ timeout: 4000 });
    console.log("  sent live prompt, watching stream…");
    // Try to catch the early streaming state (stop button / thinking).
    await page.waitForTimeout(1500);
    await shot(page, "06-streaming-early");

    const deadline = Date.now() + 120_000;
    let captured = false;
    while (Date.now() < deadline) {
      await page.waitForTimeout(1500);
      const err = await page.locator("text=run_failed").count();
      const dots = await page.locator("main .dot").count();
      const thinking = await page.getByText(/思考中|thinking/i).count();
      if (thinking > 0) await shot(page, "07-thinking").catch(() => {});
      if (err > 0) {
        await shot(page, "08-run-failed");
        captured = true;
        break;
      }
      const stop = await page.getByRole("button", { name: /stop|停止/i }).count();
      // tool card present and streaming finished (send button back) → capture
      if (dots > 0 && stop === 0) {
        await page.waitForTimeout(1500);
        await shot(page, "08-live-tool-and-answer");
        captured = true;
        break;
      }
    }
    if (!captured) await shot(page, "08-live-timeout-state");
  });

  // PR-4b: reopen the same session and compare rendering with the live view.
  await step("reopen session", async () => {
    // Leave the session, then re-enter it from the sidebar so messages reload from the file.
    await page
      .getByRole("button", { name: /new chat|新对话|新建对话/i })
      .first()
      .click({ timeout: 4000 })
      .catch(() => {});
    await page.waitForTimeout(800);
    await shot(page, "09-new-chat");
    // The just-sent session shows in the sidebar titled by the prompt prefix.
    const session = page.getByText(/package\.json|README|总结|项目/i).first();
    if ((await session.count()) > 0) {
      await session.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(2000);
      await shot(page, "10-reopened-session");
    }
  });

  await appE.close();
  vite.kill("SIGTERM");
  console.log(`\ndone — screenshots in ${outDir}`);
}

main().catch((e) => {
  console.error("capture failed:", e);
  process.exit(1);
});
