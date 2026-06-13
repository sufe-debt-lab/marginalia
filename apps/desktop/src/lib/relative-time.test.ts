import { afterEach, describe, expect, it } from "vitest";
import { relativeTime } from "./relative-time.js";

const NOW = 1_700_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("relativeTime", () => {
  it("renders 'now' under a minute", () => {
    expect(relativeTime(NOW - 5_000, "en", NOW)).toBe("now");
    expect(relativeTime(NOW - 5_000, "zh", NOW)).toBe("现在");
  });

  it("renders minutes and hours", () => {
    expect(relativeTime(NOW - 3 * MIN, "en", NOW)).toBe("3m");
    expect(relativeTime(NOW - 2 * HOUR, "zh", NOW)).toBe("2小时");
  });

  it("renders yesterday, days and weeks", () => {
    expect(relativeTime(NOW - DAY, "en", NOW)).toBe("1d");
    expect(relativeTime(NOW - DAY, "zh", NOW)).toBe("昨天");
    expect(relativeTime(NOW - 3 * DAY, "en", NOW)).toBe("3d");
    expect(relativeTime(NOW - 14 * DAY, "zh", NOW)).toBe("2周");
  });

  it("clamps future timestamps to 'now'", () => {
    expect(relativeTime(NOW + 10_000, "en", NOW)).toBe("now");
  });
});

describe("frozen clock for screenshot verification", () => {
  afterEach(() => {
    delete (window as { __MARGINALIA_FROZEN_NOW__?: number }).__MARGINALIA_FROZEN_NOW__;
  });

  it("uses window.__MARGINALIA_FROZEN_NOW__ as the default now when present", () => {
    (window as { __MARGINALIA_FROZEN_NOW__?: number }).__MARGINALIA_FROZEN_NOW__ = NOW;
    expect(relativeTime(NOW - 5_000, "en")).toBe("now");
    expect(relativeTime(NOW - 3 * MIN, "zh")).toBe("3分钟");
  });

  it("falls back to Date.now() when the frozen clock is absent", () => {
    expect(relativeTime(Date.now() - 1_000, "en")).toBe("now");
  });
});
