import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/api/client.js";
import { useAppStore } from "@/store/app-store.js";
import { SettingsView } from "./SettingsView.js";

function fakeApi(): ApiClient {
  return {
    listProviders: vi.fn(async () => [
      { id: "anthropic", name: "Anthropic", defaultModel: "claude-sonnet-4.6" }
    ]),
    createProvider: vi.fn(async (input) => ({ id: "new", ...input })),
    testProvider: vi.fn(async () => ({ ok: true, message: "ok" }))
  } as unknown as ApiClient;
}

describe("SettingsView", () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    useAppStore.setState({ view: "settings", locale: "en" });
    window.marginalia = {
      getPiServerStatus: vi.fn(async () => ({ status: "ready" as const, url: "http://127.0.0.1:4312" })),
      restartPiServer: vi.fn(async () => ({ status: "ready" as const, url: "http://127.0.0.1:4312" }))
    };
  });

  it("shows the General pane by default and switches locale", async () => {
    render(<SettingsView api={fakeApi()} />);
    await userEvent.click(screen.getByRole("button", { name: "中文" }));
    expect(useAppStore.getState().locale).toBe("zh");
  });

  it("switches to the Providers pane and lists providers", async () => {
    render(<SettingsView api={fakeApi()} />);
    await userEvent.click(screen.getByRole("button", { name: /providers/i }));
    await waitFor(() => expect(screen.getByText("Anthropic")).toBeInTheDocument());
  });

  it("opens the add-provider dialog", async () => {
    render(<SettingsView api={fakeApi()} />);
    await userEvent.click(screen.getByRole("button", { name: /providers/i }));
    await userEvent.click(screen.getByRole("button", { name: /add provider/i }));
    await waitFor(() => expect(screen.getByLabelText(/api key/i)).toBeInTheDocument());
  });
});
