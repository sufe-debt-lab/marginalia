import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";

vi.mock("@/api/desktop-transport.js", () => ({
  desktopPiServerFetch: (input: string, init?: RequestInit) => globalThis.fetch(input, init)
}));

describe("App", () => {
  beforeEach(() => {
    cleanup();
    vi.useRealTimers();
    window.marginalia = undefined;
    window.history.replaceState({}, "", "/");
    global.fetch = vi.fn(async (input) => {
      const body = String(input).endsWith("/workspaces") ? [] : { status: "ok" };
      return new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json" }
      });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders AppShell when pi-server is ready", async () => {
    window.marginalia = {
      getPiServerStatus: vi.fn(async () => ({
        status: "ready" as const,
        url: "marginalia://pi-server"
      })),
      restartPiServer: vi.fn()
    };

    render(<App />);

    await waitFor(() => expect(screen.getByRole("main")).toBeInTheDocument());
    expect(global.fetch).toHaveBeenCalledWith("marginalia://pi-server/health", undefined);
  });

  it("shows an error when the desktop bridge is unavailable", async () => {
    render(<App />);

    expect(screen.getByText("desktop bridge unavailable")).toBeInTheDocument();
    expect(window.marginalia).toBeUndefined();
  });

  it("polls while pi-server is still starting", async () => {
    window.marginalia = {
      getPiServerStatus: vi
        .fn()
        .mockResolvedValueOnce({ status: "starting" as const })
        .mockResolvedValueOnce({
          status: "ready" as const,
          url: "marginalia://pi-server"
        }),
      restartPiServer: vi.fn()
    };

    render(<App />);

    const splash = await screen.findByRole("status", { name: "Starting pi-server..." });
    expect(splash).toHaveTextContent("Marginalia");
    await waitFor(() => expect(window.marginalia?.getPiServerStatus).toHaveBeenCalledTimes(1));

    await waitFor(() => expect(screen.getByRole("main")).toBeInTheDocument());
    expect(window.marginalia?.getPiServerStatus).toHaveBeenCalledTimes(2);
  });

  it("retries a failed pi-server start", async () => {
    window.marginalia = {
      getPiServerStatus: vi.fn(async () => ({
        status: "failed" as const,
        error: "boom",
        logs: []
      })),
      restartPiServer: vi.fn(async () => ({
        status: "ready" as const,
        url: "marginalia://pi-server"
      }))
    };

    render(<App />);
    await screen.findByText("boom");

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(window.marginalia?.restartPiServer).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("main")).toBeInTheDocument());
  });

  it("shows retry UI when health check fails", async () => {
    window.marginalia = {
      getPiServerStatus: vi.fn(async () => ({
        status: "ready" as const,
        url: "marginalia://pi-server"
      })),
      restartPiServer: vi.fn()
    };
    global.fetch = vi.fn(async () => new Response("boom", { status: 500 }));

    render(<App />);

    await screen.findByText(/health check failed/i);
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("does not accept a browser debug bearer from the query string", async () => {
    window.history.replaceState(
      {},
      "",
      "/?serverUrl=http://127.0.0.1:4312&capabilityToken=query-token"
    );

    render(<App />);

    expect(screen.getByText("desktop bridge unavailable")).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(new URLSearchParams(window.location.search).has("capabilityToken")).toBe(false);
  });

  it("requires both the browser debug server query and token fragment", async () => {
    window.history.replaceState({}, "", "/?serverUrl=http://127.0.0.1:4312");

    render(<App />);

    expect(screen.getByText("desktop bridge unavailable")).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects a browser debug token fragment and clears it immediately", async () => {
    window.history.replaceState(
      {},
      "",
      "/?serverUrl=http://127.0.0.1:4312#capabilityToken=debug-token"
    );

    render(<App />);

    expect(screen.getByText("desktop bridge unavailable")).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(new URLSearchParams(window.location.search).get("serverUrl")).toBe(
      "http://127.0.0.1:4312"
    );
    expect(window.location.hash).toBe("");
  });
});
