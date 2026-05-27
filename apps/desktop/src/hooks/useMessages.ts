import { useCallback, useEffect, useState } from "react";
import type { ApiClient, Message } from "@/api/client.js";

export function useMessages(api: ApiClient, sessionId: string | null) {
  const [data, setData] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sessionId) {
      setData([]);
      return;
    }
    let active = true;
    setLoading(true);
    api
      .listMessages(sessionId)
      .then((items) => {
        if (active) setData(Array.isArray(items) ? items : []);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, sessionId]);

  const append = useCallback((m: Message) => {
    setData((items) => [...items, m]);
  }, []);

  const appendToLast = useCallback((delta: string) => {
    setData((items) => {
      if (items.length === 0) return items;
      const last = items[items.length - 1];
      const next = items.slice(0, -1);
      next.push({ ...last, content: last.content + delta });
      return next;
    });
  }, []);

  return { data, loading, append, appendToLast, set: setData };
}
