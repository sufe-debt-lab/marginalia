import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  mkdirSync,
  renameSync,
  symlinkSync,
  readdirSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createWorkspaceTools } from "../src/agent/workspace-tools.js";
import { ApprovalGateway } from "../src/agent/approval-gateway.js";
import type { ApprovalRequestedEvent } from "../src/agent/agent-client.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
async function setup() {
  const root = mkdtempSync(path.join(os.tmpdir(), "workspace-tools-"));
  roots.push(root);
  const gateway = new ApprovalGateway();
  gateway.setPolicy("s", { permission: "ask", workspaceRoot: root });
  const tools = await createWorkspaceTools(root, gateway, "s");
  const execute = (name: string, input: unknown, signal?: AbortSignal) =>
    (tools.find((tool) => tool.name === name)! as unknown as ToolDefinition).execute(
      "call-1",
      input,
      signal,
      undefined,
      {} as never
    );
  return { root, gateway, execute };
}
function nextApproval(gateway: ApprovalGateway) {
  return new Promise<ApprovalRequestedEvent>((resolve) => {
    const off = gateway.onEvent("s", (event) => {
      if (event.type === "approval_requested") {
        off();
        resolve(event);
      }
    });
  });
}

describe("production workspace tools", () => {
  it("respects root and nested gitignore rules when finding and searching files", async () => {
    const { root, execute } = await setup();
    mkdirSync(path.join(root, "dist"));
    mkdirSync(path.join(root, "src"));
    writeFileSync(path.join(root, ".gitignore"), "dist/\n*.log\n");
    writeFileSync(path.join(root, "dist/bundle.md"), "needle".repeat(2_000_000));
    writeFileSync(path.join(root, "src/.gitignore"), "private.md\n!keep.log\n");
    writeFileSync(path.join(root, "src/private.md"), "needle secret");
    writeFileSync(path.join(root, "src/keep.log"), "needle source");
    writeFileSync(path.join(root, "src/drop.log"), "needle ignored");
    const found = JSON.stringify(await execute("find", { pattern: "*" }));
    expect(found).toContain("src/keep.log");
    expect(found).not.toMatch(/bundle.md|private.md|drop.log/);
    const matches = JSON.stringify(await execute("grep", { pattern: "needle" }));
    expect(matches).toContain("needle source");
    expect(matches).not.toMatch(/secret|ignored|bundle.md/);
    expect(JSON.stringify(await execute("find", { path: "src", pattern: "*" }))).not.toMatch(
      /private.md|drop.log/
    );
  });
  it("does not execute a destructive read-prefixed command before approval or after rejection", async () => {
    const { root, gateway, execute } = await setup();
    writeFileSync(path.join(root, "note.md"), "keep");
    const approval = nextApproval(gateway);
    const pending = execute("bash", { command: "find . -name note.md -delete" });
    const rejected = expect(pending).rejects.toThrow("declined");
    const event = await approval;
    expect(event.payload).toMatchObject({
      kind: "command",
      command: "find . -name note.md -delete",
      effect: { kind: "execute" }
    });
    expect(readFileSync(path.join(root, "note.md"), "utf8")).toBe("keep");
    gateway.resolve(event.approvalId, { approved: false });
    await rejected;
    expect(readFileSync(path.join(root, "note.md"), "utf8")).toBe("keep");
  });

  it.each(["write", "edit"])(
    "rejects stale %s approval without losing a newer edit, then permits a fresh proposal",
    async (name) => {
      const { root, gateway, execute } = await setup();
      const target = path.join(root, "note.md");
      writeFileSync(target, "original\n");
      const input =
        name === "write"
          ? { path: "note.md", content: "replacement\n" }
          : { path: "note.md", edits: [{ oldText: "original", newText: "replacement" }] };
      const approval = nextApproval(gateway);
      const pending = execute(name, input);
      const rejected = expect(pending).rejects.toThrow("changed");
      const event = await approval;
      expect(event.toolCallId).toBe("call-1");
      expect(event.payload).toMatchObject({
        kind: "file_edit",
        mode: name,
        exact: true,
        effect: { kind: "overwrite" }
      });
      if (event.payload.kind !== "file_edit") throw new Error("expected file preview");
      expect(event.payload.patch).toContain("-original");
      expect(event.payload.patch).toContain("+replacement");
      writeFileSync(target, "newer manual edit\n");
      gateway.resolve(event.approvalId, { approved: true });
      await rejected;
      expect(readFileSync(target, "utf8")).toBe("newer manual edit\n");
      const retryApproval = nextApproval(gateway);
      const retry = execute("write", { path: "note.md", content: "accepted\n" });
      gateway.resolve((await retryApproval).approvalId, { approved: true });
      await retry;
      expect(readFileSync(target, "utf8")).toBe("accepted\n");
      expect(readdirSync(root)).toEqual(["note.md"]);
    }
  );

  it("rejects a symlink parent substituted while approval is pending", async () => {
    const { root, gateway, execute } = await setup();
    mkdirSync(path.join(root, "docs"));
    mkdirSync(path.join(root, "outside"));
    writeFileSync(path.join(root, "docs/note.md"), "inside");
    writeFileSync(path.join(root, "outside/note.md"), "untouched");
    const approval = nextApproval(gateway);
    const pending = execute("write", { path: "docs/note.md", content: "replacement" });
    const rejected = expect(pending).rejects.toThrow();
    const event = await approval;
    renameSync(path.join(root, "docs"), path.join(root, "original-docs"));
    symlinkSync(path.join(root, "outside"), path.join(root, "docs"), "dir");
    gateway.resolve(event.approvalId, { approved: true });
    await rejected;
    expect(readFileSync(path.join(root, "outside/note.md"), "utf8")).toBe("untouched");
    expect(readFileSync(path.join(root, "original-docs/note.md"), "utf8")).toBe("inside");
  });

  it("rejects invalid edits before requesting approval or mutating the file", async () => {
    const { root, gateway, execute } = await setup();
    writeFileSync(path.join(root, "a.md"), "original");
    await expect(
      execute("edit", { path: "a.md", edits: [{ oldText: "absent", newText: "x" }] })
    ).rejects.toThrow();
    expect(gateway.pendingIds("s")).toEqual([]);
    expect(readFileSync(path.join(root, "a.md"), "utf8")).toBe("original");
  });

  it("denial and abort preserve the file and release pending approval", async () => {
    const { root, gateway, execute } = await setup();
    writeFileSync(path.join(root, "a.md"), "original");
    for (const abort of [false, true]) {
      const controller = new AbortController();
      const approval = nextApproval(gateway);
      const pending = execute("write", { path: "a.md", content: "replacement" }, controller.signal);
      const rejected = expect(pending).rejects.toThrow();
      const event = await approval;
      if (abort) controller.abort();
      else gateway.resolve(event.approvalId, { approved: false });
      await rejected;
      expect(readFileSync(path.join(root, "a.md"), "utf8")).toBe("original");
      expect(gateway.pendingIds("s")).toEqual([]);
    }
  });

  it("confines read, ls, find, grep and write in every permission profile", async () => {
    const { root, gateway, execute } = await setup();
    for (const permission of ["ask", "full", "readonly"] as const) {
      gateway.setPolicy("s", { permission, workspaceRoot: root });
      for (const name of ["read", "ls", "find", "grep", "write"]) {
        await expect(
          execute(name, { path: "../escape.md", pattern: "*", content: "escape" })
        ).rejects.toThrow("Path escapes workspace");
      }
    }
    expect(existsSync(path.join(root, "escape.md"))).toBe(false);
  });

  it("searches and reads real files without following symlinks", async () => {
    const { root, execute } = await setup();
    mkdirSync(path.join(root, "docs"));
    writeFileSync(path.join(root, "docs/note.md"), "one\nneedle\nthree");
    symlinkSync(path.join(root, "docs"), path.join(root, "alias"), "dir");
    expect(JSON.stringify(await execute("find", { pattern: "*.md" }))).toContain("docs/note.md");
    expect(JSON.stringify(await execute("grep", { pattern: "needle", context: 1 }))).toContain(
      "docs/note.md:2:needle"
    );
    expect(
      JSON.stringify(await execute("read", { path: "docs/note.md", offset: 2, limit: 1 }))
    ).toContain("needle");
    await expect(execute("read", { path: "alias/note.md" })).rejects.toThrow(
      "Path escapes workspace"
    );
  });
});

it("reads effective Skills from pinned catalog bytes without allowing arbitrary filesystem paths", async () => {
  const { root, gateway } = await setup();
  const skillPath = path.join(root, "SKILL.md");
  writeFileSync(skillPath, "new disk bytes");
  const tools = await createWorkspaceTools(root, gateway, "s", {
    [skillPath]: "frozen catalog bytes"
  });
  const tool = tools.find((tool) => tool.name === "read_skill")! as unknown as ToolDefinition;
  expect(
    JSON.stringify(
      await tool.execute("skill", { path: skillPath }, undefined, undefined, {} as never)
    )
  ).toContain("frozen catalog bytes");
  await expect(
    tool.execute("bad", { path: "/arbitrary/file" }, undefined, undefined, {} as never)
  ).rejects.toThrow("not in this run catalog");
});

it("refuses mutations in Read-only even if a tool handle was obtained earlier", async () => {
  const { root, gateway, execute } = await setup();
  gateway.setPolicy("s", { permission: "readonly", workspaceRoot: root });
  await expect(execute("write", { path: "new.md", content: "blocked" })).rejects.toThrow("denied");
  expect(existsSync(path.join(root, "new.md"))).toBe(false);
  expect(gateway.pendingIds("s")).toEqual([]);
});
