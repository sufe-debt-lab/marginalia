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
  modelId: "gpt"
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
    const prepared = await fake.prepare(baseInput);
    const execution = prepared.start("hi");
    const iterator = execution.events[Symbol.asyncIterator]();

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
    await expect(execution.settled).resolves.toBeUndefined();
  });

  it("cancelPending denies outstanding approvals", async () => {
    const fake = new FakeAgentClient();
    fake.enqueueEvents([approvalEvent]);
    const execution = (await fake.prepare(baseInput)).start("hi");
    const iterator = execution.events[Symbol.asyncIterator]();
    await iterator.next(); // approval_requested
    const pending = iterator.next();
    expect(fake.cancelPending("s1")).toBe(1);
    expect((await pending).value).toMatchObject({
      type: "approval_resolved",
      approved: false,
      expired: true
    });
    expect((await iterator.next()).done).toBe(true);
    await expect(execution.settled).resolves.toBeUndefined();
  });

  it("settles abort only after the event iterator unwinds", async () => {
    const fake = new FakeAgentClient();
    const execution = (await fake.prepare(baseInput)).start("hi");
    const iterator = execution.events[Symbol.asyncIterator]();
    let releaseReturn!: () => void;
    iterator.return = () =>
      new Promise<IteratorResult<AgentRunEvent>>((resolve) => {
        releaseReturn = () => resolve({ value: undefined, done: true });
      });
    let settled = false;
    void execution.settled.then(() => {
      settled = true;
    });

    execution.abort();
    await Promise.resolve();

    expect(settled).toBe(false);
    releaseReturn();
    await expect(execution.settled).resolves.toBeUndefined();
  });

  it("starts a prepared run only once", async () => {
    const fake = new FakeAgentClient();
    const prepared = await fake.prepare(baseInput);
    const execution = prepared.start("first");

    expect(() => prepared.start("second")).toThrow("prepared run already started");
    execution.abort();
    await execution.settled;
  });

  it("resolveApproval returns false for unknown ids", () => {
    const fake = new FakeAgentClient();
    expect(fake.resolveApproval("s1", "nope", { approved: true })).toBe(false);
  });
});
