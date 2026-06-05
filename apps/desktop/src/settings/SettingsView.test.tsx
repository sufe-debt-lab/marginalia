import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/api/client.js";
import { useAppStore } from "@/store/app-store.js";
import { SettingsView } from "./SettingsView.js";

function fakeApi(): ApiClient {
  return {
    listProviders: vi.fn(async () => [
      { id: "anthropic", name: "Anthropic", defaultModel: "claude-sonnet-4.6", enabled: true }
    ]),
    createProvider: vi.fn(async (input) => ({ id: "new", ...input })),
    testProvider: vi.fn(async () => ({ ok: true, message: "ok" })),
    updateProvider: vi.fn(async (id, input) => ({ id, name: "Anthropic", ...input })),
    deleteProvider: vi.fn(async () => undefined)
  } as unknown as ApiClient;
}

async function openProvidersPane() {
  await userEvent.click(screen.getByRole("button", { name: /providers/i }));
  await waitFor(() => expect(screen.getByText("Anthropic")).toBeInTheDocument());
}

describe("SettingsView", () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    useAppStore.setState({ view: "settings", locale: "en" });
    window.marginalia = {
      getPiServerStatus: vi.fn(async () => ({
        status: "ready" as const,
        url: "http://127.0.0.1:4312"
      })),
      restartPiServer: vi.fn(async () => ({
        status: "ready" as const,
        url: "http://127.0.0.1:4312"
      }))
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

  it("add-provider opens a preset picker, then a quick-add form", async () => {
    render(<SettingsView api={fakeApi()} />);
    await userEvent.click(screen.getByRole("button", { name: /providers/i }));
    await userEvent.click(screen.getByRole("button", { name: /add provider/i }));
    // preset cards first — scope to the dialog (the "Others" list also lists OpenAI)
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByText("OpenAI"));
    // choosing a preset reveals the API key field (name prefilled)
    await waitFor(() => expect(screen.getByLabelText(/api key/i)).toBeInTheDocument());
    expect((screen.getByLabelText(/^name$/i) as HTMLInputElement).value).toBe("OpenAI");
  });

  it("shows each provider default model", async () => {
    render(<SettingsView api={fakeApi()} />);
    await userEvent.click(screen.getByRole("button", { name: /providers/i }));
    await waitFor(() => expect(screen.getByText("claude-sonnet-4.6")).toBeInTheDocument());
    expect(screen.getByText(/^default$/i)).toBeInTheDocument();
  });

  it("edits a provider and patches via the api", async () => {
    const api = fakeApi();
    render(<SettingsView api={api} />);
    await openProvidersPane();

    await userEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    const dialog = await screen.findByRole("dialog");
    expect((within(dialog).getByLabelText(/^name$/i) as HTMLInputElement).value).toBe("Anthropic");

    const modelInput = within(dialog).getByLabelText(/default model/i);
    await userEvent.clear(modelInput);
    await userEvent.type(modelInput, "claude-opus-4.8");
    await userEvent.click(within(dialog).getByRole("button", { name: /save/i }));

    expect(api.updateProvider).toHaveBeenCalledWith(
      "anthropic",
      expect.objectContaining({ defaultModel: "claude-opus-4.8" })
    );
    // an empty key field must not overwrite the stored key
    const patch = (api.updateProvider as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] ?? {};
    expect(patch.apiKey).toBeUndefined();
  });

  it("deletes a provider after confirmation", async () => {
    const api = fakeApi();
    render(<SettingsView api={api} />);
    await openProvidersPane();

    await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    const confirm = await screen.findByRole("alertdialog");
    await userEvent.click(within(confirm).getByRole("button", { name: /delete/i }));

    expect(api.deleteProvider).toHaveBeenCalledWith("anthropic");
  });

  it("toggles a provider enabled state via the api", async () => {
    const api = fakeApi();
    render(<SettingsView api={api} />);
    await openProvidersPane();

    await userEvent.click(screen.getByRole("switch", { name: /anthropic/i }));

    expect(api.updateProvider).toHaveBeenCalledWith("anthropic", { enabled: false });
  });
});
