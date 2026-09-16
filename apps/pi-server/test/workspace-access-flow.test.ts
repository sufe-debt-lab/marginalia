import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { AuthStorage } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { createTestApp as createApp } from "./test-app.js";
import { migrate } from "../src/db/migrations.js";
import { createProvider, createSession, createWorkspace } from "../src/db/repositories.js";
import { createSkillCatalogService } from "../src/skills/catalog.js";
import { createSkillPreferenceStore } from "../src/db/skill-preferences.js";
import type { ApprovalRequestedEvent, AgentRunEvent } from "../src/agent/agent-client.js";
import { ScriptedFakeAgentClient } from "../src/agent/scripted-fake-agent.js";

describe("Standard Access HTTP/SSE and persistence", () => {
  it.each(["approve", "deny", "stale"] as const)(
    "preserves file, approval and raw tool identity after %s and reopen",
    async (decision) => {
      const base = mkdtempSync(path.join(os.tmpdir(), "access-flow-"));
      const root = path.join(base, "workspace");
      mkdirSync(root);
      const databasePath = path.join(base, "state.sqlite");
      let db = new Database(databasePath);
      migrate(db);
      const ws = createWorkspace(db, { name: "fixture", rootDir: root });
      const session = createSession(db, {
        workspaceId: ws.id,
        title: "fixture",
        origin: "desktop"
      });
      const provider = createProvider(db, {
        name: "openai",
        apiKey: "fixture-not-a-credential",
        defaultModel: "fixture"
      });
      const client = new ScriptedFakeAgentClient({
        workspaceTools: true,
        sessionDir: path.join(base, "sessions")
      });
      const appFor = () =>
        createApp({
          db,
          agentClient: client,
          authStorage: AuthStorage.inMemory(),
          skillCatalog: createSkillCatalogService({
            homeDir: path.join(base, "home"),
            preferences: createSkillPreferenceStore(db)
          })
        });
      let app = appFor();
      const headers = { "content-type": "application/json" };
      const run = async (
        content: string,
        onApproval?: (event: ApprovalRequestedEvent) => Promise<void>
      ) => {
        const response = await app.request(`/sessions/${session.id}/runs`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            providerId: provider.id,
            permission: "ask",
            message: `workspace-write ${JSON.stringify({ path: "note.md", content })}`
          })
        });
        expect(response.status).toBe(200);
        const events: Array<{
          type: string;
          payload: { approval?: ApprovalRequestedEvent; event?: AgentRunEvent };
        }> = [];
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let pending = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          pending += decoder.decode(value, { stream: true });
          let end;
          while ((end = pending.indexOf("\n\n")) >= 0) {
            const block = pending.slice(0, end);
            pending = pending.slice(end + 2);
            const data = block.split("\n").find((line) => line.startsWith("data: "));
            if (!data) continue;
            const event = JSON.parse(data.slice(6));
            events.push(event);
            if (event.type === "approval_requested") {
              if (!onApproval) throw new Error("New file unexpectedly required approval");
              await onApproval(event.payload.approval);
            }
          }
        }
        return events;
      };
      try {
        await run("created");
        expect(readFileSync(path.join(root, "note.md"), "utf8")).toBe("created");
        let approvalId = "";
        let toolCallId = "";
        const events = await run("replacement", async (event) => {
          approvalId = event.approvalId;
          toolCallId = event.toolCallId;
          expect(event.payload).toMatchObject({
            kind: "file_edit",
            exact: true,
            effect: { kind: "overwrite" }
          });
          if (event.payload.kind !== "file_edit") throw new Error("expected file preview");
          expect(event.payload.patch).toContain("-created");
          expect(readFileSync(path.join(root, "note.md"), "utf8")).toBe("created");
          if (decision === "stale") writeFileSync(path.join(root, "note.md"), "manual edit");
          const response = await app.request(`/sessions/${session.id}/approvals/${approvalId}`, {
            method: "POST",
            headers,
            body: JSON.stringify({ approved: decision !== "deny" })
          });
          expect(response.status).toBe(200);
        });
        const result = events.find(
          (event) =>
            event.type === "agent_event" && event.payload.event?.type === "tool_execution_end"
        );
        expect(result?.payload.event).toMatchObject({
          toolCallId,
          toolName: "write",
          isError: decision !== "approve"
        });
        expect(events.at(-1)?.type).toBe("run_completed");
        const expected =
          decision === "approve" ? "replacement" : decision === "deny" ? "created" : "manual edit";
        expect(readFileSync(path.join(root, "note.md"), "utf8")).toBe(expected);
        db.close();
        db = new Database(databasePath);
        app = appFor();
        const approvals = await (await app.request(`/sessions/${session.id}/approvals`)).json();
        expect(approvals).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: approvalId,
              toolCallId,
              status: decision === "deny" ? "denied" : "approved"
            })
          ])
        );
        const history = await (await app.request(`/sessions/${session.id}/messages`)).json();
        expect(history).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: expect.any(String),
              message: expect.objectContaining({
                role: "toolResult",
                toolCallId,
                isError: decision !== "approve"
              })
            })
          ])
        );
        const preview = await (
          await app.request(`/workspaces/${ws.id}/files/content?path=note.md`)
        ).json();
        expect(preview).toMatchObject({ text: expected });
      } finally {
        client.cancelPending(session.id);
        db.close();
        rmSync(base, { recursive: true, force: true });
      }
    }
  );
});
