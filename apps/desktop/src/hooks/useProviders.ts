import { useMemo } from "react";
import type { ApiClient, Provider } from "@/api/client.js";
import { useResource } from "./resource-cache.js";

const EMPTY: Provider[] = [];

export function useProviders(api: ApiClient) {
  const { snapshot, resource } = useResource<Provider[]>(
    api,
    "providers",
    async () => {
      const items = await api.listProviders();
      return Array.isArray(items) ? items : [];
    },
    EMPTY
  );

  // Disabled providers have no runtime key and are rejected by the run endpoint,
  // so chat pickers and default selection use this filtered list; settings still
  // reads `data` to show (and re-enable) every provider.
  const enabled = useMemo(() => snapshot.data.filter((p) => p.enabled !== false), [snapshot.data]);

  return {
    data: snapshot.data,
    enabled,
    loading: snapshot.loading,
    error: snapshot.error,
    refresh: () => resource.refresh()
  };
}
