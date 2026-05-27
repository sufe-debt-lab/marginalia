import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import path from "node:path";

export type PiServerStatus =
  | { status: "starting" }
  | { status: "ready"; url: string; process: ChildProcess }
  | { status: "failed"; error: string; logs: string[] };

export type ReadyMessage = { type: "ready"; port: number };

export function resolvePiServerScriptPath(electronDir = import.meta.dirname) {
  return path.resolve(electronDir, "../../pi-server/dist/index.js");
}

export function createReadyLineParser() {
  let buffer = "";

  return {
    push(chunk: string): ReadyMessage | null {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as Partial<ReadyMessage>;
          if (parsed.type === "ready" && typeof parsed.port === "number") {
            return { type: "ready", port: parsed.port };
          }
        } catch {
          // Ignore non-JSON logs.
        }
      }

      return null;
    }
  };
}

type StartOptions = {
  spawn?: typeof nodeSpawn;
  scriptPath?: string;
  nodePath?: string;
  timeoutMs?: number;
};

export async function startPiServer(options: StartOptions = {}): Promise<PiServerStatus> {
  const spawn = options.spawn ?? nodeSpawn;
  const scriptPath = options.scriptPath ?? resolvePiServerScriptPath();
  const nodePath = options.nodePath ?? process.env.MARGINALIA_NODE_PATH ?? "node";
  const child = spawn(nodePath, [scriptPath], { stdio: ["ignore", "pipe", "pipe"] });
  const parser = createReadyLineParser();
  const logs: string[] = [];
  const pushLog = (source: "stdout" | "stderr", chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text) logs.push(`${source}: ${text}`);
    if (logs.length > 20) logs.shift();
  };

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.kill();
      resolve({ status: "failed", error: "pi-server startup timed out", logs });
    }, options.timeoutMs ?? 10_000);

    child.stdout?.on("data", (chunk: Buffer) => {
      pushLog("stdout", chunk);
      const ready = parser.push(chunk.toString());
      if (ready) {
        clearTimeout(timeout);
        resolve({ status: "ready", url: `http://127.0.0.1:${ready.port}`, process: child });
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => pushLog("stderr", chunk));
    child.once("error", (error) => {
      clearTimeout(timeout);
      resolve({ status: "failed", error: error.message, logs });
    });
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve({ status: "failed", error: "pi-server exited before ready", logs });
    });
  });
}
