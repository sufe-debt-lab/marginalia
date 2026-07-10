import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatToolResult } from "@marginalia/chat-core";
import type { Approval } from "@/api/client.js";
import { ToolCard } from "./ToolCard.js";

const call = {
  type: "toolCall" as const,
  id: "t1",
  name: "bash",
  arguments: { command: "python analyze.py" }
};

function result(text: string, isError = false): ChatToolResult {
  return {
    role: "toolResult",
    toolCallId: "t1",
    toolName: "bash",
    content: [{ type: "text", text }],
    isError,
    timestamp: 1
  };
}

describe("ToolCard", () => {
  beforeEach(() => {
    cleanup();
  });

  it("shows the per-tool summary collapsed", () => {
    render(<ToolCard call={call} />);
    expect(screen.getByText("bash")).toBeInTheDocument();
    expect(screen.getByText("python analyze.py")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /bash/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("expands to full arguments and untruncated output with a copy button", async () => {
    const long = "output ".repeat(100).trim();
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => {}) } });
    render(<ToolCard call={call} result={result(long)} />);
    await userEvent.click(screen.getByRole("button", { name: /bash/ }));
    expect(screen.getByRole("button", { name: /bash/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/"command": "python analyze\.py"/)).toBeInTheDocument();
    expect(screen.getByText(long)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /copy|复制/i }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(long);
    vi.unstubAllGlobals();
  });

  it("keeps running state (no result) with a pulse dot and no output panel", async () => {
    render(<ToolCard call={call} />);
    await userEvent.click(screen.getByRole("button", { name: /bash/ }));
    expect(screen.queryByRole("button", { name: /copy|复制/i })).not.toBeInTheDocument();
  });

  it("shows denied badge together with an error result", () => {
    render(
      <ToolCard
        call={call}
        result={result("blocked", true)}
        approval={{
          id: "ap-1",
          toolCallId: "t1",
          toolName: "bash",
          kind: "command",
          status: "denied",
          reason: "不安全",
          payload: { kind: "command", command: "python analyze.py", cwd: "/ws" }
        }}
      />
    );
    expect(screen.getByText(/denied|已拒绝/i)).toBeInTheDocument();
    expect(screen.getByText(/不安全/)).toBeInTheDocument();
  });

  it("shows a diff stat in the collapsed row for file_edit approvals", () => {
    const editCall = {
      type: "toolCall" as const,
      id: "t2",
      name: "edit",
      arguments: { path: "src/foo.ts" }
    };
    const approval: Approval = {
      id: "ap-2",
      toolCallId: "t2",
      toolName: "edit",
      kind: "file_edit",
      status: "approved",
      payload: {
        kind: "file_edit",
        path: "src/foo.ts",
        mode: "edit",
        patch: "--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1 +1 @@\n-old\n+new\n",
        additions: 1,
        deletions: 1,
        exact: true
      }
    };
    render(<ToolCard call={editCall} approval={approval} />);
    expect(screen.getByText("+1")).toBeInTheDocument();
    expect(screen.getByText("-1")).toBeInTheDocument();
  });
});
