import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { fork } from "node:child_process";
import type { BashOperations } from "@earendil-works/pi-coding-agent";
import type { BashWorkerInput, BashWorkerResult } from "./bash-worker.js";

/** Keep pi's tool schema, approval hooks, output handling and shell semantics. */
export function supervisedBashOperations(shellPath?: string): BashOperations {
  return {
    exec(command, cwd, options) {
      if (options.signal?.aborted) return Promise.reject(new Error("aborted"));
      const source = import.meta.url.endsWith(".ts");
      const worker = fork(
        new URL(source ? "./bash-worker.ts" : "./bash-worker.js", import.meta.url),
        [],
        {
          execArgv: source
            ? ["--import", pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href]
            : [],
          env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
          stdio: ["ignore", "pipe", "pipe", "ipc"]
        }
      );
      return new Promise((resolve, reject) => {
        let result: BashWorkerResult | undefined;
        const abort = () => {
          if (worker.connected) worker.send("abort", () => {});
        };
        worker.stdout?.on("data", options.onData);
        worker.stderr?.on("data", options.onData);
        worker.on("message", (message: BashWorkerResult) => {
          result = message;
        });
        worker.on("error", () => {
          result = { error: "Bash worker could not start" };
        });
        worker.on("close", () => {
          options.signal?.removeEventListener("abort", abort);
          if (options.signal?.aborted) reject(new Error("aborted"));
          else if (!result) reject(new Error("Bash worker exited before completion"));
          else if ("error" in result) reject(new Error(result.error));
          else resolve(result);
        });
        options.signal?.addEventListener("abort", abort, { once: true });
        const input: BashWorkerInput = {
          command,
          cwd,
          env: options.env,
          timeout: options.timeout,
          shellPath
        };
        worker.send(input, (error) => {
          if (error) {
            result = { error: "Bash worker could not start" };
            if (worker.connected) worker.disconnect();
          }
        });
        if (options.signal?.aborted) abort();
      });
    }
  };
}
