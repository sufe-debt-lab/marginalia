import { useEffect, useRef, useState } from "react";
import type { ApiClient, DocumentContent } from "@/api/client.js";

export function useDocumentContent(api: ApiClient, workspaceId: string, path: string | null) {
  const cacheRef = useRef<Map<string, DocumentContent>>(new Map());
  const [content, setContent] = useState<DocumentContent | null>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!path) {
      setContent(null);
      return;
    }
    const cacheKey = `${workspaceId}::${path}`;
    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      setContent(cached);
      setError(null);
      return;
    }
    let active = true;
    setLoading(true);
    api
      .readDocument(workspaceId, path)
      .then((doc) => {
        if (!active) return;
        cacheRef.current.set(cacheKey, doc);
        setContent(doc);
        setError(null);
      })
      .catch((err: Error) => {
        if (active) {
          setError(err);
          setContent(null);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, workspaceId, path, revision]);

  function refresh() {
    if (!path) return;
    cacheRef.current.delete(`${workspaceId}::${path}`);
    setRevision((value) => value + 1);
  }

  return { content, loading, error, refresh };
}
