import { app, BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { startPiServer, type PiServerStatus } from "./pi-server-spawner.js";

let windowRef: BrowserWindow | null = null;
let serverStatus: PiServerStatus = { status: "starting" };

async function bootServer() {
  serverStatus = { status: "starting" };
  serverStatus = await startPiServer();
  return serializeStatus(serverStatus);
}

function serializeStatus(status: PiServerStatus) {
  if (status.status === "ready") return { status: "ready", url: status.url };
  return status;
}

async function createWindow() {
  await bootServer();
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

  if (process.env.VITE_DEV_SERVER_URL) {
    await windowRef.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await windowRef.loadFile(path.resolve(import.meta.dirname, "../index.html"));
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
  const result = windowRef ? await dialog.showOpenDialog(windowRef, options) : await dialog.showOpenDialog(options);
  return result.canceled ? null : result.filePaths[0] ?? null;
});

ipcMain.handle("marginalia:capture-screenshot", async (_event, label: string) => {
  if (!windowRef) throw new Error("window not ready");
  const image = await windowRef.webContents.capturePage();
  const buffer = image.toPNG();
  const outDir = path.resolve(process.cwd(), "output/verify-minimax");
  await fs.mkdir(outDir, { recursive: true });
  const safe = label.replace(/[^a-z0-9_-]+/gi, "-");
  const file = path.join(outDir, `${Date.now()}-${safe}.png`);
  await fs.writeFile(file, buffer);
  return file;
});

app.on("before-quit", () => {
  if (serverStatus.status === "ready") serverStatus.process.kill();
});

app.whenReady().then(createWindow);
