import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatView } from "./ChatView.js";

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...init.headers }
  });
}

function sseResponse(chunks: string[]) {
  return new Response(chunks.map((c) => `data: ${c}\n\n`).join(""), {
    headers: { "content-type": "text/event-stream" }
  });
}

describe("ChatView", () => {
  beforeEach(() => cleanup());

  it("streams assistant deltas incrementally and lets the user pick a provider", async () => {
    global.fetch = vi.fn(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/providers")) {
        return jsonResponse([
          { id: "openai-1", name: "OpenAI", defaultModel: "gpt-4.1" },
          { id: "mm-1", name: "Minimax", defaultModel: "MiniMax-M2.7" }
        ]);
      }
      if (url.endsWith("/sessions/s1/messages")) return jsonResponse([]);
      if (url.endsWith("/sessions/s1") && init?.method === "PATCH") return jsonResponse({ id: "s1" });
      if (url.endsWith("/sessions/s1/runs")) {
        return sseResponse([
          '{"type":"run_started","payload":{"model":"MiniMax-M2.7"}}',
          '{"type":"assistant_delta","payload":{"text":"hel"}}',
          '{"type":"assistant_delta","payload":{"text":"lo"}}',
          '{"type":"run_completed","payload":{}}'
        ]);
      }
      return jsonResponse({});
    });

    render(
      <ChatView
        serverUrl="http://server"
        session={{ id: "s1", workspaceId: "w1", title: "Chat", origin: "desktop" }}
      />
    );

    fireEvent.change(await screen.findByLabelText("Provider"), { target: { value: "mm-1" } });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "say hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("hello")).toBeInTheDocument();
    expect(screen.getByText("say hi")).toBeInTheDocument();
  });

  it("shows retry after a run error", async () => {
    global.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.endsWith("/providers")) return jsonResponse([{ id: "mm-1", name: "Minimax", defaultModel: "MiniMax-M2.7" }]);
      if (url.endsWith("/sessions/s1/messages")) return jsonResponse([]);
      if (url.endsWith("/sessions/s1/runs")) return jsonResponse({ error: "missing key" }, { status: 400 });
      return jsonResponse({});
    });

    render(
      <ChatView
        serverUrl="http://server"
        session={{ id: "s1", workspaceId: "w1", title: "Chat", origin: "desktop" }}
      />
    );
    fireEvent.change(await screen.findByLabelText("Message"), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.getByText("missing key")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
