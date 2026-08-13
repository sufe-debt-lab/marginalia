import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ChatEntry } from "@marginalia/chat-core";
import { MessageStream } from "./MessageStream.js";

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
};

const user = (id: string, content: string): ChatEntry => ({
  id,
  message: { role: "user", content, timestamp: 1 }
});

const assistant = (id: string, text: string): ChatEntry => ({
  id,
  message: {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "anthropic-messages",
    provider: "minimax-cn",
    model: "MiniMax-M2.7",
    usage,
    stopReason: "stop",
    timestamp: 2
  }
});

describe("MessageStream", () => {
  it("renders empty state when no messages", () => {
    render(<MessageStream messages={[]} error={null} onRetry={() => {}} />);
    expect(screen.getByText(/no messages/i)).toBeInTheDocument();
  });

  it("renders messages", () => {
    render(
      <MessageStream
        messages={[user("1", "hi"), assistant("2", "yo")]}
        error={null}
        onRetry={() => {}}
      />
    );
    expect(screen.getByText("hi")).toBeInTheDocument();
    expect(screen.getByText("yo")).toBeInTheDocument();
  });

  it("scrolls to the bottom as the last message streams in", () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    const { rerender } = render(
      <MessageStream messages={[assistant("1", "a")]} error={null} onRetry={() => {}} streaming />
    );
    const before = scrollSpy.mock.calls.length;
    rerender(
      <MessageStream
        messages={[assistant("1", "ab cd")]}
        error={null}
        onRetry={() => {}}
        streaming
      />
    );
    expect(scrollSpy.mock.calls.length).toBeGreaterThan(before);
  });

  it("scrolls to the bottom when an approval card appears on a bare tool call", () => {
    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    const toolCallEntry: ChatEntry = {
      id: "a1",
      message: {
        role: "assistant",
        content: [
          { type: "toolCall", id: "tc1", name: "bash", arguments: { command: "python x.py" } }
        ],
        api: "anthropic-messages",
        provider: "minimax-cn",
        model: "MiniMax-M2.7",
        usage,
        stopReason: "toolUse",
        timestamp: 2
      }
    };
    const { rerender } = render(
      <MessageStream messages={[toolCallEntry]} error={null} onRetry={() => {}} streaming />
    );
    const before = scrollSpy.mock.calls.length;
    rerender(
      <MessageStream
        messages={[toolCallEntry]}
        error={null}
        onRetry={() => {}}
        streaming
        approvalsByToolCallId={
          new Map([
            [
              "tc1",
              {
                id: "ap-1",
                toolCallId: "tc1",
                toolName: "bash",
                kind: "command" as const,
                status: "pending" as const,
                payload: { kind: "command" as const, command: "python x.py", cwd: "/ws" }
              }
            ]
          ])
        }
      />
    );
    expect(scrollSpy.mock.calls.length).toBeGreaterThan(before);
  });

  it("renders error row + retry button", async () => {
    const onRetry = vi.fn();
    render(
      <MessageStream
        messages={[user("1", "hi")]}
        error={{ message: "boom", accepted: true, retryable: true }}
        onRetry={onRetry}
      />
    );
    expect(screen.getByText(/boom/)).toBeInTheDocument();
    expect(screen.getByText("Run failed")).toBeInTheDocument();
    expect(screen.queryByText("run_failed")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("attaches toolResult entries to prior assistant tool calls", () => {
    const { container } = render(
      <MessageStream
        messages={[
          {
            id: "a1",
            message: {
              role: "assistant",
              content: [
                {
                  type: "toolCall",
                  id: "tc1",
                  name: "read",
                  arguments: { path: "package.json" }
                }
              ],
              api: "anthropic-messages",
              provider: "minimax-cn",
              model: "MiniMax-M2.7",
              usage,
              stopReason: "toolUse",
              timestamp: 2
            }
          },
          {
            id: "tr1",
            message: {
              role: "toolResult",
              toolCallId: "tc1",
              toolName: "read",
              content: [{ type: "text", text: "done output" }],
              isError: false,
              timestamp: 3
            }
          }
        ]}
        error={null}
        onRetry={() => {}}
      />
    );

    expect(screen.getByText("read")).toBeInTheDocument();
    expect(screen.getByText("done output")).toBeInTheDocument();
    expect(within(container).getAllByText("assistant")).toHaveLength(1);
  });
});
