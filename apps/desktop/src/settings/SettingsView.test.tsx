import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/api/client.js";
import { useAppStore } from "@/store/app-store.js";
import { SettingsView } from "./SettingsView.js";
import { toast } from "sonner";

function fakeApi(): ApiClient {
  return {
    listProviders: vi.fn(async () => [
      { id: "anthropic", name: "Anthropic", defaultModel: "claude-sonnet-4.6", enabled: true }
    ]),
    createProvider: vi.fn(async (input) => ({ id: "new", ...input })),
    testProvider: vi.fn(async () => ({ ok: true, message: "ok" })),
    updateProvider: vi.fn(async (id, input) => ({ id, name: "Anthropic", ...input })),
    deleteProvider: vi.fn(async () => undefined),
    listSkills: vi.fn(async (workspaceId: string | null) => ({
      workspaceId,
      catalogRevision: "catalog-1",
      effectiveRevision: "effective-1",
      refreshedAt: 1,
      candidates: [],
      diagnostics: []
    }))
  } as unknown as ApiClient;
}

async function openProvidersPane() {
  await userEvent.click(screen.getByRole("tab", { name: /providers/i }));
  await waitFor(() => expect(screen.getByText("Anthropic")).toBeInTheDocument());
}

describe("SettingsView", () => {
  it.each([
    ["en", "credential_missing", "Enter the Provider API key again in Settings."],
    ["zh", "credential_store_unavailable", "无法访问系统凭据库。请解锁或授权后重试。"]
  ] as const)(
    "localizes %s credential failures with recovery instructions",
    async (locale, code, message) => {
      const api = fakeApi();
      vi.mocked(api.testProvider).mockResolvedValue({ ok: false, message: code });
      const errorToast = vi.spyOn(toast, "error").mockImplementation(() => "test-toast");
      render(<SettingsView api={api} />);
      await openProvidersPane();
      useAppStore.setState({ locale });
      await userEvent.click(
        await screen.findByRole("button", { name: locale === "en" ? "Test" : "测试" })
      );
      expect(errorToast).toHaveBeenCalledWith(message);
      errorToast.mockRestore();
    }
  );
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

  it("does not animate the initial pane but animates user-triggered tab changes", async () => {
    const { container } = render(<SettingsView api={fakeApi()} />);
    expect(container.querySelector(".motion-tab-panel")).toBeNull();

    await userEvent.click(screen.getByRole("tab", { name: /providers/i }));

    await waitFor(() => expect(screen.getByText("Anthropic")).toBeInTheDocument());
    expect(container.querySelector(".motion-tab-panel")).not.toBeNull();
  });

  it("switches to the Providers pane and lists providers", async () => {
    render(<SettingsView api={fakeApi()} />);
    await userEvent.click(screen.getByRole("tab", { name: /providers/i }));
    await waitFor(() => expect(screen.getByText("Anthropic")).toBeInTheDocument());
  });

  it("add-provider opens a preset picker, then a quick-add form", async () => {
    render(<SettingsView api={fakeApi()} />);
    await userEvent.click(screen.getByRole("tab", { name: /providers/i }));
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
    await userEvent.click(screen.getByRole("tab", { name: /providers/i }));
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

  it("enables Skills while MCP stays disabled and refreshes whenever Skills is re-entered", async () => {
    const api = fakeApi();
    render(<SettingsView api={api} skillsWorkspace={{ id: "w1", name: "Research" }} />);
    const skills = screen.getByRole("tab", { name: /^skills$/i });
    const mcp = screen.getByRole("tab", { name: /^mcp$/i });

    expect(skills).toBeEnabled();
    expect(mcp).toBeDisabled();
    await userEvent.click(skills);
    await waitFor(() => expect(api.listSkills).toHaveBeenCalledWith("w1"));
    expect(screen.getByText("Research")).toBeInTheDocument();
    const skillsPane = screen.getByTestId("settings-pane-width");
    expect(skillsPane).toHaveClass("max-w-[920px]");

    await userEvent.click(screen.getByRole("tab", { name: /^general$/i }));
    expect(screen.getByTestId("settings-pane-width")).toHaveClass("max-w-[440px]");
    await userEvent.click(skills);
    await waitFor(() => expect(api.listSkills).toHaveBeenCalledTimes(2));
  });

  it("exposes Settings navigation as tabs and focuses a deep-linked Skills tab", async () => {
    const api = fakeApi();
    render(
      <SettingsView
        api={api}
        skillsWorkspace={{ id: "w1", name: "Research" }}
        initialTab="skills"
      />
    );

    const skills = screen.getByRole("tab", { name: /^skills$/i });
    const panel = screen.getByRole("tabpanel");
    expect(skills).toHaveAttribute("aria-selected", "true");
    expect(skills).toHaveFocus();
    expect(panel).toHaveAttribute("aria-labelledby", skills.id);
    for (const name of [/^general$/i, /^providers$/i, /^skills$/i]) {
      expect(screen.getByRole("tab", { name })).toHaveAttribute("aria-controls", panel.id);
    }
    expect(screen.getByRole("tab", { name: /^mcp$/i })).not.toHaveAttribute("aria-controls");
    await waitFor(() => expect(api.listSkills).toHaveBeenCalledWith("w1"));
  });

  it("moves through enabled Settings tabs with vertical tablist keys", async () => {
    render(<SettingsView api={fakeApi()} skillsWorkspace={{ id: "w1", name: "Research" }} />);

    const general = screen.getByRole("tab", { name: /^general$/i });
    const providers = screen.getByRole("tab", { name: /^providers$/i });
    const skills = screen.getByRole("tab", { name: /^skills$/i });
    expect(general).toHaveFocus();

    await userEvent.keyboard("{ArrowDown}");
    expect(providers).toHaveFocus();
    expect(providers).toHaveAttribute("aria-selected", "true");

    await userEvent.keyboard("{ArrowDown}");
    expect(skills).toHaveFocus();
    expect(skills).toHaveAttribute("aria-selected", "true");

    await userEvent.keyboard("{Home}");
    expect(general).toHaveFocus();
    expect(general).toHaveAttribute("aria-selected", "true");

    await userEvent.keyboard("{End}");
    expect(skills).toHaveFocus();
    expect(skills).toHaveAttribute("aria-selected", "true");
  });
});
