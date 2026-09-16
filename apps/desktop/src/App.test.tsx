import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppStore } from "@/store/app-store.js";
import { App } from "./App.js";

describe("App", () => {
  beforeEach(() => {
    cleanup();
    useAppStore.setState({ locale: "en" });
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
        url: "http://127.0.0.1:4312",
        capabilityToken: "secret-token"
      })),
      restartPiServer: vi.fn()
    };

    render(<App />);

    await waitFor(() => expect(screen.getByRole("main")).toBeInTheDocument());
    expect(global.fetch).toHaveBeenCalledWith("http://127.0.0.1:4312/health");
  });

  it("shows an error when the desktop bridge is unavailable", async () => {
    render(<App />);

    expect(
      screen.getByText("The local service is unavailable. Retry to restart it.")
    ).toBeInTheDocument();
    expect(window.marginalia).toBeUndefined();
  });

  it("polls while pi-server is still starting", async () => {
    window.marginalia = {
      getPiServerStatus: vi
        .fn()
        .mockResolvedValueOnce({ status: "starting" as const })
        .mockResolvedValueOnce({
          status: "ready" as const,
          url: "http://127.0.0.1:4312",
          capabilityToken: "secret-token"
        }),
      restartPiServer: vi.fn()
    };

    render(<App />);

    const splash = await screen.findByRole("status", { name: "Starting pi-server..." });
    expect(splash).toHaveTextContent("Marginalia");
    await waitFor(() => expect(window.marginalia?.getPiServerStatus).toHaveBeenCalledTimes(1));

    await waitFor(() => expect(screen.getByRole("main")).toBeInTheDocument());
    expect(window.marginalia.getPiServerStatus).toHaveBeenCalledTimes(2);
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
        url: "http://127.0.0.1:4312",
        capabilityToken: "secret-token"
      }))
    };

    render(<App />);
    await screen.findByText("The local service is unavailable. Retry to restart it.");

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(window.marginalia?.restartPiServer).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole("main")).toBeInTheDocument());
  });

  it("shows retry UI when health check fails", async () => {
    window.marginalia = {
      getPiServerStatus: vi.fn(async () => ({
        status: "ready" as const,
        url: "http://127.0.0.1:4312",
        capabilityToken: "secret-token"
      })),
      restartPiServer: vi.fn()
    };
    global.fetch = vi.fn(async () => new Response("boom", { status: 500 }));

    render(<App />);

    await screen.findByText("The local service is unavailable. Retry to restart it.");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("does not accept a browser debug bearer from the query string", async () => {
    window.history.replaceState(
      {},
      "",
      "/?serverUrl=http://127.0.0.1:4312&capabilityToken=query-token"
    );

    render(<App />);

    expect(
      screen.getByText("The local service is unavailable. Retry to restart it.")
    ).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(new URLSearchParams(window.location.search).has("capabilityToken")).toBe(false);
  });

  it("requires both the browser debug server query and token fragment", async () => {
    window.history.replaceState({}, "", "/?serverUrl=http://127.0.0.1:4312");

    render(<App />);

    expect(
      screen.getByText("The local service is unavailable. Retry to restart it.")
    ).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("uses the browser debug token fragment and clears it immediately", async () => {
    window.history.replaceState(
      {},
      "",
      "/?serverUrl=http://127.0.0.1:4312#capabilityToken=debug-token"
    );

    render(<App />);

    await waitFor(() => expect(screen.getByRole("main")).toBeInTheDocument());
    expect(global.fetch).toHaveBeenCalledWith("http://127.0.0.1:4312/health");
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
  });
  it("notices a server exit after ready and restarts through Retry", async () => {
    let failed = false;
    window.marginalia = {
      getPiServerStatus: vi.fn(async () =>
        failed
          ? { status: "failed" as const, error: "pi-server exited", logs: [] }
          : { status: "ready" as const, url: "http://127.0.0.1:4312", capabilityToken: "fixture" }
      ),
      restartPiServer: vi.fn(async () => {
        failed = false;
        return {
          status: "ready" as const,
          url: "http://127.0.0.1:4313",
          capabilityToken: "new-fixture"
        };
      })
    };
    render(<App />);
    await screen.findByRole("main");
    failed = true;
    await screen.findByText(
      "The local service stopped. Restart it to continue. Saved messages and files are kept.",
      {},
      { timeout: 2500 }
    );
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("main");
    expect(window.marginalia.restartPiServer).toHaveBeenCalledTimes(1);
  });
  it("localizes shutdown errors instead of showing raw IPC diagnostics", async () => {
    useAppStore.setState({ locale: "zh" });
    window.marginalia = {
      getPiServerStatus: vi.fn(async () => ({
        status: "failed" as const,
        error: "pi-server shutdown timed out",
        logs: []
      })),
      restartPiServer: vi.fn()
    };
    render(<App />);
    await screen.findByText("本地服务暂不可用，请重试以重启服务。");
    expect(screen.queryByText("pi-server shutdown timed out")).not.toBeInTheDocument();
  });
});
