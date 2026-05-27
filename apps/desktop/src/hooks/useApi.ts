import { useMemo } from "react";
import { ApiClient } from "@/api/client.js";

export function useApi(serverUrl: string): ApiClient {
  return useMemo(() => new ApiClient(serverUrl), [serverUrl]);
}
