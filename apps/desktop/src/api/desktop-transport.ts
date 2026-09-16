import { t } from "@/i18n/useTranslation.js";
import { useAppStore } from "@/store/app-store.js";

function transportError(
  key:
    | "common.invalidPiServerTransportUrl"
    | "common.invalidPiServerRequest"
    | "common.piServerTransportUnavailable"
    | "common.unsupportedPiServerRequestBody"
) {
  return new Error(t(key, useAppStore.getState().locale));
}

function requestBody(body: BodyInit | null | undefined): string | undefined {
  if (body == null) return undefined;
  if (typeof body === "string") return body;
  throw transportError("common.unsupportedPiServerRequestBody");
}

export function desktopPiServerFetch(input: string, init: RequestInit = {}): Promise<Response> {
  if (init.signal?.aborted)
    return Promise.reject(init.signal.reason ?? new DOMException("Aborted", "AbortError"));
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return Promise.reject(transportError("common.invalidPiServerTransportUrl"));
  }
  if (
    url.protocol !== "marginalia:" ||
    url.hostname !== "pi-server" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    return Promise.reject(transportError("common.invalidPiServerTransportUrl"));
  }
  const bridge = window.marginalia;
  if (!bridge?.requestPiServer) {
    return Promise.reject(transportError("common.piServerTransportUnavailable"));
  }

  return new Promise<Response>((resolve, reject) => {
    let started = false;
    let finished = false;
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(nextController) {
        controller = nextController;
      },
      cancel() {
        if (finished) return;
        finished = true;
        init.signal?.removeEventListener("abort", abort);
        cancel();
      }
    });
    let cancel: () => void = () => undefined;
    const abort = () => {
      if (finished) return;
      finished = true;
      init.signal?.removeEventListener("abort", abort);
      cancel();
      const reason = init.signal?.reason ?? new DOMException("Aborted", "AbortError");
      if (started) controller.error(reason);
      else reject(reason);
    };
    let request: PiServerRequest;
    try {
      request = {
        path: `${url.pathname}${url.search}`,
        method: (init.method ?? "GET").toUpperCase(),
        headers: [...new Headers(init.headers).entries()],
        ...(init.body == null ? {} : { body: requestBody(init.body) })
      };
    } catch (error) {
      reject(
        error instanceof Error &&
          error.message ===
            t("common.unsupportedPiServerRequestBody", useAppStore.getState().locale)
          ? error
          : transportError("common.invalidPiServerRequest")
      );
      return;
    }
    try {
      cancel = bridge.requestPiServer!(request, (event) => {
        if (finished) return;
        if (event.type === "start") {
          started = true;
          const hasBody = ![204, 205, 304].includes(event.status);
          resolve(
            new Response(hasBody ? stream : null, {
              status: event.status,
              statusText: event.statusText,
              headers: event.headers
            })
          );
        } else if (event.type === "data") {
          controller.enqueue(new Uint8Array(event.chunk));
        } else if (event.type === "end") {
          finished = true;
          init.signal?.removeEventListener("abort", abort);
          controller.close();
        } else if (event.type === "error") {
          finished = true;
          init.signal?.removeEventListener("abort", abort);
          const error = transportError("common.piServerTransportUnavailable");
          if (started) controller.error(error);
          else reject(error);
        }
      });
    } catch {
      reject(transportError("common.piServerTransportUnavailable"));
      return;
    }

    if (init.signal?.aborted) {
      abort();
      return;
    }
    init.signal?.addEventListener("abort", abort, { once: true });
  });
}
