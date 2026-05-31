import { describe, expect, it } from "vitest";
import { resultText, stringifyContent, toolSubtitle } from "./tool-format.js";

describe("stringifyContent", () => {
  it("returns strings as-is", () => {
    expect(stringifyContent("hello")).toBe("hello");
  });

  it("joins text parts and ignores non-text parts", () => {
    expect(
      stringifyContent([
        { type: "text", text: "a" },
        { type: "toolCall", id: "t", name: "read" },
        { type: "text", text: "b" }
      ])
    ).toBe("ab");
  });

  it("returns empty string for non-string, non-array input", () => {
    expect(stringifyContent({ foo: 1 })).toBe("");
  });
});

describe("toolSubtitle", () => {
  it("prefers path-like fields", () => {
    expect(toolSubtitle({ path: "a.ts" })).toBe("a.ts");
    expect(toolSubtitle({ command: "ls" })).toBe("ls");
  });

  it("returns undefined when no recognised field is present", () => {
    expect(toolSubtitle({ other: 1 })).toBeUndefined();
    expect(toolSubtitle(null)).toBeUndefined();
  });
});

describe("resultText", () => {
  it("truncates long strings to 400 chars", () => {
    expect(resultText("x".repeat(500))).toHaveLength(400);
  });

  it("extracts text from a content array", () => {
    expect(resultText({ content: [{ text: "done" }] })).toBe("done");
  });

  it("returns undefined for empty input", () => {
    expect(resultText(undefined)).toBeUndefined();
  });
});
