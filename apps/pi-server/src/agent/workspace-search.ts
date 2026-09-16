import { Worker } from "node:worker_threads";

/** Keep model-supplied regular expressions off the server event loop. No worker filesystem access. */
export function searchText(
  files: Array<{ path: string; text: string }>,
  options: {
    pattern: string;
    literal?: boolean;
    ignoreCase?: boolean;
    context?: number;
    limit?: number;
  },
  signal?: AbortSignal
): Promise<string> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      `
      const { parentPort, workerData } = require("node:worker_threads");
      const { files, options } = workerData;
      const regex = options.literal ? null : new RegExp(options.pattern, options.ignoreCase ? "i" : "");
      const needle = options.ignoreCase ? options.pattern.toLowerCase() : options.pattern;
      const limit = Math.max(1, Math.min(options.limit ?? 100, 10000));
      const context = Math.max(0, Math.min(options.context ?? 0, 100));
      const output = [];
      let count = 0;
      let outputSize = 0;
      outer: for (const file of files) {
        const lines = file.text.split(/\\r?\\n/);
        for (let i = 0; i < lines.length; i++) {
          const hit = regex ? regex.test(lines[i]) : (options.ignoreCase ? lines[i].toLowerCase() : lines[i]).includes(needle);
          if (!hit) continue;
          for (let j = Math.max(0, i-context); j <= Math.min(lines.length-1, i+context); j++) {
            const line = file.path + ":" + (j+1) + ":" + lines[j].slice(0, 2000);
            outputSize += line.length;
            if (outputSize > 50000) { output.push("[Output limit reached]"); break outer; }
            output.push(line);
          }
          if (++count >= limit) { output.push("[Match limit reached: " + limit + "]"); break outer; }
        }
      }
      parentPort.postMessage(output.join("\\n") || "No matches found");
    `,
      { eval: true, workerData: { files, options } }
    );
    let settled = false;
    const finish = (error?: Error, result?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      void worker.terminate();
      if (error) reject(error);
      else resolve(result!);
    };
    const abort = () => finish(new Error("Search aborted"));
    const timer = setTimeout(
      () => finish(new Error("Search timed out; simplify the pattern.")),
      2000
    );
    signal?.addEventListener("abort", abort, { once: true });
    worker.once("message", (result) => finish(undefined, result));
    worker.once("error", (error) => finish(error));
    worker.once("exit", () => {
      if (!settled) finish(new Error("Search worker exited without a result"));
    });
  });
}
