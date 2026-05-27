import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentPanel } from "./DocumentPanel.js";

function json(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

describe("DocumentPanel", () => {
  beforeEach(() => cleanup());

  it("shows files opens a reader and attaches a file to chat", async () => {
    const onAttach = vi.fn();
    global.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.endsWith("/workspaces/w1/files")) return json([{ path: "note.md", name: "note.md", kind: "file" }]);
      if (url.includes("/files/content")) return json({ path: "note.md", mime: "text/markdown", text: "# Title", truncated: false });
      return json({});
    });

    render(<DocumentPanel serverUrl="http://server" workspaceId="w1" onAttach={onAttach} />);
    await userEvent.click(await screen.findByRole("button", { name: "note.md" }));

    expect(await screen.findByText("# Title")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Attach to chat" }));
    expect(onAttach).toHaveBeenCalledWith("note.md");
  });
});
