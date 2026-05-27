import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/api/client.js";
import { useProviders } from "./useProviders.js";

describe("useProviders", () => {
  it("loads providers on mount", async () => {
    const api = {
      listProviders: vi.fn(async () => [
        { id: "p1", name: "OpenAI", defaultModel: "gpt-4" }
      ])
    } as unknown as ApiClient;
    const { result } = renderHook(() => useProviders(api));
    await waitFor(() => expect(result.current.data).toHaveLength(1));
  });
});
