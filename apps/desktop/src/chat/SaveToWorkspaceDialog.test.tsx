import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SaveToWorkspaceDialog } from "./SaveToWorkspaceDialog.js";

afterEach(() => cleanup());

describe("SaveToWorkspaceDialog", () => {
  it("saves under the edited file name", async () => {
    const onSave = vi.fn(async () => "saved" as const);
    render(<SaveToWorkspaceDialog open defaultName="a.md" onCancel={() => {}} onSave={onSave} />);
    const input = screen.getByRole("textbox");
    await userEvent.clear(input);
    await userEvent.type(input, "notes/b.md");
    await userEvent.click(screen.getByRole("button", { name: /save|保存/i }));
    expect(onSave).toHaveBeenCalledWith("notes/b.md", false);
  });

  it("submits on Enter in the file name input", async () => {
    const onSave = vi.fn(async () => "saved" as const);
    render(<SaveToWorkspaceDialog open defaultName="a.md" onCancel={() => {}} onSave={onSave} />);
    await userEvent.type(screen.getByRole("textbox"), "{enter}");
    expect(onSave).toHaveBeenCalledWith("a.md", false);
  });

  it("asks before overwriting an existing file", async () => {
    const onSave = vi.fn(
      async (_n: string, overwrite: boolean) =>
        (overwrite ? "saved" : "exists") as "saved" | "exists"
    );
    render(<SaveToWorkspaceDialog open defaultName="a.md" onCancel={() => {}} onSave={onSave} />);
    await userEvent.click(screen.getByRole("button", { name: /save|保存/i }));
    expect(await screen.findByText(/exists|已存在/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /overwrite|覆盖/i }));
    expect(onSave).toHaveBeenLastCalledWith("a.md", true);
  });

  it("freezes the file name that triggered the 409, even if a differing name is in play when the overwrite is confirmed", async () => {
    const onSave = vi.fn(
      async (_n: string, overwrite: boolean) =>
        (overwrite ? "saved" : "exists") as "saved" | "exists"
    );
    const { rerender } = render(
      <SaveToWorkspaceDialog open defaultName="x.md" onCancel={() => {}} onSave={onSave} />
    );
    const input = screen.getByRole("textbox");
    await userEvent.clear(input);
    await userEvent.type(input, "a.md");
    await userEvent.click(screen.getByRole("button", { name: /save|保存/i }));
    expect(await screen.findByText(/exists|已存在/i)).toBeInTheDocument();

    // Simulate the input's backing value potentially differing from the frozen
    // name — e.g. a parent re-render passing a new defaultName while the dialog
    // stays open. The overwrite confirm must still target the exact name that
    // produced the 409 ("a.md"), never re-derive it from current props/state.
    rerender(
      <SaveToWorkspaceDialog open defaultName="different.md" onCancel={() => {}} onSave={onSave} />
    );

    await userEvent.click(screen.getByRole("button", { name: /overwrite|覆盖/i }));
    expect(onSave).toHaveBeenLastCalledWith("a.md", true);
  });
});
