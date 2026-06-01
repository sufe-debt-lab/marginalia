import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ChatToolCall, ChatToolResult } from "@marginalia/chat-core";
import { ToolCard } from "./ToolCard.js";

function call(): ChatToolCall {
  return { type: "toolCall", id: "t1", name: "read", arguments: { path: "docs/spec.md" } };
}

function result(isError = false): ChatToolResult {
  return {
    role: "toolResult",
    toolCallId: "t1",
    toolName: "read",
    content: [{ type: "text", text: isError ? "failed" : "done" }],
    isError,
    timestamp: 1
  };
}

describe("ToolCard", () => {
  it("renders tool name + subtitle", () => {
    const { container } = render(<ToolCard call={call()} />);
    expect(screen.getByText("read")).toBeInTheDocument();
    expect(screen.getByText("docs/spec.md")).toBeInTheDocument();
    expect(container.querySelector(".dot.ok.pulse")).not.toBeNull();
  });

  it("shows an error dot when failed", () => {
    const { container } = render(<ToolCard call={call()} result={result(true)} />);
    expect(container.querySelector(".dot.err")).not.toBeNull();
    expect(screen.getByText("failed")).toBeInTheDocument();
  });

  it("shows a solid ok dot when done", () => {
    const { container } = render(<ToolCard call={call()} result={result()} />);
    const dot = container.querySelector(".dot.ok");
    expect(dot).not.toBeNull();
    expect(dot?.classList.contains("pulse")).toBe(false);
    expect(screen.getByText("done")).toBeInTheDocument();
  });
});
