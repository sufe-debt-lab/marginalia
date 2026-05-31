import { describe, expect, it } from "vitest";
import { extractMentions } from "./mentions.js";

describe("extractMentions", () => {
  it("pulls @paths anchored at start or after whitespace", () => {
    expect(extractMentions("see @src/App.tsx and @lib/x.ts here")).toEqual([
      "src/App.tsx",
      "lib/x.ts"
    ]);
  });

  it("ignores @ that is not preceded by start/whitespace (e.g. emails)", () => {
    expect(extractMentions("ping a@b.com now")).toEqual([]);
  });

  it("dedupes repeated mentions", () => {
    expect(extractMentions("@a.ts and @a.ts")).toEqual(["a.ts"]);
  });

  it("returns [] when there are no mentions", () => {
    expect(extractMentions("plain text")).toEqual([]);
  });
});
