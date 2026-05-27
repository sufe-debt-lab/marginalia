import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceShell } from "./WorkspaceShell.js";

const serverUrl = "http://127.0.0.1:4312";

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...init.headers }
  });
}

describe("WorkspaceShell", () => {
  beforeEach(() => {
    cleanup();
    window.marginalia = {
      getPiServerStatus: vi.fn(),
      restartPiServer: vi.fn(),
      pickWorkspaceDirectory: vi.fn(async () => "/tmp/docs")
    };
  });

  it("guides workspace creation when quick chat has no recent workspace", async () => {
    global.fetch = vi.fn(async (input, init) => {
      if (String(input).endsWith("/workspaces")) return json([]);
      if (String(input).endsWith("/quick-chat") && init?.method === "POST") {
        return json({ error: "workspace required" }, { status: 409 });
      }
      return json({});
    });

    render(<WorkspaceShell serverUrl={serverUrl} />);
    await userEvent.click(await screen.findByRole("button", { name: "Quick chat" }));

    expect(await screen.findByText("Create a workspace first")).toBeInTheDocument();
  });

  it("uses the preload directory picker to fill the workspace path", async () => {
    global.fetch = vi.fn(async () => json([]));

    render(<WorkspaceShell serverUrl={serverUrl} />);
    await userEvent.click(await screen.findByRole("button", { name: "Browse" }));

    expect(window.marginalia?.pickWorkspaceDirectory).toHaveBeenCalled();
    expect(screen.getByLabelText("Workspace path")).toHaveValue("/tmp/docs");
  });

  it("creates sessions and saves user messages", async () => {
    global.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/workspaces")) {
        if (init?.method === "POST") return json({ id: "w1", name: "Docs", rootDir: "/tmp/docs" }, { status: 201 });
        return json([]);
      }
      if (url.endsWith("/sessions") && init?.method === "POST") {
        return json({ id: "s1", workspaceId: "w1", title: "Read paper", origin: "desktop" }, { status: 201 });
      }
      if (url.endsWith("/workspaces/w1/sessions")) return json([]);
      if (url.endsWith("/sessions/s1/messages") && init?.method === "POST") {
        return json({ id: "m1", role: "user", content: "hello" }, { status: 201 });
      }
      if (url.endsWith("/sessions/s1/messages")) return json([]);
      return json({});
    });

    render(<WorkspaceShell serverUrl={serverUrl} />);
    await userEvent.type(await screen.findByLabelText("Workspace name"), "Docs");
    await userEvent.type(screen.getByLabelText("Workspace path"), "/tmp/docs");
    await userEvent.click(screen.getByRole("button", { name: "Create workspace" }));
    await userEvent.type(await screen.findByLabelText("Session title"), "Read paper");
    await userEvent.click(screen.getByRole("button", { name: "New session" }));
    await userEvent.type(await screen.findByLabelText("Saved message"), "hello");
    await userEvent.click(screen.getByRole("button", { name: "Save message" }));

    await waitFor(() => expect(screen.getByText("hello")).toBeInTheDocument());
  });
});
