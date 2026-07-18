import { describe, expect, it, vi } from "vitest";
import { saveTextFile } from "./save-file.js";

describe("saveTextFile", () => {
  it("returns saved:false when the bridge is unavailable", async () => {
    expect(await saveTextFile("a.md", "x")).toEqual({ saved: false });
  });

  it("delegates to window.marginalia.saveTextFile", async () => {
    const bridge = vi.fn(async () => ({ saved: true, path: "/p/a.md" }));
    (window as unknown as { marginalia?: unknown }).marginalia = { saveTextFile: bridge };
    expect(await saveTextFile("a.md", "x")).toEqual({ saved: true, path: "/p/a.md" });
    expect(bridge).toHaveBeenCalledWith({ defaultName: "a.md", content: "x" });
    delete (window as unknown as { marginalia?: unknown }).marginalia;
  });

  it("reports bridge failures as an error result instead of throwing", async () => {
    const bridge = vi.fn(async () => {
      throw new Error("disk full");
    });
    (window as unknown as { marginalia?: unknown }).marginalia = { saveTextFile: bridge };
    expect(await saveTextFile("a.md", "x")).toEqual({ saved: false, error: "disk full" });
    delete (window as unknown as { marginalia?: unknown }).marginalia;
  });
});
