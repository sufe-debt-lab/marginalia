import { useCallback } from "react";
import type { ApiClient, Workspace } from "@/api/client.js";
import { useResource } from "./resource-cache.js";

const EMPTY: Workspace[] = [];

export function useWorkspaces(api: ApiClient) {
  const { snapshot, resource } = useResource<Workspace[]>(
    api,
    "workspaces",
    () => api.listWorkspaces(),
    EMPTY
  );

  const create = useCallback(
    async (input: { name: string; rootDir: string }) => {
      const created = await api.createWorkspace(input);
      resource.setData((items) => [created, ...items]);
      return created;
    },
    [api, resource]
  );

  const remove = useCallback(
    async (id: string) => {
      await api.deleteWorkspace(id);
      resource.setData((items) => items.filter((w) => w.id !== id));
    },
    [api, resource]
  );

  return { data: snapshot.data, loading: snapshot.loading, error: snapshot.error, create, remove };
}
