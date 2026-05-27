import { useCallback, useEffect, useState } from "react";
import type { ApiClient, Session } from "@/api/client.js";

export function useSessions(api: ApiClient, workspaceId: string | null) {
  const [data, setData] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!workspaceId) {
      setData([]);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    api
      .listSessions(workspaceId)
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
  }, [api, workspaceId]);

  const create = useCallback(
    async (title: string) => {
      if (!workspaceId) throw new Error("workspaceId required");
      const created = await api.createSession({ workspaceId, title });
      setData((items) => [created, ...items]);
      return created;
    },
    [api, workspaceId]
  );

  return { data, loading, error, create };
}
