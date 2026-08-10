import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const rendererWebContents = {
    id: 1,
    executeJavaScript: vi.fn(async () => undefined),
    getURL: vi.fn(() => ""),
    insertCSS: vi.fn(async () => undefined),
    isDestroyed: vi.fn(() => false),
    on: vi.fn(),
    once: vi.fn(),
    send: vi.fn(),
    setWindowOpenHandler: vi.fn()
  };
  return {
    loadFile: vi.fn(async () => undefined),
    loadURL: vi.fn(async () => undefined),
    handle: vi.fn(),
    on: vi.fn(),
    appOn: vi.fn(),
    browserWindowOptions: [] as Record<string, unknown>[],
    protocolHandle: vi.fn(),
    registerSchemesAsPrivileged: vi.fn(),
    rendererWebContents,
    startPiServer: vi.fn(async () => ({ status: "starting" as const }))
  };
});

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    commandLine: { appendSwitch: vi.fn() },
    setPath: vi.fn(),
    on: mocks.appOn,
    whenReady: vi.fn(async () => undefined)
  },
  BrowserWindow: class {
    constructor(options: Record<string, unknown>) {
      mocks.browserWindowOptions.push(options);
    }
    loadFile = mocks.loadFile;
    loadURL = mocks.loadURL;
    webContents = mocks.rendererWebContents;
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn()
  },
  ipcMain: { handle: mocks.handle, on: mocks.on },
  net: { fetch: vi.fn() },
  protocol: {
    handle: mocks.protocolHandle,
    registerSchemesAsPrivileged: mocks.registerSchemesAsPrivileged
  },
  shell: { openExternal: vi.fn() }
}));

vi.mock("./pi-server-spawner.js", () => ({
  startPiServer: mocks.startPiServer
}));

describe("desktop dev renderer URL", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.loadFile.mockClear();
    mocks.loadURL.mockClear();
    mocks.browserWindowOptions.length = 0;
    mocks.on.mockClear();
    mocks.rendererWebContents.send.mockClear();
    mocks.protocolHandle.mockClear();
    mocks.registerSchemesAsPrivileged.mockClear();
  });

  afterEach(() => {
    delete process.env.VITE_DEV_SERVER_URL;
  });

  it("accepts the IPv6 loopback URL used by local Vite", async () => {
    process.env.VITE_DEV_SERVER_URL = "http://[::1]:5173";

    await import("./main.js");
    await vi.waitFor(() => expect(mocks.loadURL).toHaveBeenCalled());

    expect(mocks.loadURL).toHaveBeenCalledWith("http://[::1]:5173/");
    expect(mocks.loadFile).not.toHaveBeenCalled();
  });

  it.each([
    ["non-loopback host", "http://example.com:5173"],
    ["lookalike host", "http://localhost.example.com:5173"],
    ["file protocol", "file:///tmp/index.html"],
    ["userinfo", "http://user:password@localhost:5173"],
    ["invalid URL", "not a url"]
  ])("rejects %s and falls back to the packaged entry", async (_label, value) => {
    process.env.VITE_DEV_SERVER_URL = value;

    await import("./main.js");
    await vi.waitFor(() => expect(mocks.loadFile).toHaveBeenCalled());

    expect(mocks.loadURL).not.toHaveBeenCalled();
  });

  it("registers the restricted preload transport and enables renderer sandboxing", async () => {
    await import("./main.js");
    await vi.waitFor(() => expect(mocks.loadFile).toHaveBeenCalled());

    expect(mocks.registerSchemesAsPrivileged).not.toHaveBeenCalled();
    expect(mocks.protocolHandle).not.toHaveBeenCalled();
    expect(mocks.on).toHaveBeenCalledWith("pi-server:request", expect.any(Function));
    expect(mocks.on).toHaveBeenCalledWith("pi-server:cancel", expect.any(Function));
    expect(mocks.browserWindowOptions[0]).toMatchObject({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
  });

  it("rejects pi-server requests from any sender except the app renderer", async () => {
    await import("./main.js");
    await vi.waitFor(() => expect(mocks.loadFile).toHaveBeenCalled());
    const handler = mocks.on.mock.calls.find(([channel]) => channel === "pi-server:request")?.[1];
    const attacker = {
      id: 2,
      isDestroyed: vi.fn(() => false),
      send: vi.fn()
    };

    handler?.(
      { sender: attacker },
      { id: "request-1", path: "/workspaces", method: "GET", headers: [] }
    );

    expect(attacker.send).not.toHaveBeenCalled();
    expect(mocks.rendererWebContents.send).not.toHaveBeenCalled();
  });
});
