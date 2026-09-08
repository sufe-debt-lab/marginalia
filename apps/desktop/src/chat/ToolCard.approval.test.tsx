import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToolCard } from "./ToolCard.js";
import type { Approval } from "@/api/client.js";

const call = {
  type: "toolCall" as const,
  id: "t1",
  name: "bash",
  arguments: { command: "python x.py" }
};

function approval(status: Approval["status"], reason?: string): Approval {
  return {
    id: "ap-1",
    toolCallId: "t1",
    toolName: "bash",
    kind: "command",
    status,
    reason,
    payload: { kind: "command", command: "python x.py", cwd: "/ws" }
  };
}

describe("ToolCard approvals", () => {
  it("embeds the pending approval card", () => {
    render(<ToolCard call={call} approval={approval("pending")} onDecideApproval={vi.fn()} />);
    expect(screen.getByRole("button", { name: /allow|允许/i })).toBeInTheDocument();
  });

  it("shows a denied badge with the reason", () => {
    render(<ToolCard call={call} approval={approval("denied", "改用只读")} />);
    expect(screen.getByText(/denied|已拒绝/i)).toBeInTheDocument();
    expect(screen.getByText(/改用只读/)).toBeInTheDocument();
  });

  it("shows an expired badge", () => {
    render(<ToolCard call={call} approval={approval("expired")} />);
    expect(screen.getByText(/expired|已过期/i)).toBeInTheDocument();
  });
});
