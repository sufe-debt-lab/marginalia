import { useEffect, useState } from "react";
import type { ApiClient } from "@/api/client.js";

export function useFileTree(api: ApiClient, workspaceId: string | null) {
  const [paths, setPaths] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!workspaceId) {
      setPaths([]);
      return;
    }
    let active = true;
    setLoading(true);
    api
      .listFiles(workspaceId)
      .then((items) => {
        if (!active) return;
        setPaths(Array.isArray(items) ? items.map((i) => i.path) : []);
        setError(null);
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

  return { paths, loading, error };
}
