// Launch with Electron, pointing at the pi-server directory in packaged Resources.
import { app, utilityProcess } from "electron";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resources =
  process.platform === "darwin"
    ? `release/mac${process.arch === "arm64" ? "-arm64" : ""}/Marginalia.app/Contents/Resources`
    : "release/win-unpacked/resources";
const bundle = process.argv[2] ?? path.join(desktopRoot, resources, "pi-server");
const script = bundle && path.resolve(bundle, "scripts/credential-smoke.mjs");
const reference = `smoke:${randomUUID()}`;
const profile = mkdtempSync(path.join(tmpdir(), "marginalia-credential-smoke-"));
app.setPath("userData", profile);
async function run(phase) {
  return new Promise((resolve, reject) => {
    const child = utilityProcess.fork(script, [phase, reference], { stdio: "pipe" });
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`credential_smoke_${phase}_timeout`));
    }, 20_000);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(`credential_smoke_${phase}_exit_${code}`));
    });
  });
}
void app.whenReady().then(async () => {
  let failed = false;
  try {
    if (!script || !existsSync(script)) throw new Error("packaged_bundle_required");
    for (const phase of ["save", "replace", "delete"]) await run(phase);
    console.log(`Credential packaged smoke passed (${process.platform}/${process.arch}).`);
  } catch (error) {
    failed = true;
    console.error(
      /^credential_smoke_[a-z]+_(exit_\d+|timeout)$/.test(error.message)
        ? error.message
        : "Credential packaged smoke failed."
    );
  } finally {
    if (script && existsSync(script)) {
      try {
        await run("cleanup");
      } catch {
        failed = true;
        console.error(`Credential smoke cleanup failed (${reference}).`);
      }
    }
    rmSync(profile, { recursive: true, force: true });
    app.exit(failed ? 1 : 0);
  }
});
