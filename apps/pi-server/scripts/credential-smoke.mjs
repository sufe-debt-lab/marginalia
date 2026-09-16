// Run only via the packaged smoke harness, never as part of ordinary tests.
import { systemCredentialStore } from "../dist/credentials/system.js";

const [phase, reference] = process.argv.slice(2);
if (!/^smoke:[0-9a-f-]{36}$/.test(reference ?? "")) process.exit(1);
const store = systemCredentialStore("works.marginalia.credential-smoke");
// Synthetic values only. The second process must observe the first process's write.
const initial = "marginalia-packaged-smoke-initial";
const replacement = "marginalia-packaged-smoke-replacement";
try {
  if (phase === "save") {
    store.replace(reference, initial);
    if (store.read(reference) !== initial) throw new Error();
  } else if (phase === "replace") {
    if (store.read(reference) !== initial) throw new Error();
    store.replace(reference, replacement);
  } else if (phase === "delete") {
    if (store.read(reference) !== replacement) throw new Error();
    store.delete(reference);
    if (store.read(reference) !== null) throw new Error();
    store.delete(reference);
  } else if (phase === "cleanup") {
    store.delete(reference);
  } else {
    throw new Error();
  }
  process.exitCode = 0;
} catch {
  // Native diagnostics may contain credentials. Never print them, even in a smoke.
  process.stderr.write("credential_smoke_failed\n");
  process.exitCode = 1;
}

// Electron utility processes retain their parent port after the script finishes.
process.exit(process.exitCode ?? 0);
