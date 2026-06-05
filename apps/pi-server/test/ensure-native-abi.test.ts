import { describe, expect, it, vi } from "vitest";

// @ts-expect-error -- plain ESM script without type declarations
import { ensureNativeAbi, isNativeAbiMismatch } from "../scripts/ensure-native-abi.mjs";

describe("ensure-native-abi", () => {
  it("recognizes native ABI mismatch errors", () => {
    expect(
      isNativeAbiMismatch(
        new Error("was compiled against a different Node.js version using NODE_MODULE_VERSION 137")
      )
    ).toBe(true);
    expect(isNativeAbiMismatch(new Error("database is locked"))).toBe(false);
  });

  it("does not rebuild when better-sqlite3 opens successfully", () => {
    const load = vi.fn();
    const rebuild = vi.fn();

    expect(ensureNativeAbi({ load, rebuild })).toBe("ok");

    expect(load).toHaveBeenCalledTimes(1);
    expect(rebuild).not.toHaveBeenCalled();
  });

  it("rebuilds once and verifies again after an ABI mismatch", () => {
    const load = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("NODE_MODULE_VERSION 140. This version requires NODE_MODULE_VERSION 147.");
      })
      .mockImplementationOnce(() => undefined);
    const rebuild = vi.fn();
    const log = { warn: vi.fn() };

    expect(ensureNativeAbi({ load, rebuild, log })).toBe("rebuilt");

    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(2);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it("surfaces the second load error when rebuild does not fix the mismatch", () => {
    const load = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("NODE_MODULE_VERSION 140. This version requires NODE_MODULE_VERSION 147.");
      })
      .mockImplementationOnce(() => {
        throw new Error("still NODE_MODULE_VERSION 140 after rebuild");
      });
    const rebuild = vi.fn();
    const log = { warn: vi.fn() };

    expect(() => ensureNativeAbi({ load, rebuild, log })).toThrow(/still NODE_MODULE_VERSION/);

    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("can check without rebuilding for production-style startup", () => {
    const load = vi.fn(() => {
      throw new Error("NODE_MODULE_VERSION 140. This version requires NODE_MODULE_VERSION 147.");
    });
    const rebuild = vi.fn();

    expect(() => ensureNativeAbi({ load, rebuild, repair: false })).toThrow(/ensure:native/);
    expect(rebuild).not.toHaveBeenCalled();
  });

  it("does not hide non-ABI load errors", () => {
    const load = vi.fn(() => {
      throw new Error("permission denied");
    });
    const rebuild = vi.fn();

    expect(() => ensureNativeAbi({ load, rebuild })).toThrow(/permission denied/);
    expect(rebuild).not.toHaveBeenCalled();
  });
});
