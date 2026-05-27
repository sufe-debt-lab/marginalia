import {
  spawn as nodeSpawn,
  spawnSync as nodeSpawnSync,
  type ChildProcess,
  type SpawnSyncReturns
} from "node:child_process";
import path from "node:path";

export type PiServerStatus =
  | { status: "starting" }
  | { status: "ready"; url: string; process: ChildProcess }
  | { status: "failed"; error: string; logs: string[] };

export type ReadyMessage = { type: "ready"; port: number };

export function resolvePiServerScriptPath(electronDir = import.meta.dirname) {
  return path.resolve(electronDir, "../../pi-server/dist/index.js");
}

export function resolvePiServerCwd(scriptPath: string) {
  return path.resolve(path.dirname(scriptPath), "..");
}

export function collectNodePathCandidates(env: NodeJS.ProcessEnv = process.env) {
  const candidates = [env.MARGINALIA_NODE_PATH];
  for (const dir of (env.PATH ?? "").split(path.delimiter)) {
    if (dir) candidates.push(path.join(dir, "node"));
  }
  candidates.push("node");

  return candidates.filter((candidate, index): candidate is string => {
    return Boolean(candidate) && candidates.indexOf(candidate) === index;
  });
}

type SelectNodePathOptions = {
  candidates?: string[];
  cwd: string;
  spawnSync?: typeof nodeSpawnSync;
};

export function selectNodePath(options: SelectNodePathOptions) {
  const candidates = options.candidates ?? collectNodePathCandidates();
  const spawnSync = options.spawnSync ?? nodeSpawnSync;
  const diagnostics: string[] = [];
  const preflightScript =
    "const Database = require('better-sqlite3'); const db = new Database(':memory:'); db.close();";

  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["-e", preflightScript], {
      cwd: options.cwd,
      encoding: "utf8"
    }) as SpawnSyncReturns<string>;
    if (result.status === 0) return { nodePath: candidate, diagnostics };

    const detail = (result.stderr || result.stdout || result.error?.message || `exit ${result.status}`).trim();
    diagnostics.push(`node preflight failed for ${candidate}: ${detail}`);
  }

  return { nodePath: candidates[0] ?? "node", diagnostics };
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
  spawnSync?: typeof nodeSpawnSync;
  scriptPath?: string;
  nodePath?: string;
  timeoutMs?: number;
};

export async function startPiServer(options: StartOptions = {}): Promise<PiServerStatus> {
  const spawn = options.spawn ?? nodeSpawn;
  const scriptPath = options.scriptPath ?? resolvePiServerScriptPath();
  const cwd = resolvePiServerCwd(scriptPath);
  const nodeSelection = options.nodePath
    ? { nodePath: options.nodePath, diagnostics: [] }
    : selectNodePath({ cwd, spawnSync: options.spawnSync });
  const child = spawn(nodeSelection.nodePath, [scriptPath], { cwd, stdio: ["ignore", "pipe", "pipe"] });
  const parser = createReadyLineParser();
  const logs: string[] = [...nodeSelection.diagnostics.slice(-10)];
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
