import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useStreamingChat } from "./useStreamingChat.js";
import type { ApiClient } from "@/api/client.js";

function apiWithEvents(events: Array<Record<string, unknown>>): ApiClient {
  return {
    runChat: vi.fn(async () =>
      (async function* () {
        for (const e of events) yield e;
      })()
    )
  } as unknown as ApiClient;
}

const noop = () => {};
const baseOpts = {
  sessionId: "s1",
  providerId: "p",
  model: "m",
  onUserAppend: noop,
  onAssistantStart: noop,
  onAssistantReplace: noop,
  onAssistantDelta: noop,
  onComplete: noop,
  onAccepted: noop,
  onError: noop
};

describe("useStreamingChat approvals", () => {
  it("forwards approval envelopes to the callbacks", async () => {
    const requested = vi.fn();
    const resolved = vi.fn();
    const api = apiWithEvents([
      { type: "run_started", payload: {} },
      {
        type: "approval_requested",
        payload: {
          approval: {
            approvalId: "ap-1",
            toolCallId: "t1",
            toolName: "bash",
            payload: { kind: "command", command: "x", cwd: "/" }
          }
        }
      },
      {
        type: "approval_resolved",
        payload: {
          approval: {
            approvalId: "ap-1",
            toolCallId: "t1",
            approved: false,
            reason: "不要",
            expired: false
          }
        }
      },
      { type: "run_completed", payload: {} }
    ]);
    const { result } = renderHook(() =>
      useStreamingChat({
        ...baseOpts,
        api,
        onApprovalRequested: requested,
        onApprovalResolved: resolved
      })
    );
    await act(() => result.current.send({ text: "hi", contextFiles: [], skills: [] }));
    expect(requested).toHaveBeenCalledWith(
      expect.objectContaining({ approvalId: "ap-1", toolCallId: "t1", toolName: "bash" })
    );
    expect(resolved).toHaveBeenCalledWith(
      expect.objectContaining({ approvalId: "ap-1", approved: false, reason: "不要" })
    );
  });
});
