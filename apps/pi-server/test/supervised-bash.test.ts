import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createBashTool, type BashOperations } from "@earendil-works/pi-coding-agent";
import { supervisedBashOperations } from "../src/agent/supervised-bash.js";

// These are real Node/pi process tests, including cold module loading under CI load.
vi.setConfig({ testTimeout: 20000, hookTimeout: 20000 });

const roots: string[] = [];
const executions: { controller: AbortController; settled: Promise<void> }[] = [];
function trackedOperations(): BashOperations {
  const bash = supervisedBashOperations();
  return {
    exec(command, cwd, options) {
      const controller = new AbortController();
      const result = bash.exec(command, cwd, {
        ...options,
        signal: options.signal
          ? AbortSignal.any([options.signal, controller.signal])
          : controller.signal
      });
      executions.push({
        controller,
        settled: result.then(
          () => {},
          () => {}
        )
      });
      return result;
    }
  };
}
function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "supervised-bash-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  const active = executions.splice(0);
  for (const { controller } of active) controller.abort();
  await Promise.all(active.map(({ settled }) => settled));
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

it("preserves output, nonzero exit status and the requested shell environment", async () => {
  const chunks: Buffer[] = [];
  const result = await trackedOperations().exec(
    'printf "$FIXTURE_VALUE"; printf stderr >&2; exit 7',
    workspace(),
    {
      env: { PATH: process.env.PATH, FIXTURE_VALUE: "fixture-output" },
      onData: (chunk) => chunks.push(chunk)
    }
  );
  expect(result.exitCode).toBe(7);
  expect(Buffer.concat(chunks).toString()).toContain("fixture-output");
  expect(Buffer.concat(chunks).toString()).toContain("stderr");
});

it("keeps pi's command prefix and tool result rendering", async () => {
  const tool = createBashTool(workspace(), {
    operations: trackedOperations(),
    commandPrefix: "export PREFIX_FIXTURE=prefix-value"
  });
  const result = await tool.execute("prefix", { command: 'printf "$PREFIX_FIXTURE"' });
  expect(result.content).toContainEqual({ type: "text", text: "prefix-value" });
});

it("cancels an executing shell through the existing AbortSignal", async () => {
  const root = workspace();
  const controller = new AbortController();
  let ready!: () => void;
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const command = trackedOperations().exec("echo ready; sleep 5; echo late > artifact.md", root, {
    signal: controller.signal,
    onData: () => ready()
  });
  await Promise.race([started, command]);
  controller.abort();
  await expect(command).rejects.toThrow("aborted");
  expect(fs.existsSync(path.join(root, "artifact.md"))).toBe(false);
});

it("preserves pi's timeout error and does not execute an already-aborted command", async () => {
  const root = workspace();
  const bash = trackedOperations();
  await expect(
    bash.exec("sleep 5; echo late > artifact.md", root, { timeout: 0.1, onData() {} })
  ).rejects.toThrow("timeout:0.1");
  const controller = new AbortController();
  controller.abort();
  await expect(
    bash.exec("echo late > artifact.md", root, { signal: controller.signal, onData() {} })
  ).rejects.toThrow("aborted");
  expect(fs.existsSync(path.join(root, "artifact.md"))).toBe(false);
});
