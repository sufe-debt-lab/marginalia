import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { createReadyLineParser, resolvePiServerScriptPath, startPiServer } from "./pi-server-spawner.js";

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
  });

  it("returns failed status with recent stdout and stderr when startup exits", async () => {
    const child = new FakeChild();
    const spawn = vi.fn(() => child as never);
    const promise = startPiServer({ spawn, scriptPath: "/tmp/server.js", nodePath: "node", timeoutMs: 50 });

    child.stdout.emit("data", Buffer.from("booting\n"));
    child.stderr.emit("data", Buffer.from("missing config\n"));
    child.emit("exit", 1);

    expect(spawn).toHaveBeenCalledWith("node", ["/tmp/server.js"], { stdio: ["ignore", "pipe", "pipe"] });
    await expect(promise).resolves.toMatchObject({
      status: "failed",
      error: "pi-server exited before ready",
      logs: expect.arrayContaining(["stdout: booting", "stderr: missing config"])
    });
  });
});
