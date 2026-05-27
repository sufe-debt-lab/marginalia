import { describe, expect, it } from "vitest";
import { cn } from "./cn.js";

describe("cn", () => {
  it("merges tailwind classes deduplicating conflicts", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-red-500", false, "text-blue-500")).toBe("text-blue-500");
  });

  it("handles falsy values", () => {
    expect(cn("a", null, undefined, "b")).toBe("a b");
  });
});
