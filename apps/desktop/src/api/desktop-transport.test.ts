import { afterEach, describe, expect, it, vi } from "vitest";
import { desktopPiServerFetch } from "./desktop-transport.js";

afterEach(() => {
  window.marginalia = undefined;
});

describe("desktopPiServerFetch", () => {
  it("streams a response through the restricted preload capability", async () => {
    window.marginalia = {
      getPiServerStatus: vi.fn(),
      restartPiServer: vi.fn(),
      requestPiServer: vi.fn((input, callback) => {
        expect(input).toEqual({
          path: "/sessions/s1/runs",
          method: "POST",
          headers: [["content-type", "application/json"]],
          body: '{"message":"hi"}'
        });
        callback({
          type: "start",
          status: 200,
          statusText: "OK",
          headers: [["content-type", "text/event-stream"]]
        });
        callback({ type: "data", chunk: new TextEncoder().encode("data: one\n\n") });
        callback({ type: "end" });
        return vi.fn();
      })
    };

    const response = await desktopPiServerFetch("marginalia://pi-server/sessions/s1/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"message":"hi"}'
    });

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("data: one\n\n");
  });

  it("rejects non-transport URLs before crossing preload", async () => {
    window.marginalia = {
      getPiServerStatus: vi.fn(),
      restartPiServer: vi.fn(),
      requestPiServer: vi.fn()
    };

    await expect(desktopPiServerFetch("https://attacker.test/workspaces")).rejects.toThrow(
      "The local service request URL is invalid."
    );
    expect(window.marginalia.requestPiServer).not.toHaveBeenCalled();
  });

  it("translates main transport failures", async () => {
    window.marginalia = {
      getPiServerStatus: vi.fn(),
      restartPiServer: vi.fn(),
      requestPiServer: vi.fn((_input, callback) => {
        callback({ type: "error", code: "pi_server_unavailable" });
        return vi.fn();
      })
    };

    await expect(desktopPiServerFetch("marginalia://pi-server/workspaces")).rejects.toThrow(
      "The local service connection is unavailable."
    );
  });
});
