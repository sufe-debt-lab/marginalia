import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createReadyLineParser,
  resolvePiServerCwd,
  resolvePiServerScriptPath,
  startPiServer
} from "./pi-server-spawner.js";

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  killed = false;

  kill() {
    this.killed = true;
    this.emit("exit", 0);
    return true;
  }
}

afterEach(() => vi.unstubAllEnvs());

describe("createLaunchEnvironment", () => {
  it("removes inherited loopback access settings when no renderer origin is allowed", async () => {
    vi.stubEnv("MARGINALIA_LOOPBACK_BEARER", "stale-token");
    vi.stubEnv("MARGINALIA_ALLOWED_ORIGIN", "https://evil.example");
    const mod = await import("./pi-server-spawner.js");
    const createLaunchEnvironment = Reflect.get(mod, "createLaunchEnvironment") as
      | ((additions: Readonly<Record<string, string>>) => NodeJS.ProcessEnv)
      | undefined;

    const environment = createLaunchEnvironment?.({
      MARGINALIA_LOOPBACK_BEARER: "fresh-token"
    });

    expect(environment).toEqual(
      expect.objectContaining({ MARGINALIA_LOOPBACK_BEARER: "fresh-token" })
    );
    expect(environment).not.toHaveProperty("MARGINALIA_ALLOWED_ORIGIN");
  });

  it("replaces inherited loopback access settings with validated launch additions", async () => {
    vi.stubEnv("MARGINALIA_LOOPBACK_BEARER", "stale-token");
    vi.stubEnv("MARGINALIA_ALLOWED_ORIGIN", "https://evil.example");
    const mod = await import("./pi-server-spawner.js");
    const createLaunchEnvironment = Reflect.get(mod, "createLaunchEnvironment") as
      | ((additions: Readonly<Record<string, string>>) => NodeJS.ProcessEnv)
      | undefined;

    const environment = createLaunchEnvironment?.({
      MARGINALIA_LOOPBACK_BEARER: "fresh-token",
      MARGINALIA_ALLOWED_ORIGIN: "http://127.0.0.1:5173"
    });

    expect(environment).toEqual(
      expect.objectContaining({
        MARGINALIA_ALLOWED_ORIGIN: "http://127.0.0.1:5173",
        MARGINALIA_LOOPBACK_BEARER: "fresh-token"
      })
    );
  });
});

describe("createReadyLineParser", () => {
  it("parses ready messages split across stdout chunks", () => {
    const parser = createReadyLineParser();

    expect(parser.push('{"type":"ready",')).toBeNull();
    expect(parser.push('"port":4312}\n')).toEqual({ type: "ready", port: 4312 });
  });

  it("ignores invalid JSON without crashing", () => {
    const parser = createReadyLineParser();

    expect(parser.push("not-json\n")).toBeNull();
    expect(parser.push('{"type":"ready","port":1234}\n')).toEqual({ type: "ready", port: 1234 });
  });
});

describe("resolvePiServerScriptPath", () => {
  it("resolves the dev build relative to the compiled electron directory", () => {
    expect(
      resolvePiServerScriptPath({
        isPackaged: false,
        electronDir: "/repo/apps/desktop/dist-electron"
      })
    ).toBe("/repo/apps/pi-server/dist/index.js");
    expect(resolvePiServerCwd("/repo/apps/pi-server/dist/index.js")).toBe("/repo/apps/pi-server");
  });

  it("resolves the packaged build from process.resourcesPath", () => {
    expect(
      resolvePiServerScriptPath({
        isPackaged: true,
        resourcesPath: "/Applications/Marginalia.app/Contents/Resources"
      })
    ).toBe("/Applications/Marginalia.app/Contents/Resources/pi-server/dist/index.js");
    expect(
      resolvePiServerCwd("/Applications/Marginalia.app/Contents/Resources/pi-server/dist/index.js")
    ).toBe("/Applications/Marginalia.app/Contents/Resources/pi-server");
  });
});

describe("startPiServer", () => {
  it("launches pi-server via the injected launcher and reports ready", async () => {
    const child = new FakeChild();
    const launch = vi.fn(() => child as never);

    const promise = startPiServer({
      launch,
      scriptPath: "/res/pi-server/dist/index.js",
      timeoutMs: 1000,
      bearer: "fixed-token",
      allowedOrigin: "http://127.0.0.1:5173"
    });

    child.stdout.emit("data", Buffer.from('{"type":"ready","port":4321}\n'));

    expect(launch).toHaveBeenCalledWith("/res/pi-server/dist/index.js", "/res/pi-server", {
      MARGINALIA_ALLOWED_ORIGIN: "http://127.0.0.1:5173",
      MARGINALIA_LOOPBACK_BEARER: "fixed-token"
    });

    const result = await promise;
    expect(result).toMatchObject({
      status: "ready",
      url: "http://127.0.0.1:4321",
      bearer: "fixed-token"
    });
    if (result.status === "ready") expect(result.process).toBe(child);
  });

  it("returns failed status with recent stdout and stderr when startup exits", async () => {
    const child = new FakeChild();
    const launch = vi.fn(() => child as never);

    const promise = startPiServer({
      launch,
      scriptPath: "/tmp/pi-server/dist/server.js",
      timeoutMs: 50,
      bearer: "fixed-token"
    });

    child.stdout.emit("data", Buffer.from("booting\n"));
    child.stderr.emit("data", Buffer.from("missing config\n"));
    child.emit("exit", 1);

    expect(launch).toHaveBeenCalledWith("/tmp/pi-server/dist/server.js", "/tmp/pi-server", {
      MARGINALIA_LOOPBACK_BEARER: "fixed-token"
    });
    await expect(promise).resolves.toMatchObject({
      status: "failed",
      error: "pi-server exited before ready",
      logs: expect.arrayContaining(["stdout: booting", "stderr: missing config"])
    });
    expect(JSON.stringify(await promise)).not.toContain("fixed-token");
  });

  it("no longer exposes the external-node preflight helpers", async () => {
    const mod = await import("./pi-server-spawner.js");
    expect("selectNodePath" in mod).toBe(false);
    expect("collectNodePathCandidates" in mod).toBe(false);
  });
});
