/** Maximum serialized size of one run request before JSON decoding. */
export const MAX_RUN_REQUEST_BYTES = 4 * 1024 * 1024;

export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("Run request body is too large");
    this.name = "RequestBodyTooLargeError";
  }
}

export async function readJsonBodyWithinLimit<T>(
  request: Request,
  maxBytes = MAX_RUN_REQUEST_BYTES
): Promise<T> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
    await request.body?.cancel().catch(() => undefined);
    throw new RequestBodyTooLargeError();
  }

  const reader = request.body?.getReader();
  if (!reader) return JSON.parse("") as T;

  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new RequestBodyTooLargeError();
      }
      chunks.push(result.value);
    }
  } catch (error) {
    if (!(error instanceof RequestBodyTooLargeError)) {
      await reader.cancel().catch(() => undefined);
    }
    throw error;
  } finally {
    reader.releaseLock();
  }

  return JSON.parse(Buffer.concat(chunks, bytes).toString("utf8")) as T;
}
