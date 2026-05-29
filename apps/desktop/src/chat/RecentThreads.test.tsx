import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient, Session } from "@/api/client.js";
import { useAppStore } from "@/store/app-store.js";
import { RecentThreads } from "./RecentThreads.js";

const NOW = Date.now();

function fakeApi(sessions: Session[]): ApiClient {
  return { listSessions: vi.fn(async () => sessions) } as unknown as ApiClient;
}

function reset() {
  useAppStore.setState({
    view: "new-thread",
    locale: "en",
    activeWorkspaceId: "w1",
    activeSessionId: null
  });
}

describe("RecentThreads", () => {
  beforeEach(() => {
    cleanup();
    reset();
  });

  it("renders recent sessions with relative time + model meta", async () => {
    const api = fakeApi([
      {
        id: "s1",
        workspaceId: "w1",
        title: "first",
        origin: "ui",
        model: "gpt-5.1",
        updatedAt: NOW - 2 * 3600_000
      }
    ]);
    render(<RecentThreads api={api} />);
    await waitFor(() => expect(screen.getByText("first")).toBeInTheDocument());
    expect(screen.getByText(/2h · gpt-5\.1/)).toBeInTheDocument();
  });

  it("renders nothing when there are no sessions", async () => {
    const api = fakeApi([]);
    const { container } = render(<RecentThreads api={api} />);
    await waitFor(() => expect(api.listSessions).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("opens a session into chat on click", async () => {
    const api = fakeApi([
      { id: "s9", workspaceId: "w1", title: "resume me", origin: "ui", model: null }
    ]);
    render(<RecentThreads api={api} />);
    await waitFor(() => screen.getByText("resume me"));
    await userEvent.click(screen.getByText("resume me"));
    expect(useAppStore.getState().activeSessionId).toBe("s9");
    expect(useAppStore.getState().view).toBe("chat");
  });
});
