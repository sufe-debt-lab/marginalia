import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceChip } from "./WorkspaceChip.js";

afterEach(() => cleanup());

const workspaces = [
  { id: "w1", name: "alpha", rootDir: "/a" },
  { id: "w2", name: "beta", rootDir: "/b" }
];

describe("WorkspaceChip", () => {
  it("shows active workspace name or placeholder", () => {
    const { rerender } = render(
      <WorkspaceChip workspaces={workspaces} activeId="w1" onSelect={() => {}} onNew={() => {}} />
    );
    expect(screen.getByRole("button", { name: /alpha/i })).toBeInTheDocument();
    rerender(
      <WorkspaceChip workspaces={workspaces} activeId={null} onSelect={() => {}} onNew={() => {}} />
    );
    expect(screen.getByRole("button", { name: /select workspace/i })).toBeInTheDocument();
  });

  it("selects a workspace from dropdown", async () => {
    const onSelect = vi.fn();
    render(
      <WorkspaceChip workspaces={workspaces} activeId="w1" onSelect={onSelect} onNew={() => {}} />
    );
    await userEvent.click(screen.getByRole("button", { name: /alpha/i }));
    await userEvent.click(screen.getByText("beta"));
    expect(onSelect).toHaveBeenCalledWith("w2");
  });
});
