import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function defaultExecutableCandidates() {
  const release = path.join(desktopRoot, "release");
  if (process.platform === "darwin") {
    return [
      path.join(release, "mac-arm64", "Marginalia.app", "Contents", "MacOS", "Marginalia"),
      path.join(release, "mac", "Marginalia.app", "Contents", "MacOS", "Marginalia")
    ];
  }
  if (process.platform === "win32") {
    return [path.join(release, "win-unpacked", "Marginalia.exe")];
  }
  return [path.join(release, "linux-unpacked", "marginalia")];
}

async function resolveExecutable() {
  const candidates = process.argv[2]
    ? [path.resolve(process.argv[2])]
    : defaultExecutableCandidates();
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next host-appropriate unpacked path.
    }
  }
  throw new Error(`packaged executable not found; checked: ${candidates.join(", ")}`);
}

const executablePath = await resolveExecutable();
const runRoot = await mkdtemp(path.join(os.tmpdir(), "marginalia-packaged-smoke-"));
let electronApp;

try {
  electronApp = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${path.join(runRoot, "user-data")}`],
    env: {
      ...process.env,
      MARGINALIA_DB_PATH: path.join(runRoot, "marginalia.sqlite"),
      MARGINALIA_PACKAGED_SMOKE: "1"
    }
  });
  const page = await electronApp.firstWindow();
  const result = await page.evaluate(async () => {
    function requestStatus(path) {
      return new Promise((resolve, reject) => {
        window.marginalia.requestPiServer(
          { path, method: "GET", headers: [] },
          (event) => {
            if (event.type === "start") resolve(event.status);
            if (event.type === "error") reject(new Error(event.code));
          }
        );
      });
    }
    const deadline = Date.now() + 30_000;
    let status;
    while (true) {
      status = await window.marginalia.getPiServerStatus();
      if (status.status === "ready") break;
      if (status.status === "failed") throw new Error(status.error);
      if (Date.now() >= deadline) throw new Error("pi-server did not become ready");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const [health, protectedRequest, directProbe] = await Promise.all([
      requestStatus("/health"),
      requestStatus("/workspaces"),
      window.marginalia.runPackagedSmoke()
    ]);
    return {
      healthStatus: health,
      protectedStatus: protectedRequest,
      directProbe
    };
  });

  if (
    result.healthStatus !== 200 ||
    result.protectedStatus !== 200 ||
    result.directProbe.status !== "ready" ||
    result.directProbe.healthStatus !== 200 ||
    result.directProbe.unauthenticatedStatus !== 401
  ) {
    throw new Error(`packaged smoke failed: ${JSON.stringify(result)}`);
  }
  process.stdout.write(`${JSON.stringify({ status: "ok", ...result })}\n`);
} finally {
  await electronApp?.close().catch(() => undefined);
  await rm(runRoot, { recursive: true, force: true });
}
