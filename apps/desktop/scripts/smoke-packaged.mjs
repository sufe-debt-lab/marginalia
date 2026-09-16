import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
// Keep real provider credentials and user auth files outside this process tree.
const smokeEnv = Object.fromEntries(
  [
    "PATH",
    "SystemRoot",
    "WINDIR",
    "TMPDIR",
    "TMP",
    "TEMP",
    "DISPLAY",
    "XAUTHORITY",
    "LANG"
  ].flatMap((key) => (process.env[key] ? [[key, process.env[key]]] : []))
);
const isolatedHome = path.join(runRoot, "home");
await mkdir(isolatedHome, { recursive: true });
await writeFile(path.join(runRoot, "note.md"), "# Persisted local file");
await writeFile(
  path.join(runRoot, "pixel.png"),
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ1sAAAAASUVORK5CYII=",
    "base64"
  )
);

try {
  electronApp = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${path.join(runRoot, "user-data")}`],
    env: {
      ...smokeEnv,
      HOME: isolatedHome,
      USERPROFILE: isolatedHome,
      XDG_CONFIG_HOME: path.join(isolatedHome, ".config"),
      PI_CODING_AGENT_DIR: path.join(isolatedHome, ".pi", "agent"),
      MARGINALIA_FAKE_AGENT: "1",
      MARGINALIA_DB_PATH: path.join(runRoot, "marginalia.sqlite"),
      MARGINALIA_PACKAGED_SMOKE: "1"
    }
  });
  const page = await electronApp.firstWindow();
  page.on("console", (message) => {
    if (message.type() === "error") process.stderr.write(`[renderer] ${message.text()}\n`);
  });
  page.on("requestfailed", (request) =>
    process.stderr.write(`[request failed] ${request.url()} ${request.failure()?.errorText}\n`)
  );
  const result = await page.evaluate(async () => {
    function requestStatus(path) {
      return new Promise((resolve, reject) => {
        window.marginalia.requestPiServer({ path, method: "GET", headers: [] }, (event) => {
          if (event.type === "start") resolve(event.status);
          if (event.type === "error") reject(new Error(event.code));
        });
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
  const sandbox = await electronApp.evaluate(({ BrowserWindow }) => {
    const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return {
      sandbox: prefs.sandbox,
      contextIsolation: prefs.contextIsolation,
      nodeIntegration: prefs.nodeIntegration
    };
  });
  if (!sandbox.sandbox || !sandbox.contextIsolation || sandbox.nodeIntegration)
    throw new Error("unsafe renderer preferences");
  const flow = await page.evaluate(async (root) => {
    const request = (path, method = "GET", body) =>
      new Promise((resolve, reject) => {
        let status;
        let text = "";
        const decoder = new TextDecoder();
        window.marginalia.requestPiServer(
          {
            path,
            method,
            headers: [["content-type", "application/json"]],
            ...(body ? { body: JSON.stringify(body) } : {})
          },
          (event) => {
            if (event.type === "start") status = event.status;
            if (event.type === "data") text += decoder.decode(event.chunk, { stream: true });
            if (event.type === "error") reject(new Error(event.code));
            if (event.type === "end") resolve({ status, body: text ? JSON.parse(text) : null });
          }
        );
      });
    const created = await request("/workspaces", "POST", {
      name: "Smoke workspace",
      rootDir: root
    });
    if (created.status !== 201) throw new Error("workspace creation failed");
    const workspace = created.body;
    const rawBase = `marginalia-file://pi-server/workspaces/${workspace.id}/files/raw`;
    const text = await (await fetch(`${rawBase}?path=note.md`)).text();
    if (text !== "# Persisted local file")
      throw new Error("raw stream did not preserve file contents");
    const imageLoaded = await new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image.naturalWidth === 1);
      image.onerror = () => resolve(false);
      image.src = `${rawBase}?path=pixel.png`;
    });
    if (!imageLoaded) throw new Error("authenticated image preview failed");
    const forbidden = await fetch("marginalia-file://pi-server/providers").then(
      (response) => response.status === 403,
      () => true
    );
    if (!forbidden) throw new Error("raw scheme exposed a non-file route");
    const restarted = await window.marginalia.restartPiServer();
    if (restarted.status !== "ready") throw new Error("restart failed");
    const restored = await request("/workspaces");
    if (!restored.body.some((item) => item.id === workspace.id))
      throw new Error("workspace lost after restart");
    return { rawBase, rawFile: true, imagePreview: true, restartPersistence: true };
  }, runRoot);
  const foreignDenied = await electronApp.evaluate(async ({ BrowserWindow }, rawBase) => {
    const foreign = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    try {
      await foreign.loadURL("data:text/html,<h1>Untrusted page</h1>");
      return await foreign.webContents.executeJavaScript(
        `fetch(${JSON.stringify(rawBase + "?path=note.md")}).then(() => false, () => true)`
      );
    } finally {
      foreign.destroy();
    }
  }, flow.rawBase);
  if (!foreignDenied) throw new Error("foreign page could access authenticated raw files");
  delete flow.rawBase;
  process.stdout.write(
    `${JSON.stringify({ status: "ok", ...result, sandbox, ...flow, foreignDenied })}\n`
  );
} finally {
  await electronApp?.close().catch(() => undefined);
  await rm(runRoot, { recursive: true, force: true });
}
