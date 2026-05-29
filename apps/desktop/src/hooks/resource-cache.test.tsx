import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/api/client.js";
import { useProviders } from "./useProviders.js";
import { useWorkspaces } from "./useWorkspaces.js";

function Probe({ api }: { api: ApiClient }) {
  const p = useProviders(api);
  const w = useWorkspaces(api);
  return <div data-testid="probe">{`${p.data.length}:${w.data.length}`}</div>;
}

describe("shared resource cache", () => {
  it("fetches each resource once even when multiple components consume it", async () => {
    const api = {
      listProviders: vi.fn(async () => [{ id: "p1", name: "OpenAI", defaultModel: "gpt-4" }]),
      listWorkspaces: vi.fn(async () => [{ id: "w1", name: "A", rootDir: "/a" }])
    } as unknown as ApiClient;

    render(
      <>
        <Probe api={api} />
        <Probe api={api} />
        <Probe api={api} />
      </>
    );

    await waitFor(() => {
      expect((api.listProviders as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
      expect((api.listWorkspaces as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    });
  });
});
