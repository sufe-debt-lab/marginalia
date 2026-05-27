import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";

describe("App", () => {
  beforeEach(() => {
    cleanup();
    global.fetch = vi.fn(async (input) => {
      const body = String(input).endsWith("/workspaces") ? [] : { status: "ok" };
      return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
    });
  });

  it("renders AppShell when pi-server is ready", async () => {
    window.marginalia = {
      getPiServerStatus: vi.fn(async () => ({ status: "ready" as const, url: "http://127.0.0.1:4312" })),
      restartPiServer: vi.fn()
    };

    render(<App />);

    await waitFor(() => expect(screen.getByRole("main")).toBeInTheDocument());
    expect(global.fetch).toHaveBeenCalledWith("http://127.0.0.1:4312/health");
  });

  it("retries a failed pi-server start", async () => {
    window.marginalia = {
      getPiServerStatus: vi.fn(async () => ({ status: "failed" as const, error: "boom", logs: [] })),
      restartPiServer: vi.fn(async () => ({ status: "ready" as const, url: "http://127.0.0.1:4312" }))
    };

    render(<App />);
    await screen.findByText("boom");

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(window.marginalia?.restartPiServer).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("main")).toBeInTheDocument());
  });

  it("shows retry UI when health check fails", async () => {
    window.marginalia = {
      getPiServerStatus: vi.fn(async () => ({ status: "ready" as const, url: "http://127.0.0.1:4312" })),
      restartPiServer: vi.fn()
    };
    global.fetch = vi.fn(async () => new Response("boom", { status: 500 }));

    render(<App />);

    await screen.findByText(/health check failed/i);
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
