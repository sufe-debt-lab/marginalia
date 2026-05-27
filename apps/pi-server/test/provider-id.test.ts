import { describe, expect, it } from "vitest";
import { piProviderId } from "../src/agent/provider-id.js";

describe("piProviderId", () => {
  it("maps known minimax aliases to minimax-cn", () => {
    expect(piProviderId("Minimax")).toBe("minimax-cn");
    expect(piProviderId("MiniMax CN")).toBe("minimax-cn");
    expect(piProviderId("MINIMAX_CN")).toBe("minimax-cn");
    expect(piProviderId("minimax-cn")).toBe("minimax-cn");
  });

  it("maps openai variants to openai", () => {
    expect(piProviderId("OpenAI")).toBe("openai");
    expect(piProviderId("Open AI")).toBe("openai");
  });

  it("normalizes unknown names with kebab-case lowering", () => {
    expect(piProviderId("Custom Provider")).toBe("custom-provider");
    expect(piProviderId("my_endpoint")).toBe("my-endpoint");
  });

  it("falls back to empty string for blank input", () => {
    expect(piProviderId("")).toBe("");
    expect(piProviderId("   ")).toBe("");
  });
});
