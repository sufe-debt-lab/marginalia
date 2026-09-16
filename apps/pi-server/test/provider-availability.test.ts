import { describe, expect, it } from "vitest";
import { ModelAvailabilityChecker } from "../src/providers/provider-availability.js";

function fakeRegistry(available: Array<{ provider: string; id: string }>) {
  return {
    getAll() {
      return available;
    }
  };
}

describe("ModelAvailabilityChecker", () => {
  it("returns ok when provider id appears in pi registered list", () => {
    const checker = new ModelAvailabilityChecker(
      fakeRegistry([{ provider: "minimax-cn", id: "MiniMax-M2.7" }]) as any
    );
    expect(checker.check({ piProviderId: "minimax-cn", modelId: "MiniMax-M2.7" })).toEqual({
      ok: true,
      message: "ok"
    });
  });

  it("returns not-ok when provider absent", () => {
    const checker = new ModelAvailabilityChecker(fakeRegistry([]) as any);
    const result = checker.check({ piProviderId: "minimax-cn", modelId: "MiniMax-M2.7" });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/minimax-cn/);
  });

  it("returns not-ok when provider matches but model id missing", () => {
    const checker = new ModelAvailabilityChecker(
      fakeRegistry([{ provider: "minimax-cn", id: "Other-Model" }]) as any
    );
    const result = checker.check({ piProviderId: "minimax-cn", modelId: "MiniMax-M2.7" });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/MiniMax-M2\.7/);
  });
});
