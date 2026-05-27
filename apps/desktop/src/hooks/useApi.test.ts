import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useApi } from "./useApi.js";

describe("useApi", () => {
  it("memoizes the ApiClient for a stable serverUrl", () => {
    const { result, rerender } = renderHook(({ url }) => useApi(url), {
      initialProps: { url: "http://one" }
    });
    const first = result.current;
    rerender({ url: "http://one" });
    expect(result.current).toBe(first);
    rerender({ url: "http://two" });
    expect(result.current).not.toBe(first);
  });
});
