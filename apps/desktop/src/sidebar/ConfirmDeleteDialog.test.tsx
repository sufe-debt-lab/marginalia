import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog.js";

afterEach(() => cleanup());

describe("ConfirmDeleteDialog", () => {
  it("renders workspace name in description", () => {
    render(
      <ConfirmDeleteDialog
        open
        workspaceName="alpha"
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText(/alpha/i)).toBeInTheDocument();
  });

  it("Confirm calls onConfirm and Cancel calls onClose", async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmDeleteDialog
        open
        workspaceName="alpha"
        onConfirm={onConfirm}
        onClose={onClose}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(onConfirm).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
