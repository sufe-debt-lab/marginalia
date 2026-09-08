import { useMemo } from "react";
import { ApiClient } from "@/api/client.js";

export function useApi(serverUrl: string, capabilityToken: string): ApiClient {
  return useMemo(() => new ApiClient(serverUrl, capabilityToken), [serverUrl, capabilityToken]);
}
