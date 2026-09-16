import { execFileSync } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { watchProcessOwner } from "../src/run/process-owner.js";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

it("keeps an owner alive when its identity becomes readable after an initial probe failure", () => {
  vi.useFakeTimers();
  vi.mocked(execFileSync)
    .mockImplementationOnce(() => {
      throw new Error("temporary probe timeout");
    })
    .mockReturnValue("current-instance");
  const shutdown = vi.fn();
  const stop = watchProcessOwner(process.pid, shutdown);
  try {
    vi.advanceTimersByTime(2000);
    expect(shutdown).not.toHaveBeenCalled();
    vi.mocked(execFileSync).mockReturnValue("different-instance");
    vi.advanceTimersByTime(1000);
    expect(shutdown).toHaveBeenCalledOnce();
  } finally {
    stop();
  }
});
