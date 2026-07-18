import path from "node:path";
import { randomBytes } from "node:crypto";

/** The subset of ChildProcess / Electron's UtilityProcess that the spawner uses. */
export type PiServerProcess = {
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  once(event: "exit", listener: () => void): unknown;
  kill(): unknown;
};

export type PiServerStatus =
  | { status: "starting" }
  | { status: "ready"; url: string; capabilityToken: string; process: PiServerProcess }
  | { status: "failed"; error: string; logs: string[] };

export type ReadyMessage = { type: "ready"; port: number };

/** Creates the pi-server child process; the strategy differs dev vs packaged. */
type LaunchFn = (
  scriptPath: string,
  cwd: string,
  env: Readonly<Record<string, string>>
) => PiServerProcess;

type ResolveScriptOptions = {
  isPackaged: boolean;
  /** Compiled electron dir (dist-electron) — used in development. */
  electronDir?: string;
  /** Electron's resourcesPath — used when packaged. */
  resourcesPath?: string;
};

/**
 * In development the pi-server build lives in the monorepo at apps/pi-server/dist;
 * when packaged it ships under resources/pi-server (electron-builder extraResources).
 */
export function resolvePiServerScriptPath(options: ResolveScriptOptions) {
  if (options.isPackaged) {
    const resources = options.resourcesPath ?? process.resourcesPath;
    return path.join(resources, "pi-server", "dist", "index.js");
  }
  return path.resolve(options.electronDir ?? import.meta.dirname, "../../pi-server/dist/index.js");
}

export function resolvePiServerCwd(scriptPath: string) {
  // scriptPath is <root>/pi-server/dist/index.js → cwd is <root>/pi-server so the
  // forked process resolves its sibling node_modules.
  return path.resolve(path.dirname(scriptPath), "..");
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

export function createLaunchEnvironment(
  additions: Readonly<Record<string, string>>
): NodeJS.ProcessEnv {
  const inherited = { ...process.env };
  delete inherited.MARGINALIA_CAPABILITY_TOKEN;
  delete inherited.MARGINALIA_ALLOWED_ORIGIN;
  return { ...inherited, ...additions };
}

async function defaultLaunch(isPackaged: boolean): Promise<LaunchFn> {
  if (isPackaged) {
    // Packaged: run on Electron's bundled Node so the client needs no Node install, and
    // better-sqlite3 only has to match Electron's ABI (rebuilt at packaging time).
    const { utilityProcess } = await import("electron");
    return (scriptPath, cwd, env) =>
      utilityProcess.fork(scriptPath, [], {
        cwd,
        env: createLaunchEnvironment(env),
        stdio: ["ignore", "pipe", "pipe"]
      });
  }
  // Development: run on the system Node from PATH. Its ABI matches the better-sqlite3
  // that `pnpm install` built; forking under Electron's different ABI would crash on
  // boot. MARGINALIA_NODE_PATH overrides which node binary to use.
  const { spawn } = await import("node:child_process");
  const nodePath = process.env.MARGINALIA_NODE_PATH ?? "node";
  return (scriptPath, cwd, env) =>
    spawn(nodePath, [scriptPath], {
      cwd,
      env: createLaunchEnvironment(env),
      stdio: ["ignore", "pipe", "pipe"]
    });
}

type StartOptions = {
  /** Inject the process launcher (a fake in tests). */
  launch?: LaunchFn;
  scriptPath?: string;
  isPackaged?: boolean;
  timeoutMs?: number;
  capabilityToken?: string;
  allowedOrigin?: string;
};

/**
 * Launch pi-server and resolve once it prints its ready line. Packaged builds run on
 * Electron's bundled Node (no client Node needed); dev runs on the system Node whose
 * ABI matches the workspace install. See defaultLaunch.
 */
export async function startPiServer(options: StartOptions = {}): Promise<PiServerStatus> {
  const isPackaged = options.isPackaged ?? false;
  const scriptPath = options.scriptPath ?? resolvePiServerScriptPath({ isPackaged });
  const cwd = resolvePiServerCwd(scriptPath);
  const launch = options.launch ?? (await defaultLaunch(isPackaged));
  const capabilityToken = options.capabilityToken ?? randomBytes(32).toString("base64url");
  const childEnv = {
    MARGINALIA_CAPABILITY_TOKEN: capabilityToken,
    ...(options.allowedOrigin ? { MARGINALIA_ALLOWED_ORIGIN: options.allowedOrigin } : {})
  };
  const child = launch(scriptPath, cwd, childEnv);
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
        resolve({
          status: "ready",
          url: `http://127.0.0.1:${ready.port}`,
          capabilityToken,
          process: child
        });
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => pushLog("stderr", chunk));
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve({ status: "failed", error: "pi-server exited before ready", logs });
    });
  });
}
