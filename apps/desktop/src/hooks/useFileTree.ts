import { useCallback, useEffect, useState } from "react";
import type { ApiClient } from "@/api/client.js";

export function useFileTree(api: ApiClient, workspaceId: string | null, visible = true) {
  const [paths, setPaths] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    if (!workspaceId) {
      setPaths([]);
      return;
    }
    if (!visible) return;
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
  }, [api, workspaceId, visible, revision]);

  return { paths, loading, error, refresh };
}
