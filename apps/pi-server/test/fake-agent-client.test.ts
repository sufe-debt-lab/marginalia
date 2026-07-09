import { describe, expect, it } from "vitest";
import { FakeAgentClient } from "../src/agent/fake-agent-client.js";
import type { AgentRunEvent, ApprovalRequestedEvent } from "../src/agent/agent-client.js";

const approvalEvent: ApprovalRequestedEvent = {
  type: "approval_requested",
  approvalId: "ap-1",
  sessionId: "s1",
  toolCallId: "t1",
  toolName: "bash",
  payload: { kind: "command", command: "python x.py", cwd: "/ws" }
};

const baseInput = {
  sessionId: "s1",
  workspaceRoot: "/ws",
  piProviderId: "openai",
  modelId: "gpt",
  message: "hi"
};

describe("FakeAgentClient approvals", () => {
  it("pauses the stream at approval_requested until resolveApproval, then emits approval_resolved", async () => {
    const fake = new FakeAgentClient();
    fake.enqueueEvents([
      {
        type: "message_start",
        message: { role: "assistant", content: [] }
      } as unknown as AgentRunEvent,
      approvalEvent,
      {
        type: "message_end",
        message: { role: "assistant", content: [] }
      } as unknown as AgentRunEvent
    ]);
    const result = await fake.run(baseInput);
    const iterator = result.events[Symbol.asyncIterator]();

    expect((await iterator.next()).value).toMatchObject({ type: "message_start" });
    expect((await iterator.next()).value).toMatchObject({ type: "approval_requested" });

    // The stream must not advance while pending.
    let advanced = false;
    const nextPromise = iterator.next().then((r) => {
      advanced = true;
      return r;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(advanced).toBe(false);

    expect(fake.resolveApproval("s1", "ap-1", { approved: true })).toBe(true);
    expect((await nextPromise).value).toMatchObject({ type: "approval_resolved", approved: true });
    expect((await iterator.next()).value).toMatchObject({ type: "message_end" });
    expect((await iterator.next()).done).toBe(true);
  });

  it("cancelPending denies outstanding approvals", async () => {
    const fake = new FakeAgentClient();
    fake.enqueueEvents([approvalEvent]);
    const result = await fake.run(baseInput);
    const iterator = result.events[Symbol.asyncIterator]();
    await iterator.next(); // approval_requested
    const pending = iterator.next();
    expect(fake.cancelPending("s1")).toBe(1);
    expect((await pending).value).toMatchObject({
      type: "approval_resolved",
      approved: false,
      expired: true
    });
  });

  it("resolveApproval returns false for unknown ids", () => {
    const fake = new FakeAgentClient();
    expect(fake.resolveApproval("s1", "nope", { approved: true })).toBe(false);
  });
});
