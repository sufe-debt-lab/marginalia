import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ChatToolResult } from "@marginalia/chat-core";
import { ToolCard } from "./ToolCard.js";

const call = { type: "toolCall" as const, id: "t1", name: "bash", arguments: { command: "x" } };

describe("ToolCard live progress", () => {
  it("shows the tail of live output while running", () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    render(<ToolCard call={call} progress={lines} />);
    expect(screen.getByText("line 19")).toBeInTheDocument();
    // Only the tail is rendered collapsed (last 8 lines).
    expect(screen.queryByText("line 0")).not.toBeInTheDocument();
  });

  it("renders live output as a plain block, not divs nested in a pre", () => {
    render(<ToolCard call={call} progress={"alpha\nbeta"} />);
    expect(screen.getByText("beta").closest("pre")).toBeNull();
  });

  it("hides the live area once a result arrives", () => {
    const result: ChatToolResult = {
      role: "toolResult",
      toolCallId: "t1",
      toolName: "bash",
      content: [{ type: "text", text: "done" }],
      isError: false,
      timestamp: 1
    };
    render(<ToolCard call={call} result={result} progress={"stale output"} />);
    expect(screen.queryByText("stale output")).not.toBeInTheDocument();
  });
});
