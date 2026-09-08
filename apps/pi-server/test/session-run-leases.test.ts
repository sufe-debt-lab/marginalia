import { describe, expect, it } from "vitest";
import { SessionRunLeases } from "../src/run/session-run-leases.js";

describe("SessionRunLeases", () => {
  it("allows one lease per session and makes release idempotent", () => {
    const leases = new SessionRunLeases();
    const first = leases.tryAcquire("s1");

    expect(first).not.toBeNull();
    expect(leases.isBusy("s1")).toBe(true);
    expect(leases.tryAcquire("s1")).toBeNull();

    first?.release();
    first?.release();

    expect(leases.isBusy("s1")).toBe(false);
    expect(leases.tryAcquire("s1")).not.toBeNull();
  });

  it("allows different sessions to hold leases concurrently", () => {
    const leases = new SessionRunLeases();

    expect(leases.tryAcquire("s1")).not.toBeNull();
    expect(leases.tryAcquire("s2")).not.toBeNull();
  });
});
