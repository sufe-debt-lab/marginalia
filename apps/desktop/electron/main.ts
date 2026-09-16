import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type OpenDialogOptions,
  type SaveDialogOptions
} from "electron";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { isExternalUrl } from "./external-url.js";
import {
  startPiServer,
  stopPiServer,
  type PiServerProcess,
  type PiServerStatus
} from "./pi-server-spawner.js";

const isScreenshotVerify = process.env.MARGINALIA_SCREENSHOT_VERIFY === "1";

if (isScreenshotVerify) {
  app.commandLine.appendSwitch("force-device-scale-factor", "1");
}

if (!app.isPackaged && isScreenshotVerify && process.env.MARGINALIA_USER_DATA_DIR) {
  app.setPath("userData", process.env.MARGINALIA_USER_DATA_DIR);
}

let serverProcess: PiServerProcess | null = null;
let windowRef: BrowserWindow | null = null;
let serverStatus: PiServerStatus = { status: "starting" };

let bootPromise: Promise<ReturnType<typeof serializeStatus>> | null = null;
let quitting = false;
let quitReady = false;

function bootServer() {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    if (serverProcess) await stopPiServer(serverProcess);
    serverStatus = { status: "starting" };
    let exited: PiServerStatus | null = null;
    let launched: PiServerProcess | null = null;
    const result = await startPiServer({
      isPackaged: app.isPackaged,
      allowedOrigin: devServerUrl()?.origin,
      onSpawn(child) {
        launched = child;
        serverProcess = child;
      },
      onExit(status) {
        if (serverProcess !== launched) return;
        serverProcess = null;
        exited = status;
        serverStatus = status;
      }
    });
    serverStatus = exited ?? result;
    return serializeStatus(serverStatus);
  })()
    .catch((error: unknown) => {
      if (serverStatus.status === "ready") throw error;
      serverStatus = {
        status: "failed",
        error: error instanceof Error ? error.message : "pi-server startup failed",
        logs: []
      };
      return serializeStatus(serverStatus);
    })
    .finally(() => {
      bootPromise = null;
    });
  return bootPromise;
}

function bootServerInBackground() {
  if (!quitting) void bootServer();
}

function serializeStatus(status: PiServerStatus) {
  if (status.status === "ready") {
    return {
      status: "ready",
      url: status.url,
      capabilityToken: status.capabilityToken
    };
  }
  return status;
}

function devServerUrl() {
  if (app.isPackaged || !process.env.VITE_DEV_SERVER_URL) return null;
  try {
    const url = new URL(process.env.VITE_DEV_SERVER_URL);
    const isLoopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    const hasNoCredentials = url.username === "" && url.password === "";
    return isLoopback && hasNoCredentials && ["http:", "https:"].includes(url.protocol)
      ? url
      : null;
  } catch {
    return null;
  }
}

function installScreenshotMotionGate(window: BrowserWindow) {
  if (!isScreenshotVerify) return;
  window.webContents.on("dom-ready", () => {
    void window.webContents.executeJavaScript(
      'document.documentElement.setAttribute("data-motion", "off");' +
        "window.__MARGINALIA_FROZEN_NOW__ = Date.now();",
      true
    );
    void window.webContents.insertCSS("* { caret-color: transparent !important; }");
  });
}

async function createWindow() {
  const isMac = process.platform === "darwin";
  windowRef = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: "#fafafa",
    titleBarStyle: isMac ? "hiddenInset" : "default",
    trafficLightPosition: isMac ? { x: 14, y: 16 } : undefined,
    webPreferences: {
      preload: path.join(import.meta.dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  installScreenshotMotionGate(windowRef);

  // External links open in the system browser, never inside the app window.
  windowRef.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  windowRef.webContents.on("will-navigate", (event, url) => {
    if (url === windowRef?.webContents.getURL()) return;
    event.preventDefault();
    if (isExternalUrl(url)) void shell.openExternal(url);
  });

  // Boot pi-server only after the renderer has loaded, so the static splash is already
  // painted before the (cold) server fork begins and the window stays responsive.
  windowRef.webContents.once("did-finish-load", () => bootServerInBackground());

  const rendererUrl = devServerUrl();
  if (rendererUrl) {
    await windowRef.loadURL(rendererUrl.toString());
  } else {
    await windowRef.loadFile(path.resolve(import.meta.dirname, "../dist/index.html"));
  }
}

ipcMain.handle("pi-server:status", () => serializeStatus(serverStatus));
ipcMain.handle("pi-server:restart", () =>
  quitting ? serializeStatus(serverStatus) : bootServer()
);
ipcMain.handle("workspace:pick-directory", async () => {
  const options: OpenDialogOptions = {
    properties: ["openDirectory"]
  };
  const result = windowRef
    ? await dialog.showOpenDialog(windowRef, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? null : (result.filePaths[0] ?? null);
});
ipcMain.handle("marginalia:open-external", async (_event, url: unknown) => {
  if (typeof url === "string" && isExternalUrl(url)) await shell.openExternal(url);
});
ipcMain.handle("marginalia:save-text-file", async (_event, input: unknown) => {
  const { defaultName, content } = input as { defaultName: string; content: string };
  const options: SaveDialogOptions = {
    defaultPath: defaultName,
    filters: [{ name: "Markdown", extensions: ["md"] }]
  };
  // windowRef is the module-level ref (same as workspace:pick-directory).
  const result = windowRef
    ? await dialog.showSaveDialog(windowRef, options)
    : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return { saved: false };
  try {
    await writeFile(result.filePath, content, "utf8");
    return { saved: true, path: result.filePath };
  } catch (error) {
    // Failure must come back as a result, not an IPC rejection, so the
    // renderer can flash feedback instead of hitting an unhandled rejection.
    return { saved: false, error: (error as Error).message };
  }
});

app.on("before-quit", (event) => {
  if (quitReady) return;
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  void (async () => {
    await bootPromise;
    if (serverProcess) await stopPiServer(serverProcess);
  })()
    .finally(() => {
      quitReady = true;
      app.quit();
    })
    .catch(() => {
      /* The server's parent watchdog also handles forced app exit. */
    });
});

app.whenReady().then(createWindow);
