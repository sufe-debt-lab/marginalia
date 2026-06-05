import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const piServerDir = path.resolve(path.dirname(scriptPath), "..");
const repoRoot = path.resolve(piServerDir, "../..");
const piRequire = createRequire(path.join(piServerDir, "package.json"));
const RECOVERY_COMMAND = "pnpm --filter @marginalia/pi-server run ensure:native";

export function isNativeAbiMismatch(error) {
  return /NODE_MODULE_VERSION/.test(String(error?.message ?? error));
}

function loadBetterSqlite3() {
  const Database = piRequire("better-sqlite3");
  const db = new Database(":memory:");
  db.close();
}

function rebuildForCurrentNode() {
  const args = ["--filter", "@marginalia/desktop", "run", "rebuild:server-native"];
  const npmExecPath = process.env.npm_execpath;

  if (npmExecPath && /\.(?:cjs|mjs|js)$/i.test(npmExecPath)) {
    execFileSync(process.execPath, [npmExecPath, ...args], {
      cwd: repoRoot,
      stdio: "inherit"
    });
    return;
  }

  execFileSync(process.platform === "win32" ? "pnpm.cmd" : "pnpm", args, {
    cwd: repoRoot,
    stdio: "inherit"
  });
}

export function ensureNativeAbi({
  load = loadBetterSqlite3,
  rebuild = rebuildForCurrentNode,
  log = console,
  repair = true
} = {}) {
  try {
    load();
    return "ok";
  } catch (error) {
    if (!isNativeAbiMismatch(error)) throw error;
    if (!repair) {
      throw new Error(
        `better-sqlite3 ABI mismatch detected for pi-server. Run \`${RECOVERY_COMMAND}\` from the repository root before starting.`,
        { cause: error }
      );
    }
    log.warn?.(
      "better-sqlite3 ABI mismatch detected for pi-server; rebuilding for the current Node."
    );
    rebuild();
    load();
    return "rebuilt";
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  ensureNativeAbi({ repair: !process.argv.includes("--check-only") });
}
