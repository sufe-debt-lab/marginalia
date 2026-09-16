import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  shell,
  type IpcMainEvent,
  type OpenDialogOptions,
  type SaveDialogOptions
} from "electron";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { isExternalUrl } from "./external-url.js";
import {
  createLoopbackProxyHandler,
  PI_SERVER_RENDERER_URL,
  probeLoopbackAccess
} from "./loopback-proxy.js";
import { startPiServer, type PiServerStatus } from "./pi-server-spawner.js";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "marginalia-file",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
]);

const isScreenshotVerify = process.env.MARGINALIA_SCREENSHOT_VERIFY === "1";

type PiServerRequest = {
  id: string;
  path: string;
  method: string;
  headers: [string, string][];
  body?: string;
};

if (isScreenshotVerify) {
  app.commandLine.appendSwitch("force-device-scale-factor", "1");
}

if (!app.isPackaged && isScreenshotVerify && process.env.MARGINALIA_USER_DATA_DIR) {
  app.setPath("userData", process.env.MARGINALIA_USER_DATA_DIR);
}

let windowRef: BrowserWindow | null = null;
let serverStatus: PiServerStatus = { status: "starting" };
let rendererOrigin = "null";
const activePiServerRequests = new Map<string, AbortController>();

async function bootServer() {
  serverStatus = { status: "starting" };
  rendererOrigin = devServerUrl()?.origin ?? "null";
  serverStatus = await startPiServer({
    isPackaged: app.isPackaged,
    allowedOrigin: rendererOrigin
  });
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
  if (status.status === "ready") {
    return {
      status: "ready",
      url: PI_SERVER_RENDERER_URL
    };
  }
  return status;
}

function parsePiServerRequest(value: unknown): PiServerRequest | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (
    typeof input.id !== "string" ||
    !/^[a-z0-9-]{1,80}$/i.test(input.id) ||
    typeof input.path !== "string" ||
    !input.path.startsWith("/") ||
    input.path.startsWith("//") ||
    typeof input.method !== "string" ||
    !Array.isArray(input.headers) ||
    !input.headers.every(
      (entry) =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === "string" &&
        typeof entry[1] === "string"
    ) ||
    (input.body !== undefined && typeof input.body !== "string")
  ) {
    return null;
  }
  return {
    id: input.id,
    path: input.path,
    method: input.method,
    headers: input.headers as [string, string][],
    ...(typeof input.body === "string" ? { body: input.body } : {})
  };
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
      sandbox: true
    }
  });
  installScreenshotMotionGate(windowRef);
  const contents = windowRef.webContents;
  const cancelRequests = () => {
    for (const [key, controller] of activePiServerRequests) {
      if (key.startsWith(`${contents.id}:`)) controller.abort();
    }
  };
  contents.on("render-process-gone", cancelRequests);
  contents.on("destroyed", cancelRequests);
  contents.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) cancelRequests();
  });
  contents.session.webRequest.onBeforeRequest(
    { urls: ["marginalia-file://*/*"] },
    (details, callback) => {
      callback({
        cancel:
          details.webContentsId !== contents.id ||
          details.frame !== contents.mainFrame ||
          !["xhr", "image", "media", "other"].includes(details.resourceType)
      });
    }
  );
  // Raw previews stay browser-managed streams: no whole-file Blob or IPC buffering.
  contents.session.protocol.handle("marginalia-file", async (request) => {
    const url = new URL(request.url);
    if (
      url.host !== "pi-server" ||
      url.username ||
      url.password ||
      url.hash ||
      !/^\/workspaces\/[^/]+\/files\/raw$/.test(url.pathname) ||
      !["GET", "HEAD"].includes(request.method)
    ) {
      return Response.json({ error: "transport_forbidden" }, { status: 403 });
    }
    return loopbackHandler()({
      url: `${PI_SERVER_RENDERER_URL}${url.pathname}${url.search}`,
      method: request.method,
      headers: request.headers,
      signal: request.signal,
      arrayBuffer: () => request.arrayBuffer()
    });
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
    await windowRef.loadURL(rendererUrl.toString());
  } else {
    await windowRef.loadFile(path.resolve(import.meta.dirname, "../dist/index.html"));
  }
}

ipcMain.handle("pi-server:status", () => serializeStatus(serverStatus));
ipcMain.handle("pi-server:restart", async () => {
  if (serverStatus.status === "ready") serverStatus.process.kill();
  return bootServer();
});
ipcMain.on("pi-server:request", (event, value: unknown) => {
  if (
    event.sender !== windowRef?.webContents ||
    event.senderFrame !== windowRef.webContents.mainFrame
  )
    return;
  const input = parsePiServerRequest(value);
  if (!input) return;

  const key = `${event.sender.id}:${input.id}`;
  const controller = new AbortController();
  if (activePiServerRequests.has(key)) return;
  activePiServerRequests.set(key, controller);
  void forwardPiServerRequest(event, input, controller.signal).finally(() => {
    activePiServerRequests.delete(key);
  });
});
ipcMain.on("pi-server:cancel", (event, requestId: unknown) => {
  if (
    event.sender !== windowRef?.webContents ||
    event.senderFrame !== windowRef.webContents.mainFrame ||
    typeof requestId !== "string"
  )
    return;
  activePiServerRequests.get(`${event.sender.id}:${requestId}`)?.abort();
});

function loopbackHandler() {
  return createLoopbackProxyHandler({
    getAccess: () =>
      serverStatus.status === "ready"
        ? { url: serverStatus.url, bearer: serverStatus.bearer, origin: rendererOrigin }
        : null,
    fetch: net.fetch
  });
}

async function forwardPiServerRequest(
  event: IpcMainEvent,
  input: PiServerRequest,
  signal: AbortSignal
) {
  const { id } = input;
  const send = (payload: Record<string, unknown>) => {
    if (!event.sender.isDestroyed()) event.sender.send("pi-server:response", { id, ...payload });
  };
  let headers: Headers;
  try {
    headers = new Headers(input.headers);
  } catch {
    send({ type: "error", code: "transport_forbidden" });
    return;
  }
  const body = typeof input.body === "string" ? new TextEncoder().encode(input.body).buffer : null;
  const handler = loopbackHandler();

  try {
    const response = await handler({
      url: `${PI_SERVER_RENDERER_URL}${input.path}`,
      method: input.method,
      headers,
      signal,
      arrayBuffer: async () => body ?? new ArrayBuffer(0)
    });
    send({
      type: "start",
      status: response.status,
      statusText: response.statusText,
      headers: [...response.headers.entries()]
    });
    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        send({ type: "data", chunk: result.value });
      }
    }
    send({ type: "end" });
  } catch {
    if (!signal.aborted) send({ type: "error", code: "pi_server_unavailable" });
  }
}
ipcMain.handle("pi-server:packaged-smoke", async () => {
  if (!app.isPackaged || process.env.MARGINALIA_PACKAGED_SMOKE !== "1") {
    return { status: "unavailable" };
  }
  if (serverStatus.status !== "ready") return { status: "starting" };
  const result = await probeLoopbackAccess(
    {
      url: serverStatus.url,
      bearer: serverStatus.bearer,
      origin: rendererOrigin
    },
    net.fetch
  );
  return { status: "ready", ...result };
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

app.on("before-quit", () => {
  if (serverStatus.status === "ready") serverStatus.process.kill();
});

app.whenReady().then(createWindow);
