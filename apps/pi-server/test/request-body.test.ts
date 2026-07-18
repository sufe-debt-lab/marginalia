import { describe, expect, it, vi } from "vitest";
import { RequestBodyTooLargeError, readJsonBodyWithinLimit } from "../src/run/request-body.js";

type FakeReader = {
  read: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  releaseLock: ReturnType<typeof vi.fn>;
};

function requestWithReader(reader: FakeReader, headers: Record<string, string> = {}): Request {
  return {
    headers: new Headers(headers),
    body: { getReader: () => reader }
  } as unknown as Request;
}

function readerWithReads(...reads: Array<ReadableStreamReadResult<Uint8Array>>): FakeReader {
  return {
    read: vi.fn(async () => reads.shift() ?? { done: true, value: undefined }),
    cancel: vi.fn(async () => undefined),
    releaseLock: vi.fn()
  };
}

describe("readJsonBodyWithinLimit", () => {
  it("cancels the body before rejecting an oversized declared length", async () => {
    const cancel = vi.fn(async () => undefined);
    const getReader = vi.fn();
    const request = {
      headers: new Headers({ "content-length": "11" }),
      body: { cancel, getReader }
    } as unknown as Request;

    await expect(readJsonBodyWithinLimit(request, 10)).rejects.toBeInstanceOf(
      RequestBodyTooLargeError
    );
    expect(cancel).toHaveBeenCalledOnce();
    expect(getReader).not.toHaveBeenCalled();
  });

  it("cancels and unlocks after actual streamed bytes exceed the limit", async () => {
    const reader = readerWithReads({ done: false, value: new Uint8Array(11) });

    await expect(readJsonBodyWithinLimit(requestWithReader(reader), 10)).rejects.toBeInstanceOf(
      RequestBodyTooLargeError
    );
    expect(reader.cancel).toHaveBeenCalledOnce();
    expect(reader.releaseLock).toHaveBeenCalledOnce();
  });

  it("cancels and unlocks after a read failure without masking the original error", async () => {
    const failure = new Error("read failed");
    const reader = readerWithReads();
    reader.read.mockRejectedValueOnce(failure);
    reader.cancel.mockRejectedValueOnce(new Error("cancel failed"));

    await expect(readJsonBodyWithinLimit(requestWithReader(reader), 10)).rejects.toBe(failure);
    expect(reader.cancel).toHaveBeenCalledOnce();
    expect(reader.releaseLock).toHaveBeenCalledOnce();
  });

  it("unlocks a normally completed body without cancelling it", async () => {
    const reader = readerWithReads(
      { done: false, value: new TextEncoder().encode('{"ok":true}') },
      { done: true, value: undefined }
    );

    await expect(readJsonBodyWithinLimit(requestWithReader(reader))).resolves.toEqual({ ok: true });
    expect(reader.cancel).not.toHaveBeenCalled();
    expect(reader.releaseLock).toHaveBeenCalledOnce();
  });
});
