import { useCallback, useEffect, useState } from "react";
import type { ApiClient, Message, ToolCall } from "@/api/client.js";

export function useMessages(api: ApiClient, sessionId: string | null) {
  const [data, setData] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sessionId) {
      setData([]);
      return;
    }
    let active = true;
    setData([]);
    setLoading(true);
    api
      .listMessages(sessionId)
      .then((items) => {
        if (active) {
          const loaded = Array.isArray(items) ? items : [];
          setData((current) => (current.length > 0 ? current : loaded));
        }
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

  const removeMessage = useCallback((id: string) => {
    setData((items) => items.filter((m) => m.id !== id));
  }, []);

  const appendToLast = useCallback((delta: string) => {
    setData((items) => {
      const last = items[items.length - 1];
      if (!last || last.role !== "assistant") return items;
      const next = items.slice(0, -1);
      next.push({ ...last, content: last.content + delta });
      return next;
    });
  }, []);

  const upsertToolCall = useCallback((tool: ToolCall) => {
    setData((items) => {
      const existingIndex = items.findIndex((m) => m.toolCalls?.some((tc) => tc.id === tool.id));
      const targetIndex =
        existingIndex >= 0
          ? existingIndex
          : [...items].reverse().findIndex((m) => m.role === "assistant");
      if (targetIndex < 0) return items;

      const index = existingIndex >= 0 ? existingIndex : items.length - 1 - targetIndex;
      const message = items[index];
      if (!message || message.role !== "assistant") return items;

      const current = message.toolCalls ?? [];
      const found = current.some((tc) => tc.id === tool.id);
      const toolCalls = found
        ? current.map((tc) => (tc.id === tool.id ? { ...tc, ...tool } : tc))
        : [...current, tool];
      const next = items.slice();
      next[index] = { ...message, toolCalls };
      return next;
    });
  }, []);

  return { data, loading, append, removeMessage, appendToLast, upsertToolCall, set: setData };
}
