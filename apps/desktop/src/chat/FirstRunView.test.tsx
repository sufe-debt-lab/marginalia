import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/api/client.js";
import { useAppStore } from "@/store/app-store.js";
import { FirstRunView } from "./FirstRunView.js";

afterEach(() => cleanup());

function fakeApi(): ApiClient {
  return {
    listWorkspaces: vi.fn(async () => []),
    listProviders: vi.fn(async () => []),
    createWorkspace: vi.fn(async (input: { name: string; rootDir: string }) => ({
      id: "w1",
      ...input
    }))
  } as unknown as ApiClient;
}

describe("FirstRunView", () => {
  beforeEach(() => {
    useAppStore.setState({ view: "new-thread", locale: "en", activeWorkspaceId: null });
    window.marginalia = {
      getPiServerStatus: vi.fn(),
      restartPiServer: vi.fn(),
      pickWorkspaceDirectory: vi.fn(async () => "/picked/proj")
    };
  });

  it("renders the welcome hero + two onboarding steps", async () => {
    render(<FirstRunView api={fakeApi()} />);
    expect(await screen.findByText(/welcome to pi-cowork/i)).toBeInTheDocument();
    expect(screen.getByText("Pick a workspace folder")).toBeInTheDocument();
    expect(screen.getByText("Add a model provider")).toBeInTheDocument();
  });

  it("uses the design's compact logo size", async () => {
    render(<FirstRunView api={fakeApi()} />);
    expect(await screen.findByTestId("first-run-logo")).toHaveClass("h-[70px]", "w-[70px]");
  });

  it("step 1 picks a folder and creates the first workspace", async () => {
    const api = fakeApi();
    render(<FirstRunView api={api} />);
    await userEvent.click(screen.getByRole("button", { name: /choose folder/i }));
    expect(window.marginalia?.pickWorkspaceDirectory).toHaveBeenCalled();
  });

  it("step 2 opens settings", async () => {
    render(<FirstRunView api={fakeApi()} />);
    await userEvent.click(screen.getByRole("button", { name: /open settings/i }));
    expect(useAppStore.getState().view).toBe("settings");
  });
});
