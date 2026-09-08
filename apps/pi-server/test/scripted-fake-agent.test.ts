import { describe, expect, it } from "vitest";
import { ScriptedFakeAgentClient } from "../src/agent/scripted-fake-agent.js";

const baseInput = {
  sessionId: "s1",
  workspaceRoot: "/ws",
  piProviderId: "openai",
  modelId: "gpt"
};

describe("ScriptedFakeAgentClient", () => {
  it("emits a command approval script for approval-bash prompts", async () => {
    const client = new ScriptedFakeAgentClient();
    const execution = (await client.prepare(baseInput)).start("please approval-bash");
    const types: string[] = [];
    for await (const event of execution.events) {
      const type = (event as { type?: string }).type ?? "";
      types.push(type);
      if (type === "approval_requested") {
        const id = (event as { approvalId: string }).approvalId;
        client.resolveApproval("s1", id, { approved: true });
      }
    }
    expect(types).toContain("approval_requested");
    expect(types).toContain("approval_resolved");
    expect(types.at(-1)).toBe("message_end");
  });

  it("replies with plain text otherwise", async () => {
    const client = new ScriptedFakeAgentClient();
    const execution = (await client.prepare(baseInput)).start("hello");
    const types: string[] = [];
    for await (const event of execution.events) types.push((event as { type?: string }).type ?? "");
    expect(types).not.toContain("approval_requested");
    expect(types).toContain("message_end");
  });

  it("starts a prepared run only once", async () => {
    const client = new ScriptedFakeAgentClient();
    const prepared = await client.prepare(baseInput);
    const execution = prepared.start("hello");

    expect(() => prepared.start("please approval-bash")).toThrow("prepared run already started");
    execution.abort();
    await execution.settled;
  });
});
