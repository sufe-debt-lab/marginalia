import { app, BrowserWindow, dialog, ipcMain, shell, type OpenDialogOptions } from "electron";
import path from "node:path";
import { isExternalUrl } from "./external-url.js";
import { startPiServer, type PiServerStatus } from "./pi-server-spawner.js";

const isScreenshotVerify = process.env.MARGINALIA_SCREENSHOT_VERIFY === "1";

if (!app.isPackaged && isScreenshotVerify && process.env.MARGINALIA_USER_DATA_DIR) {
  app.setPath("userData", process.env.MARGINALIA_USER_DATA_DIR);
}

let windowRef: BrowserWindow | null = null;
let serverStatus: PiServerStatus = { status: "starting" };

async function bootServer() {
  serverStatus = { status: "starting" };
  serverStatus = await startPiServer({ isPackaged: app.isPackaged });
  return serializeStatus(serverStatus);
}

function bootServerInBackground() {
  void bootServer().catch((error: unknown) => {
    serverStatus = {
      status: "failed",
      error: error instanceof Error ? error.message : "pi-server startup failed",
      logs: []
    };
  });
}

function serializeStatus(status: PiServerStatus) {
  if (status.status === "ready") return { status: "ready", url: status.url };
  return status;
}

function devServerUrl() {
  if (app.isPackaged || !process.env.VITE_DEV_SERVER_URL) return null;
  try {
    const url = new URL(process.env.VITE_DEV_SERVER_URL);
    const isLoopback = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
    return isLoopback && ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
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
    trafficLightPosition: isMac ? { x: 14, y: 14 } : undefined,
    webPreferences: {
      preload: path.join(import.meta.dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

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
    await windowRef.loadURL(rendererUrl);
  } else {
    await windowRef.loadFile(path.resolve(import.meta.dirname, "../dist/index.html"));
  }
}

ipcMain.handle("pi-server:status", () => serializeStatus(serverStatus));
ipcMain.handle("pi-server:restart", async () => {
  if (serverStatus.status === "ready") serverStatus.process.kill();
  return bootServer();
});
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

app.on("before-quit", () => {
  if (serverStatus.status === "ready") serverStatus.process.kill();
});

app.whenReady().then(createWindow);
