import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ChatEntry, ChatToolResult } from "@marginalia/chat-core";
import { MessageItem } from "./MessageItem.js";

const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
};

describe("MessageItem", () => {
  it("renders user content right-aligned in a pill", () => {
    render(
      <MessageItem entry={{ id: "1", message: { role: "user", content: "hello", timestamp: 1 } }} />
    );
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("renders assistant content as markdown with label", () => {
    const entry: ChatEntry = {
      id: "2",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "**bold**" }],
        api: "anthropic-messages",
        provider: "minimax-cn",
        model: "MiniMax-M2.7",
        usage,
        stopReason: "stop",
        timestamp: 2
      }
    };
    render(<MessageItem entry={entry} />);
    expect(screen.getByText("assistant")).toBeInTheDocument();
    expect(screen.getByText("bold").tagName).toBe("STRONG");
  });

  it("renders assistant tool calls in content order with matched tool results", () => {
    const result: ChatToolResult = {
      role: "toolResult",
      toolCallId: "tc1",
      toolName: "read",
      content: [{ type: "text", text: "package content" }],
      isError: false,
      timestamp: 3
    };
    render(
      <MessageItem
        entry={{
          id: "a1",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "before" },
              { type: "toolCall", id: "tc1", name: "read", arguments: { path: "package.json" } },
              { type: "text", text: "after" }
            ],
            api: "anthropic-messages",
            provider: "minimax-cn",
            model: "MiniMax-M2.7",
            usage,
            stopReason: "toolUse",
            timestamp: 2
          }
        }}
        toolResultsByCallId={new Map([["tc1", result]])}
      />
    );

    expect(screen.getByText("before")).toBeInTheDocument();
    expect(screen.getByText("read")).toBeInTheDocument();
    expect(screen.getByText("package content")).toBeInTheDocument();
    expect(screen.getByText("after")).toBeInTheDocument();
  });
});
