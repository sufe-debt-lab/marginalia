import { app, BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from "electron";
import path from "node:path";
import { startPiServer, type PiServerStatus } from "./pi-server-spawner.js";

if (process.env.MARGINALIA_USER_DATA_DIR) {
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

  // Boot pi-server only after the renderer has loaded, so the static splash is already
  // painted before the (cold) server fork begins and the window stays responsive.
  windowRef.webContents.once("did-finish-load", () => bootServerInBackground());

  if (process.env.VITE_DEV_SERVER_URL) {
    await windowRef.loadURL(process.env.VITE_DEV_SERVER_URL);
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

app.on("before-quit", () => {
  if (serverStatus.status === "ready") serverStatus.process.kill();
});

app.whenReady().then(createWindow);
