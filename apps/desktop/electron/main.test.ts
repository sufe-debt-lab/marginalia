import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadFile: vi.fn(async () => undefined),
  loadURL: vi.fn(async () => undefined),
  handle: vi.fn(),
  appOn: vi.fn()
}));

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    commandLine: { appendSwitch: vi.fn() },
    setPath: vi.fn(),
    on: mocks.appOn,
    whenReady: vi.fn(async () => undefined)
  },
  BrowserWindow: class {
    loadFile = mocks.loadFile;
    loadURL = mocks.loadURL;
    webContents = {
      executeJavaScript: vi.fn(async () => undefined),
      getURL: vi.fn(() => ""),
      insertCSS: vi.fn(async () => undefined),
      on: vi.fn(),
      once: vi.fn(),
      setWindowOpenHandler: vi.fn()
    };
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn()
  },
  ipcMain: { handle: mocks.handle },
  shell: { openExternal: vi.fn() }
}));

vi.mock("./pi-server-spawner.js", () => ({
  startPiServer: vi.fn(async () => ({ status: "starting" }))
}));

describe("desktop dev renderer URL", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.loadFile.mockClear();
    mocks.loadURL.mockClear();
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
});
