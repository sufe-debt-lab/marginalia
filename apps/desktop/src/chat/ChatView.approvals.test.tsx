// 关键断言：打开会话时 listApprovals 的持久化结果按 toolCallId 附着到工具卡（重开还原）。
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { emptyUsage } from "@marginalia/chat-core";
import { ChatView } from "./ChatView.js";
import type { ApiClient } from "@/api/client.js";

function fakeApi(): ApiClient {
  return {
    listMessages: vi.fn(async () => [
      {
        id: "m1",
        message: {
          role: "assistant",
          content: [
            { type: "toolCall", id: "t1", name: "bash", arguments: { command: "python x.py" } }
          ],
          api: "x",
          provider: "p",
          model: "m",
          usage: emptyUsage(),
          stopReason: "stop",
          timestamp: 1
        }
      }
    ]),
    listApprovals: vi.fn(async () => [
      {
        id: "ap-1",
        toolCallId: "t1",
        toolName: "bash",
        kind: "command",
        status: "denied",
        reason: "不安全",
        payload: { kind: "command", command: "python x.py", cwd: "/ws" }
      }
    ]),
    listProviders: vi.fn(async () => []),
    searchFiles: vi.fn(async () => []),
    createMessage: vi.fn(),
    runChat: vi.fn()
  } as unknown as ApiClient;
}

describe("ChatView approval restore", () => {
  it("attaches persisted approvals to tool cards on reopen", async () => {
    render(<ChatView api={fakeApi()} sessionId="s1" />);
    expect(await screen.findByText(/denied|已拒绝/i)).toBeInTheDocument();
    expect(screen.getByText(/不安全/)).toBeInTheDocument();
  });
});
