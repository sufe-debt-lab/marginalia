import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";

// @ts-expect-error -- plain ESM script without type declarations
import { composeTriptych, diffPngBuffers, readPngSize } from "./image-diff.mjs";

function solidPng(width: number, height: number, rgba: [number, number, number, number]): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i += 1) {
    png.data[i * 4] = rgba[0];
    png.data[i * 4 + 1] = rgba[1];
    png.data[i * 4 + 2] = rgba[2];
    png.data[i * 4 + 3] = rgba[3];
  }
  return PNG.sync.write(png);
}

const WHITE: [number, number, number, number] = [255, 255, 255, 255];
const BLACK: [number, number, number, number] = [0, 0, 0, 255];

describe("diffPngBuffers", () => {
  it("reports zero diff for identical images", () => {
    const a = solidPng(4, 4, WHITE);
    const result = diffPngBuffers(a, solidPng(4, 4, WHITE));
    expect(result).toMatchObject({
      width: 4,
      height: 4,
      diffPixels: 0,
      totalPixels: 16,
      diffRatio: 0
    });
    expect(PNG.sync.read(result.diffPngBuffer).width).toBe(4);
  });

  it("reports full diff for opposite images", () => {
    const result = diffPngBuffers(solidPng(4, 4, WHITE), solidPng(4, 4, BLACK));
    expect(result.diffPixels).toBe(16);
    expect(result.diffRatio).toBe(1);
    expect(PNG.sync.read(result.diffPngBuffer).width).toBe(4);
  });

  it("throws a hard error on size mismatch instead of resizing", () => {
    expect(() => diffPngBuffers(solidPng(4, 4, WHITE), solidPng(4, 8, WHITE))).toThrow(
      /size mismatch: 4x4 vs 4x8/
    );
  });
});

describe("readPngSize", () => {
  it("returns width and height", () => {
    expect(readPngSize(solidPng(6, 3, WHITE))).toEqual({ width: 6, height: 3 });
  });
});

describe("composeTriptych", () => {
  it("concatenates three equal-size panels horizontally with gaps", () => {
    const buf = composeTriptych([
      solidPng(4, 4, WHITE),
      solidPng(4, 4, BLACK),
      solidPng(4, 4, WHITE)
    ]);
    const out = PNG.sync.read(buf);
    expect(out.height).toBe(4);
    expect(out.width).toBe(4 * 3 + 8 * 2); // 8px gap between panels
  });

  it("rejects panels of different sizes", () => {
    expect(() => composeTriptych([solidPng(4, 4, WHITE), solidPng(4, 8, WHITE)])).toThrow(
      /share dimensions/
    );
  });

  it("rejects an empty panel list with a clear error", () => {
    expect(() => composeTriptych([])).toThrow(/at least one panel/);
  });
});
