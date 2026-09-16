import { createLocalBashOperations } from "@earendil-works/pi-coding-agent";

// This bootstraps Electron as Node; it must not change commands run by the shell.
delete process.env.ELECTRON_RUN_AS_NODE;

// One command per worker. The IPC channel is the owner's lifetime, including
// SIGKILL: this process remains alive long enough to abort pi's shell group.
export type BashWorkerInput = {
  command: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeout?: number;
  shellPath?: string;
};
export type BashWorkerResult = { exitCode: number | null } | { error: string };

const controller = new AbortController();
let started = false;
process.stdout.on("error", () => {
  controller.abort();
});
process.on("disconnect", () => {
  controller.abort();
});
process.on("message", (input: BashWorkerInput | "abort") => {
  if (input === "abort") {
    controller.abort();
    return;
  }
  if (started) return;
  started = true;
  void createLocalBashOperations({ shellPath: input.shellPath })
    .exec(input.command, input.cwd, {
      env: input.env,
      timeout: input.timeout,
      signal: controller.signal,
      onData: (data) => {
        if (process.connected) process.stdout.write(data);
      }
    })
    .then(
      (result) => finish(result),
      (error) => finish({ error: error instanceof Error ? error.message : String(error) })
    );
});
function finish(result: BashWorkerResult) {
  if (process.connected)
    process.send?.(result, () => {
      if (process.connected) process.disconnect();
    });
}
