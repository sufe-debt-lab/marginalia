import { describe, expect, it } from "vitest";
import { isExternalUrl } from "./external-url.js";

describe("isExternalUrl", () => {
  it("accepts http and https urls", () => {
    expect(isExternalUrl("https://platform.openai.com/api-keys")).toBe(true);
    expect(isExternalUrl("http://example.com")).toBe(true);
  });

  it("rejects non-web schemes and junk", () => {
    expect(isExternalUrl("file:///etc/passwd")).toBe(false);
    expect(isExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isExternalUrl("mailto:a@b.com")).toBe(false);
    expect(isExternalUrl("ftp://host/file")).toBe(false);
    expect(isExternalUrl("")).toBe(false);
    expect(isExternalUrl("not a url")).toBe(false);
  });
});
