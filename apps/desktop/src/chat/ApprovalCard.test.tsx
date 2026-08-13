import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalCard } from "./ApprovalCard.js";
import type { Approval } from "@/api/client.js";

const commandApproval: Approval = {
  id: "ap-1",
  toolCallId: "t1",
  toolName: "bash",
  kind: "command",
  status: "pending",
  payload: { kind: "command", command: "python gen.py", cwd: "/ws" }
};

const editApproval: Approval = {
  id: "ap-2",
  toolCallId: "t2",
  toolName: "edit",
  kind: "file_edit",
  status: "pending",
  payload: {
    kind: "file_edit",
    path: "a.md",
    mode: "edit",
    patch: "@@ -1 +1 @@\n-old\n+new",
    additions: 1,
    deletions: 1,
    exact: false
  }
};

describe("ApprovalCard", () => {
  beforeEach(() => {
    cleanup();
  });

  it("approves a command, forwarding the prefix checkbox", async () => {
    const onDecide = vi.fn();
    render(<ApprovalCard approval={commandApproval} onDecide={onDecide} />);
    expect(screen.getByText("python gen.py")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: /allow|允许/i }));
    expect(onDecide).toHaveBeenCalledWith({ approved: true, alwaysAllowPrefix: true });
  });

  it("submits an approval only once and disables decisions immediately", async () => {
    const onDecide = vi.fn(() => new Promise<void>(() => {}));
    render(<ApprovalCard approval={commandApproval} onDecide={onDecide} />);
    const allow = screen.getByRole("button", { name: /allow|允许/i });

    await userEvent.dblClick(allow);

    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(allow).toBeDisabled();
    expect(screen.getByRole("button", { name: /deny|拒绝/i })).toBeDisabled();
  });

  it("re-enables decisions when submission fails", async () => {
    const onDecide = vi.fn().mockRejectedValue(new Error("request failed"));
    render(<ApprovalCard approval={commandApproval} onDecide={onDecide} />);
    const allow = screen.getByRole("button", { name: /allow|允许/i });

    await userEvent.click(allow);

    await waitFor(() => expect(allow).toBeEnabled());
    expect(screen.getByRole("button", { name: /deny|拒绝/i })).toBeEnabled();
  });

  it("denies with an optional reason after a two-step flow", async () => {
    const onDecide = vi.fn();
    render(<ApprovalCard approval={commandApproval} onDecide={onDecide} />);
    await userEvent.click(screen.getByRole("button", { name: /deny|拒绝/i }));
    await userEvent.type(screen.getByRole("textbox"), "改用只读方式");
    await userEvent.click(screen.getByRole("button", { name: /confirm|确认/i }));
    expect(onDecide).toHaveBeenCalledWith({ approved: false, reason: "改用只读方式" });
  });

  it("submits a denial only once and disables the form immediately", async () => {
    const onDecide = vi.fn(() => new Promise<void>(() => {}));
    render(<ApprovalCard approval={commandApproval} onDecide={onDecide} />);
    await userEvent.click(screen.getByRole("button", { name: /deny|拒绝/i }));
    const confirm = screen.getByRole("button", { name: /confirm|确认/i });

    await userEvent.dblClick(confirm);

    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(confirm).toBeDisabled();
    expect(screen.getByRole("button", { name: /cancel|取消/i })).toBeDisabled();
    expect(screen.getByRole("textbox")).toBeDisabled();
  });

  it("renders the diff and the approximate badge for file edits", () => {
    render(<ApprovalCard approval={editApproval} onDecide={() => {}} />);
    expect(screen.getByText("+new")).toBeInTheDocument();
    expect(screen.getByText(/approximate|近似/i)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});
