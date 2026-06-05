import { describe, expect, it } from "vitest";
import type { Provider } from "@/api/client.js";
import { resolveComposerSelection } from "./provider-selection.js";

const enabled: Provider[] = [
  { id: "p1", name: "Minimax", defaultModel: "M2.7", enabled: true },
  { id: "p2", name: "OpenAI", defaultModel: "gpt-5.1", enabled: true }
];

describe("resolveComposerSelection", () => {
  it("keeps the stored provider and model when still enabled", () => {
    expect(resolveComposerSelection(enabled, "p2", "gpt-5.1-mini")).toEqual({
      providerId: "p2",
      model: "gpt-5.1-mini"
    });
  });

  it("falls back to the stored provider's default model when no model stored", () => {
    expect(resolveComposerSelection(enabled, "p2", null)).toEqual({
      providerId: "p2",
      model: "gpt-5.1"
    });
  });

  it("falls back to the first enabled provider when the stored id is gone", () => {
    // stored id "p9" was disabled/deleted — must not be used, and its stale model dropped
    expect(resolveComposerSelection(enabled, "p9", "stale-model")).toEqual({
      providerId: "p1",
      model: "M2.7"
    });
  });

  it("returns empty selection when no providers are enabled", () => {
    expect(resolveComposerSelection([], "p1", "M2.7")).toEqual({ providerId: "", model: "" });
  });
});
