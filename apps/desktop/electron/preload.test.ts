import { readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  send: vi.fn()
}));

describe("preload bridge", () => {
  beforeEach(async () => {
    mocks.exposeInMainWorld.mockClear();
    mocks.invoke.mockReset();
    const source = await readFile(path.resolve(process.cwd(), "electron/preload.cts"), "utf8");
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText;
    vm.runInNewContext(compiled, {
      exports: {},
      module: { exports: {} },
      require: (id: string) => {
        if (id !== "electron") throw new Error(`unexpected preload import: ${id}`);
        return {
          contextBridge: { exposeInMainWorld: mocks.exposeInMainWorld },
          ipcRenderer: {
            invoke: mocks.invoke,
            on: mocks.on,
            removeListener: mocks.removeListener,
            send: mocks.send
          }
        };
      }
    });
  });

  it.each([
    ["getPiServerStatus", "pi-server:status"],
    ["restartPiServer", "pi-server:restart"]
  ])("does not expose the bearer from %s", async (method, channel) => {
    mocks.invoke.mockResolvedValue({
      status: "ready",
      url: "marginalia://pi-server",
      capabilityToken: "must-not-cross-preload"
    });
    const bridge = mocks.exposeInMainWorld.mock.calls[0]?.[1] as Record<
      string,
      () => Promise<unknown>
    >;

    const status = await bridge[method]?.();

    expect(mocks.invoke).toHaveBeenCalledWith(channel);
    expect(status).toEqual({ status: "ready", url: "marginalia://pi-server" });
    expect(JSON.stringify(status)).not.toContain("must-not-cross-preload");
  });

  it("sanitizes the packaged smoke result", async () => {
    mocks.invoke.mockResolvedValue({
      status: "ready",
      healthStatus: 200,
      unauthenticatedStatus: 401,
      bearer: "must-not-cross-preload"
    });
    const bridge = mocks.exposeInMainWorld.mock.calls[0]?.[1] as {
      runPackagedSmoke(): Promise<unknown>;
    };

    const result = await bridge.runPackagedSmoke();

    expect(mocks.invoke).toHaveBeenCalledWith("pi-server:packaged-smoke");
    expect(result).toEqual({ status: "ready", healthStatus: 200, unauthenticatedStatus: 401 });
    expect(JSON.stringify(result)).not.toContain("must-not-cross-preload");
  });

  it("returns a stable renderer-translated code for malformed status", async () => {
    mocks.invoke.mockResolvedValue({ status: "ready", url: 123 });
    const bridge = mocks.exposeInMainWorld.mock.calls[0]?.[1] as {
      getPiServerStatus(): Promise<unknown>;
    };

    await expect(bridge.getPiServerStatus()).resolves.toEqual({
      status: "failed",
      error: "invalid_pi_server_status",
      logs: []
    });
  });

  it("exposes a callback transport without exposing the bearer or loopback URL", () => {
    const bridge = mocks.exposeInMainWorld.mock.calls[0]?.[1] as {
      requestPiServer(
        input: { path: string; method: string },
        callback: (event: unknown) => void
      ): () => void;
    };
    const callback = vi.fn();

    const cancel = bridge.requestPiServer({ path: "/workspaces", method: "GET" }, callback);

    expect(mocks.send).toHaveBeenCalledWith(
      "pi-server:request",
      expect.objectContaining({ path: "/workspaces", method: "GET" })
    );
    expect(JSON.stringify(mocks.send.mock.calls)).not.toContain("process-secret");

    const listener = mocks.on.mock.calls.find(([channel]) => channel === "pi-server:response")?.[1];
    const requestId = mocks.send.mock.calls[0]?.[1]?.id;
    listener?.({}, { id: requestId, type: "start", status: 200, statusText: "OK", headers: [] });
    expect(callback).toHaveBeenCalledWith({
      type: "start",
      status: 200,
      statusText: "OK",
      headers: []
    });

    cancel();
    expect(mocks.removeListener).toHaveBeenCalledWith("pi-server:response", listener);
    expect(mocks.send).toHaveBeenCalledWith("pi-server:cancel", requestId);
  });
});
