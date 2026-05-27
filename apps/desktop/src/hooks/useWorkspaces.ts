import { useCallback, useEffect, useState } from "react";
import type { ApiClient, Workspace } from "@/api/client.js";

export function useWorkspaces(api: ApiClient) {
  const [data, setData] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .listWorkspaces()
      .then((items) => {
        if (active) {
          setData(items);
          setError(null);
        }
      })
      .catch((err: Error) => {
        if (active) setError(err);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api]);

  const create = useCallback(
    async (input: { name: string; rootDir: string }) => {
      const created = await api.createWorkspace(input);
      setData((items) => [created, ...items]);
      return created;
    },
    [api]
  );

  return { data, loading, error, create };
}
