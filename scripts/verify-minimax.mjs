#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const outDir = path.resolve(root, "output/verify-minimax");
await fs.mkdir(outDir, { recursive: true });

const serverProc = spawn("pnpm", ["--filter", "@marginalia/pi-server", "start"], {
  cwd: root,
  stdio: ["ignore", "pipe", "inherit"]
});

const portPromise = new Promise((resolve, reject) => {
  let stash = "";
  const onClose = (code) => reject(new Error(`pi-server exited early (${code})`));
  serverProc.on("exit", onClose);
  serverProc.stdout.on("data", (chunk) => {
    stash += chunk.toString();
    for (const line of stash.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) continue;
      try {
        const evt = JSON.parse(trimmed);
        if (evt.type === "ready" && typeof evt.port === "number") {
          serverProc.off("exit", onClose);
          resolve(evt.port);
          return;
        }
      } catch {}
    }
  });
});

function fetchJson(url, init) {
  return fetch(url, init).then(async (r) => {
    if (!r.ok) throw new Error(`${url}: ${r.status} ${await r.text()}`);
    return r.json();
  });
}

async function readSse(response) {
  if (!response.body) return [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let i = buffer.indexOf("\n\n");
    while (i >= 0) {
      const raw = buffer.slice(0, i);
      buffer = buffer.slice(i + 2);
      const data = raw
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("");
      if (data) events.push(JSON.parse(data));
      i = buffer.indexOf("\n\n");
    }
  }
  return events;
}

let exitCode = 0;
try {
  const port = await portPromise;
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try {
      const h = await fetch(`${base}/health`);
      if (h.ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }

  const providers = await fetchJson(`${base}/providers`);
  const minimax = providers.find((p) => /minimax/i.test(p.name));
  if (!minimax) throw new Error("Minimax provider not configured in ~/.marginalia/db.sqlite");

  const workspaces = await fetchJson(`${base}/workspaces`);
  let workspace = workspaces[0];
  if (!workspace) {
    workspace = await fetchJson(`${base}/workspaces`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "verify-default", rootDir: outDir })
    });
  }

  const session = await fetchJson(`${base}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ workspaceId: workspace.id, title: "verify-minimax", origin: "verify" })
  });

  async function run(message) {
    const response = await fetch(`${base}/sessions/${session.id}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ providerId: minimax.id, model: minimax.defaultModel, message })
    });
    if (!response.ok) throw new Error(`run failed: ${await response.text()}`);
    return readSse(response);
  }

  console.log("Turn 1: 用一句话介绍你自己…");
  const turn1 = await run("用一句话介绍你自己。");
  await fs.writeFile(path.join(outDir, "turn1-events.json"), JSON.stringify(turn1, null, 2));

  console.log("Turn 2: 再讲一个冷笑话…");
  const turn2 = await run("再讲一个冷笑话。");
  await fs.writeFile(path.join(outDir, "turn2-events.json"), JSON.stringify(turn2, null, 2));

  const messages = await fetchJson(`${base}/sessions/${session.id}/messages`);
  await fs.writeFile(path.join(outDir, "messages.json"), JSON.stringify(messages, null, 2));

  function lastAssistant(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return messages[i].content;
    }
    return "(missing)";
  }
  const replies = messages.filter((m) => m.role === "assistant").map((m) => m.content);

  const summary = [
    "# verify-minimax 2026-05-26",
    "",
    `- pi-server port: ${port}`,
    `- session id: ${session.id}`,
    `- workspace: ${workspace.name} (${workspace.rootDir})`,
    `- provider: ${minimax.name} (${minimax.defaultModel})`,
    "",
    "## Turn 1: 用一句话介绍你自己。",
    "",
    "```",
    replies[0] ?? "(missing)",
    "```",
    "",
    "## Turn 2: 再讲一个冷笑话。",
    "",
    "```",
    replies[1] ?? lastAssistant(messages),
    "```",
    "",
    `Total events captured: ${turn1.length + turn2.length}`,
    ""
  ].join("\n");
  await fs.writeFile(path.join(outDir, "2026-05-26.md"), summary);
  console.log("verify-minimax: OK →", path.join(outDir, "2026-05-26.md"));
} catch (error) {
  console.error("verify-minimax failed:", error);
  exitCode = 1;
} finally {
  serverProc.kill();
  process.exit(exitCode);
}
