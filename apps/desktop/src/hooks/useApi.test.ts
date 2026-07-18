import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useApi } from "./useApi.js";

describe("useApi", () => {
  it("memoizes the ApiClient for a stable serverUrl", () => {
    const { result, rerender } = renderHook(({ url, token }) => useApi(url, token), {
      initialProps: { url: "http://one", token: "token-one" }
    });
    const first = result.current;
    rerender({ url: "http://one", token: "token-one" });
    expect(result.current).toBe(first);
    rerender({ url: "http://two", token: "token-one" });
    expect(result.current).not.toBe(first);
    const second = result.current;
    rerender({ url: "http://two", token: "token-two" });
    expect(result.current).not.toBe(second);
  });
});
