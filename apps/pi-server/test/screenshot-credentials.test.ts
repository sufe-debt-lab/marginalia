import Database from "better-sqlite3";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { migrate } from "../src/db/migrations.js";

async function withScreenshotServer(
  home: string,
  database: string | undefined,
  check: (url: string) => Promise<void>
) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    MARGINALIA_SCREENSHOT_VERIFY: "1",
    MARGINALIA_FAKE_AGENT: "1",
    MARGINALIA_LOOPBACK_BEARER: "screenshot-test-token",
    MARGINALIA_ALLOWED_ORIGIN: "null"
  };
  delete env.MARGINALIA_DB_PATH;
  if (database) env.MARGINALIA_DB_PATH = database;
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  let timer: ReturnType<typeof setTimeout>;
  const ready = new Promise<string>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error("screenshot startup timed out")), 8000);
    child.once("error", reject);
    child.once("exit", () => reject(new Error("screenshot startup exited")));
    let buffer = "";
    child.stdout.on("data", (chunk) => {
      buffer += String(chunk);
      const lines = buffer.split("\n");
      buffer = lines.pop()!;
      for (const line of lines) {
        try {
          const message = JSON.parse(line);
          if (message.type === "ready") resolve(`http://127.0.0.1:${message.port}`);
        } catch {
          /* Ignore startup output that is not the ready envelope. */
        }
      }
    });
  });
  try {
    await check(await ready);
  } finally {
    clearTimeout(timer!);
    child.kill("SIGTERM");
    await exited;
  }
}

it.each(["default", "explicit"] as const)(
  "keeps the %s user database untouched across screenshot process restarts",
  async (source) => {
    const home = mkdtempSync(path.join(tmpdir(), "screenshot-credentials-"));
    try {
      mkdirSync(path.join(home, ".marginalia"));
      const file = path.join(
        home,
        source === "default" ? ".marginalia/db.sqlite" : "chosen.sqlite"
      );
      const db = new Database(file);
      migrate(db);
      db.prepare(
        "insert into env_vars (id,key,value,created_at) values ('legacy','OPENAI_API_KEY','old-key-must-survive',1)"
      ).run();
      db.prepare(
        "insert into providers (id,name,api_key_ref,default_model,created_at,updated_at) values ('old','OpenAI','legacy','gpt-4o',1,1)"
      ).run();
      db.close();
      const original = readFileSync(file);
      for (let attempt = 0; attempt < 2; attempt++) {
        await withScreenshotServer(home, source === "explicit" ? file : undefined, async (url) => {
          const headers = {
            authorization: "Bearer screenshot-test-token",
            origin: "null",
            "content-type": "application/json"
          };
          const providers = await (await fetch(`${url}/providers`, { headers })).json();
          expect(providers).toEqual([]);
          const created = await fetch(`${url}/providers`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              name: "OpenAI",
              apiKey: "screenshot-only",
              defaultModel: "gpt-4o"
            })
          });
          expect(created.status).toBe(201);
          const provider = await created.json();
          const probe = await fetch(`${url}/providers/${provider.id}/test`, {
            method: "POST",
            headers
          });
          expect(await probe.json()).toEqual({ ok: true, message: "ok" });
        });
        expect(readFileSync(file)).toEqual(original);
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  },
  20_000
);
