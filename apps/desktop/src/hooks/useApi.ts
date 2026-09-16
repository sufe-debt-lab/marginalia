import { useMemo } from "react";
import { ApiClient } from "@/api/client.js";
import { desktopPiServerFetch } from "@/api/desktop-transport.js";

export function useApi(serverUrl: string): ApiClient {
  return useMemo(
    () =>
      serverUrl.startsWith("marginalia://")
        ? new ApiClient(serverUrl, desktopPiServerFetch)
        : new ApiClient(serverUrl),
    [serverUrl]
  );
}
