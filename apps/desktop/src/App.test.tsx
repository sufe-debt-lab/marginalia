import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";

describe("App", () => {
  beforeEach(() => {
    cleanup();
    global.fetch = vi.fn(async (input) => {
      const body = String(input).endsWith("/workspaces")
        ? []
        : {
            status: "ok",
            service: "pi-server",
            version: "0.1.0",
            startedAt: "2026-05-25T00:00:00.000Z"
          };
      return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
    });
  });

  it("fetches health and displays ready state when pi-server is ready", async () => {
    window.marginalia = {
      getPiServerStatus: vi.fn(async () => ({ status: "ready" as const, url: "http://127.0.0.1:4312" })),
      restartPiServer: vi.fn()
    };

    render(<App />);

    expect(await screen.findByText("health ok")).toBeInTheDocument();
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
    expect(await screen.findByText("health ok")).toBeInTheDocument();
  });
});
