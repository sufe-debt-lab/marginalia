// Produces a self-contained pi-server bundle for packaging, with better-sqlite3
// compiled against Electron's ABI — all in one place so ordering and isolation hold.
//
// Layout notes:
//  - node-linker=hoisted gives real top-level package dirs (pnpm's default isolated
//    layout is a symlink farm into .pnpm that electron-builder won't copy); we then
//    drop the leftover .bin shims and the redundant .pnpm dir.
//  - The bundle is nested under .deploy/pi-server/ on purpose: electron-builder's
//    extraResources copier hard-excludes a node_modules at the ROOT of the `from` dir
//    but allows a nested one, so copying from .deploy yields pi-server/node_modules.
//
// better-sqlite3 / ABI handling — the tricky part:
//  - Electron uses its own NODE_MODULE_VERSION, distinct from the Node.js one, so the
//    npm-shipped prebuild (system-Node ABI) won't load inside Electron.
//  - @electron/rebuild only reliably compiles the *workspace store* copy of
//    better-sqlite3 from source to Electron's ABI; pointed at the fresh deploy copy it
//    falls back to prebuild-install and restores the system-Node prebuild. It also
//    resolves the module to the pnpm store regardless of the deploy path.
//  - So we let electron-rebuild build the store to Electron's ABI, copy that binary
//    into the deploy, then restore the store to the system-Node ABI that dev/tests use.
//
// TODO(concurrency): between the rebuild and the restore below, the shared pnpm store's
// better-sqlite3 is briefly Electron-ABI. Running `pnpm test`/`pnpm dev` concurrently
// with packaging will hit that transient ABI and fail. Don't package in parallel with
// dev/test; a fully isolated rebuild (outside the workspace store) would remove this.
// The restore is now in a try/finally (step 3), so a failed/interrupted run no longer
// leaves the store stuck on Electron ABI — only the concurrent-run window remains.
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const piServerDir = path.resolve(desktopDir, "../pi-server");
const stagingDir = path.join(piServerDir, ".deploy");
const bundleDir = path.join(stagingDir, "pi-server");

const run = (cmd) => execSync(cmd, { cwd: desktopDir, stdio: "inherit" });

const electronVersion = JSON.parse(
  readFileSync(path.join(desktopDir, "node_modules/electron/package.json"), "utf8")
).version;

// 1. Build pi-server and deploy a self-contained, symlink-free bundle.
run("pnpm --filter @marginalia/pi-server build");
rmSync(stagingDir, { recursive: true, force: true });
run(
  `pnpm --filter @marginalia/pi-server deploy --prod --config.node-linker=hoisted "${bundleDir}"`
);
for (const junk of ["node_modules/.bin", "node_modules/.pnpm"]) {
  rmSync(path.join(bundleDir, junk), { recursive: true, force: true });
}

const deployNativeNode = path.join(
  bundleDir,
  "node_modules/better-sqlite3/build/Release/better_sqlite3.node"
);
if (!existsSync(deployNativeNode)) {
  throw new Error(`better-sqlite3 native binary missing from deploy: ${deployNativeNode}`);
}

// 2. Build the workspace store copy of better-sqlite3 against Electron's ABI, then copy
//    that binary into the deploy. (Resolve the store path so a version bump won't break.)
const piRequire = createRequire(path.join(piServerDir, "package.json"));
const storeNativeNode = path.join(
  path.dirname(piRequire.resolve("better-sqlite3/package.json")),
  "build/Release/better_sqlite3.node"
);
// The rebuild mutates the SHARED workspace store to Electron ABI. Wrap it in try/finally
// so an interrupt or failure between here and the restore can't leave the store stuck on
// Electron ABI — which would break every later dev/test/package run with a NODE_MODULE_VERSION
// mismatch. The restore runs on every exit path; if it throws, that surfaces too.
try {
  run(`pnpm exec electron-rebuild -v ${electronVersion} -m "${piServerDir}" -w better-sqlite3 -f`);
  copyFileSync(storeNativeNode, deployNativeNode);
} finally {
  // 3. Restore the store to the system-Node ABI so dev/tests keep working.
  run("pnpm rebuild -r better-sqlite3");
}

// 4. Fail fast if the deploy binary is NOT Electron-ABI. This script runs on system
//    Node, so dlopen-ing an Electron-ABI .node must throw a NODE_MODULE_VERSION mismatch
//    (a catchable error — Node checks the ABI before init, so no crash). Loading cleanly
//    means the copy didn't take and the packaged app would crash on launch.
let deployIsElectronAbi = false;
try {
  process.dlopen({ exports: {} }, deployNativeNode);
} catch (error) {
  if (/NODE_MODULE_VERSION/.test(String(error?.message))) deployIsElectronAbi = true;
  else throw error;
}
if (!deployIsElectronAbi) {
  throw new Error("deploy better-sqlite3 is not Electron ABI — packaged app would crash on launch");
}

console.log(
  `pi-server bundle ready at ${bundleDir} (better-sqlite3 = Electron ABI; store restored)`
);
