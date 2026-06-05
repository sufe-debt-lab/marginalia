import { afterEach, describe, expect, it, vi } from "vitest";
import { isWebUrl, openExternal } from "./open-external.js";

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as { marginalia?: unknown }).marginalia;
});

describe("openExternal", () => {
  it("routes through the Electron bridge when available", () => {
    const bridge = vi.fn();
    (window as { marginalia?: { openExternal: typeof bridge } }).marginalia = {
      openExternal: bridge
    };
    const open = vi.spyOn(window, "open").mockReturnValue(null);

    openExternal("https://example.com");

    expect(bridge).toHaveBeenCalledWith("https://example.com");
    expect(open).not.toHaveBeenCalled();
  });

  it("falls back to window.open in a plain browser", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);

    openExternal("https://example.com");

    expect(open).toHaveBeenCalledWith("https://example.com", "_blank", "noopener,noreferrer");
  });
});

describe("isWebUrl", () => {
  it("accepts absolute http and https urls", () => {
    expect(isWebUrl("https://example.com")).toBe(true);
    expect(isWebUrl("http://example.com/x")).toBe(true);
  });

  it("rejects anchors, mailto, relative paths and junk", () => {
    expect(isWebUrl("#section")).toBe(false);
    expect(isWebUrl("mailto:a@b.com")).toBe(false);
    expect(isWebUrl("./docs/readme.md")).toBe(false);
    expect(isWebUrl("/abs/path")).toBe(false);
    expect(isWebUrl("")).toBe(false);
  });
});
