import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  collectNodePathCandidates,
  createReadyLineParser,
  resolvePiServerCwd,
  resolvePiServerScriptPath,
  selectNodePath,
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

describe("startPiServer", () => {
  it("resolves the pi-server build from the compiled electron directory", () => {
    expect(resolvePiServerScriptPath("/repo/apps/desktop/dist-electron")).toBe("/repo/apps/pi-server/dist/index.js");
    expect(resolvePiServerCwd("/repo/apps/pi-server/dist/index.js")).toBe("/repo/apps/pi-server");
  });

  it("deduplicates node candidates from explicit env and PATH order", () => {
    expect(
      collectNodePathCandidates({
        MARGINALIA_NODE_PATH: "/custom/node",
        PATH: "/a/bin:/b/bin:/a/bin"
      })
    ).toEqual(["/custom/node", "/a/bin/node", "/b/bin/node", "node"]);
  });

  it("selects the first node candidate that can load pi-server native dependencies", () => {
    const spawnSync = vi
      .fn()
      .mockReturnValueOnce({ status: 1, stderr: "wrong ABI", stdout: "" })
      .mockReturnValueOnce({ status: 0, stderr: "", stdout: "" });

    const selected = selectNodePath({
      spawnSync,
      candidates: ["/node24", "/node26"],
      cwd: "/repo/apps/pi-server"
    });

    expect(selected).toEqual({ nodePath: "/node26", diagnostics: ["node preflight failed for /node24: wrong ABI"] });
    expect(spawnSync).toHaveBeenCalledWith(
      "/node24",
      [
        "-e",
        "const Database = require('better-sqlite3'); const db = new Database(':memory:'); db.close();"
      ],
      { cwd: "/repo/apps/pi-server", encoding: "utf8" }
    );
  });

  it("returns failed status with recent stdout and stderr when startup exits", async () => {
    const child = new FakeChild();
    const spawn = vi.fn(() => child as never);
    const spawnSync = vi.fn(() => ({ status: 0, stderr: "", stdout: "" }) as never);
    const promise = startPiServer({ spawn, spawnSync, scriptPath: "/tmp/dist/server.js", nodePath: "node", timeoutMs: 50 });

    child.stdout.emit("data", Buffer.from("booting\n"));
    child.stderr.emit("data", Buffer.from("missing config\n"));
    child.emit("exit", 1);

    expect(spawn).toHaveBeenCalledWith("node", ["/tmp/dist/server.js"], {
      cwd: "/tmp",
      stdio: ["ignore", "pipe", "pipe"]
    });
    await expect(promise).resolves.toMatchObject({
      status: "failed",
      error: "pi-server exited before ready",
      logs: expect.arrayContaining(["stdout: booting", "stderr: missing config"])
    });
  });
});
