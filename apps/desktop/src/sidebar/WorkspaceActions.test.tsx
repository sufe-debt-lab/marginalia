import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceActions } from "./WorkspaceActions.js";

afterEach(() => cleanup());

const workspace = { id: "w1", name: "alpha", rootDir: "/a" };

describe("WorkspaceActions", () => {
  it("Pin item toggles pin via callback", async () => {
    const onPin = vi.fn();
    render(
      <WorkspaceActions workspace={workspace} pinned={false} onPin={onPin} onDelete={vi.fn()}>
        <button>trigger</button>
      </WorkspaceActions>
    );
    fireEvent.contextMenu(screen.getByText("trigger"));
    await userEvent.click(await screen.findByText(/^pin$/i));
    expect(onPin).toHaveBeenCalledWith("w1");
  });

  it("Delete item triggers callback with workspace", async () => {
    const onDelete = vi.fn();
    render(
      <WorkspaceActions workspace={workspace} pinned={false} onPin={vi.fn()} onDelete={onDelete}>
        <button>trigger</button>
      </WorkspaceActions>
    );
    fireEvent.contextMenu(screen.getByText("trigger"));
    await userEvent.click(await screen.findByText(/^delete$/i));
    expect(onDelete).toHaveBeenCalledWith(workspace);
  });

  it("Shows Unpin label when already pinned", async () => {
    render(
      <WorkspaceActions workspace={workspace} pinned={true} onPin={vi.fn()} onDelete={vi.fn()}>
        <button>trigger</button>
      </WorkspaceActions>
    );
    fireEvent.contextMenu(screen.getByText("trigger"));
    expect(await screen.findByText(/^unpin$/i)).toBeInTheDocument();
  });
});
