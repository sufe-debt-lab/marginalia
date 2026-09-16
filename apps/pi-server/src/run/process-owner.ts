import { execFileSync } from "node:child_process";
import path from "node:path";

/** null = absent, undefined = cannot inspect. Never treat access failure as death. */
export function processIdentity(pid: number): string | null | undefined {
  try {
    process.kill(pid, 0);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH" ? null : undefined;
  }
  try {
    const output =
      process.platform === "win32"
        ? execFileSync(
            path.join(
              process.env.SystemRoot ?? "C:\\Windows",
              "System32",
              "WindowsPowerShell",
              "v1.0",
              "powershell.exe"
            ),
            [
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`
            ],
            { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }
          )
        : execFileSync("/bin/ps", ["-p", String(pid), "-o", "lstart="], {
            encoding: "utf8",
            timeout: 1000,
            stdio: ["ignore", "pipe", "ignore"],
            env: { ...process.env, LC_ALL: "C" }
          });
    return output.trim() || null;
  } catch {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return null;
    }
    return undefined;
  }
}

let ownIdentity: string | undefined;
export function currentProcessIdentity(): string {
  ownIdentity ??= processIdentity(process.pid) ?? undefined;
  if (!ownIdentity) throw new Error("run_owner_unavailable");
  return ownIdentity;
}

export function watchProcessOwner(pid: number, onExit: () => void): () => void {
  let identity = processIdentity(pid);
  const check = () => {
    const current = processIdentity(pid);
    if (current === undefined) return;
    if (current === null || (identity !== undefined && current !== identity)) {
      clearInterval(timer);
      onExit();
    } else {
      identity = current;
    }
  };
  const timer = setInterval(check, 1000);
  timer.unref();
  if (identity === null) {
    clearInterval(timer);
    onExit();
  }
  return () => clearInterval(timer);
}
