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

  return {
    data: snapshot.data,
    loading: snapshot.loading,
    error: snapshot.error,
    refresh: () => resource.refresh()
  };
}
