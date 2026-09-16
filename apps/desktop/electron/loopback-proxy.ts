export const PI_SERVER_RENDERER_URL = "marginalia://pi-server";

export type LoopbackAccess = {
  url: string;
  bearer: string;
  origin: string;
};

type ProxyRequest = {
  url: string;
  method: string;
  headers: Headers;
  signal?: AbortSignal;
  arrayBuffer(): Promise<ArrayBuffer>;
};

type ProxyFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: ArrayBuffer;
    signal?: AbortSignal;
  }
) => Promise<Response>;

type LoopbackProxyOptions = {
  getAccess(): LoopbackAccess | null;
  fetch: ProxyFetch;
};

const ALLOWED_METHODS = new Set(["GET", "HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"]);
const BODY_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const FORWARDED_HEADERS = [
  "accept",
  "access-control-request-headers",
  "access-control-request-method",
  "content-type",
  "last-event-id",
  "range"
] as const;

function errorResponse(error: string, status: number) {
  return Response.json({ error }, { status });
}

function isLoopbackUrl(url: URL) {
  return (
    url.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
    url.username === "" &&
    url.password === ""
  );
}

export function createLoopbackProxyHandler(options: LoopbackProxyOptions) {
  return async (request: ProxyRequest): Promise<Response> => {
    let rendererUrl: URL;
    try {
      rendererUrl = new URL(request.url);
    } catch {
      return errorResponse("transport_forbidden", 403);
    }
    if (
      rendererUrl.protocol !== "marginalia:" ||
      rendererUrl.hostname !== "pi-server" ||
      rendererUrl.port !== "" ||
      rendererUrl.username !== "" ||
      rendererUrl.password !== "" ||
      rendererUrl.hash !== "" ||
      !ALLOWED_METHODS.has(request.method)
    ) {
      return errorResponse("transport_forbidden", 403);
    }

    const access = options.getAccess();
    if (!access) return errorResponse("pi_server_unavailable", 503);

    const loopbackUrl = new URL(access.url);
    if (!isLoopbackUrl(loopbackUrl)) return errorResponse("pi_server_unavailable", 503);

    const target = new URL(loopbackUrl);
    target.pathname = rendererUrl.pathname;
    target.search = rendererUrl.search;
    const headers: Record<string, string> = {
      authorization: `Bearer ${access.bearer}`,
      origin: access.origin
    };
    for (const name of FORWARDED_HEADERS) {
      const value = request.headers.get(name);
      if (value !== null) headers[name] = value;
    }

    try {
      const hasBody = BODY_METHODS.has(request.method);
      return await options.fetch(target.toString(), {
        method: request.method,
        headers,
        ...(hasBody ? { body: await request.arrayBuffer() } : {}),
        ...(request.signal ? { signal: request.signal } : {})
      });
    } catch {
      return errorResponse("pi_server_unavailable", 503);
    }
  };
}

export async function probeLoopbackAccess(
  access: LoopbackAccess,
  fetch: (url: string, init?: { headers: Record<string, string> }) => Promise<Response>
) {
  const [health, unauthenticated] = await Promise.all([
    fetch(`${access.url}/health`),
    fetch(`${access.url}/workspaces`, { headers: { origin: access.origin } })
  ]);
  return {
    healthStatus: health.status,
    unauthenticatedStatus: unauthenticated.status
  };
}
