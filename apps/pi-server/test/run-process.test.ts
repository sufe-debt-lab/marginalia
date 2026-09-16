import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, expect, it, vi } from "vitest";
import { migrate } from "../src/db/migrations.js";
import { createProvider, createSession, createWorkspace } from "../src/db/repositories.js";

const children: ChildProcess[] = [];
const roots: string[] = [];
const databases: Database.Database[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await new Promise((resolve) => child.once("exit", resolve));
    }
  }
  for (const db of databases.splice(0)) db.close();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "run-process-"));
  roots.push(root);
  const dbPath = path.join(root, "db.sqlite");
  const db = new Database(dbPath);
  databases.push(db);
  migrate(db);
  const workspace = createWorkspace(db, { name: "Process", rootDir: root });
  const session = createSession(db, {
    workspaceId: workspace.id,
    title: "Process",
    origin: "desktop"
  });
  const provider = createProvider(db, {
    name: "test",
    apiKey: "fixture-only",
    defaultModel: "test"
  });
  return { root, dbPath, db, session, provider };
}

async function start(
  f: ReturnType<typeof fixture>,
  extraEnv: Record<string, string> = {},
  script = "src/index.ts"
) {
  const child = spawn(process.execPath, ["--import", "tsx", script], {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH,
      HOME: f.root,
      USERPROFILE: f.root,
      MARGINALIA_DB_PATH: f.dbPath,
      MARGINALIA_FAKE_AGENT: "1",
      MARGINALIA_CAPABILITY_TOKEN: "process-fixture",
      ...extraEnv
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  children.push(child);
  let output = "";
  let errors = "";
  child.stdout!.on("data", (chunk) => {
    output += String(chunk);
  });
  child.stderr!.on("data", (chunk) => {
    errors += String(chunk);
  });
  await vi.waitFor(
    () => {
      expect(child.exitCode, errors).toBeNull();
      expect(output, errors).toContain('"type":"ready"');
    },
    { timeout: 15000 }
  );
  const ready = output
    .split("\n")
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .find((line) => line?.type === "ready");
  return { child, url: `http://127.0.0.1:${ready.port}` };
}

async function pendingRun(f: ReturnType<typeof fixture>, url: string) {
  const controller = new AbortController();
  const response = await fetch(`${url}/sessions/${f.session.id}/runs`, {
    method: "POST",
    headers: { authorization: "Bearer process-fixture", "content-type": "application/json" },
    body: JSON.stringify({ providerId: f.provider.id, message: "approval-edit" }),
    signal: controller.signal
  });
  expect(response.status).toBe(200);
  const body = response.text().catch(() => "disconnected");
  await vi.waitFor(() =>
    expect(f.db.prepare("select status from approvals").get()).toEqual({ status: "pending" })
  );
  return { controller, body };
}

it("normal server shutdown terminates an active run and expires its approval before exit", async () => {
  const f = fixture();
  const { child, url } = await start(f);
  const run = await pendingRun(f, url);
  child.kill("SIGTERM");
  await vi.waitFor(() => expect(child.exitCode).toBe(0), { timeout: 5000 });
  expect(f.db.prepare("select status, error from runs").get()).toEqual({
    status: "failed",
    error: "app_shutdown"
  });
  expect(f.db.prepare("select status from approvals").get()).toEqual({ status: "expired" });
  await run.body;
}, 25000);

it("ends execution when its desktop owner is forcibly terminated", async () => {
  const f = fixture();
  const owner = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  children.push(owner);
  const { child, url } = await start(f, { MARGINALIA_PARENT_PID: String(owner.pid) });
  const run = await pendingRun(f, url);
  owner.kill("SIGKILL");
  await vi.waitFor(() => expect(child.exitCode).toBe(0), { timeout: 5000 });
  expect(f.db.prepare("select status, error from runs").get()).toEqual({
    status: "failed",
    error: "app_shutdown"
  });
  expect(f.db.prepare("select status from approvals").get()).toEqual({ status: "expired" });
  await run.body;
}, 25000);

it("preserves a live owner's run, then reconciles a killed server idempotently and accepts a new run", async () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.root, "note.md"), "do not replay the pending edit");
  const first = await start(f);
  const run = await pendingRun(f, first.url);
  const original = f.db.prepare("select * from runs").get() as { id: string; owner_pid: number };
  expect(original.owner_pid).toBe(first.child.pid);
  const second = await start(f);
  expect(f.db.prepare("select * from runs").get()).toEqual(original);
  second.child.kill("SIGTERM");
  await vi.waitFor(() => expect(second.child.exitCode).toBe(0));
  expect(f.db.prepare("select * from runs").get()).toEqual(original);
  first.child.kill("SIGKILL");
  await vi.waitFor(() => expect(first.child.signalCode).toBe("SIGKILL"));
  await run.body;
  const restarted = await start(f);
  expect(f.db.prepare("select status, error from runs").get()).toEqual({
    status: "failed",
    error: "run_owner_unavailable"
  });
  expect(f.db.prepare("select status from approvals").get()).toEqual({ status: "expired" });
  const snapshot = f.db.prepare("select * from runs").get();
  const again = await start(f);
  expect(f.db.prepare("select * from runs").get()).toEqual(snapshot);
  again.child.kill("SIGTERM");
  const next = await fetch(`${restarted.url}/sessions/${f.session.id}/runs`, {
    method: "POST",
    headers: { authorization: "Bearer process-fixture", "content-type": "application/json" },
    body: JSON.stringify({ providerId: f.provider.id, message: "继续", permission: "readonly" })
  });
  const text = await next.text();
  expect(text).toContain("run_completed");
  const rows = f.db.prepare("select id, status from runs order by created_at").all();
  expect(rows).toEqual([
    { id: original.id, status: "failed" },
    { id: expect.any(String), status: "completed" }
  ]);
  expect((rows[1] as { id: string }).id).not.toBe(original.id);
  expect(fs.readFileSync(path.join(f.root, "note.md"), "utf8")).toBe(
    "do not replay the pending edit"
  );
}, 30000);

it("disconnecting the SSE consumer fails the run and expires pending approval", async () => {
  const f = fixture();
  const { url } = await start(f);
  const run = await pendingRun(f, url);
  run.controller.abort();
  await run.body;
  await vi.waitFor(() =>
    expect(f.db.prepare("select status, error from runs").get()).toEqual({
      status: "failed",
      error: "connection_closed"
    })
  );
  expect(f.db.prepare("select status from approvals").get()).toEqual({ status: "expired" });
}, 20000);

it("kills an executing real Bash after server SIGKILL before it can overwrite files after restart", async () => {
  const f = fixture();
  const { child, url } = await start(f, {}, "test/fixtures/run-bash-server.ts");
  const response = await fetch(`${url}/sessions/${f.session.id}/runs`, {
    method: "POST",
    headers: { authorization: "Bearer process-fixture", "content-type": "application/json" },
    body: JSON.stringify({
      providerId: f.provider.id,
      permission: "full",
      message: "echo $$ > shell.pid; echo started; sleep 3; echo orphan-write > artifact.md"
    })
  });
  expect(response.status).toBe(200);
  const body = response.text().catch(() => "disconnected");
  const shellFile = path.join(f.root, "shell.pid");
  await vi.waitFor(() => expect(fs.existsSync(shellFile)).toBe(true), { timeout: 10000 });
  try {
    child.kill("SIGKILL");
    await vi.waitFor(() => expect(child.signalCode).toBe("SIGKILL"));
    await body;
    await start(f);
    expect(f.db.prepare("select status, error from runs").get()).toEqual({
      status: "failed",
      error: "run_owner_unavailable"
    });
    fs.writeFileSync(path.join(f.root, "artifact.md"), "new run's version");
    await new Promise((resolve) => setTimeout(resolve, 3500));
    expect(fs.readFileSync(path.join(f.root, "artifact.md"), "utf8")).toBe("new run's version");
  } finally {
    if (process.platform !== "win32") {
      try {
        process.kill(-Number(fs.readFileSync(shellFile, "utf8")), "SIGKILL");
      } catch {
        /* exited */
      }
    }
  }
}, 30000);

it("keeps real Bash behind Ask approval and unavailable in Read-only mode", async () => {
  const f = fixture();
  const { url } = await start(f, {}, "test/fixtures/run-bash-server.ts");
  const run = (permission: string) =>
    fetch(`${url}/sessions/${f.session.id}/runs`, {
      method: "POST",
      headers: { authorization: "Bearer process-fixture", "content-type": "application/json" },
      body: JSON.stringify({
        providerId: f.provider.id,
        permission,
        message: "echo approved > artifact.md"
      })
    });
  const response = await run("ask");
  const body = response.text();
  await vi.waitFor(() =>
    expect(f.db.prepare("select status from approvals").get()).toEqual({ status: "pending" })
  );
  expect(fs.existsSync(path.join(f.root, "artifact.md"))).toBe(false);
  const approval = f.db.prepare("select id from approvals").get() as { id: string };
  const decision = await fetch(`${url}/sessions/${f.session.id}/approvals/${approval.id}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ approved: true })
  });
  expect(decision.status).toBe(200);
  expect(await body).toContain("run_completed");
  expect(fs.readFileSync(path.join(f.root, "artifact.md"), "utf8")).toBe("approved\n");
  fs.writeFileSync(path.join(f.root, "artifact.md"), "preserve");
  const readonly = await run("readonly");
  expect(await readonly.text()).toContain("run_completed");
  expect(fs.readFileSync(path.join(f.root, "artifact.md"), "utf8")).toBe("preserve");
}, 20000);
