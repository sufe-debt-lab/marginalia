import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const TRIPTYCH_GAP = 8;

export function readPngSize(buffer) {
  const { width, height } = PNG.sync.read(buffer);
  return { width, height };
}

export function diffPngBuffers(aBuffer, bBuffer, { threshold = 0.1 } = {}) {
  const a = PNG.sync.read(aBuffer);
  const b = PNG.sync.read(bBuffer);
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`image size mismatch: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
  const diff = new PNG({ width: a.width, height: a.height });
  const diffPixels = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold });
  const totalPixels = a.width * a.height;
  return {
    width: a.width,
    height: a.height,
    diffPixels,
    totalPixels,
    diffRatio: diffPixels / totalPixels,
    diffPngBuffer: PNG.sync.write(diff)
  };
}

export function composeTriptych(buffers) {
  const images = buffers.map((buffer) => PNG.sync.read(buffer));
  const [first, ...rest] = images;
  if (rest.some((image) => image.width !== first.width || image.height !== first.height)) {
    throw new Error("triptych panels must share dimensions");
  }
  const out = new PNG({
    width: first.width * images.length + TRIPTYCH_GAP * (images.length - 1),
    height: first.height
  });
  out.data.fill(255);
  images.forEach((image, index) => {
    PNG.bitblt(
      image,
      out,
      0,
      0,
      image.width,
      image.height,
      index * (first.width + TRIPTYCH_GAP),
      0
    );
  });
  return PNG.sync.write(out);
}
