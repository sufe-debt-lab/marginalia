import { useCallback, useEffect, useState } from "react";
import type { ChatEntry, ChatToolCall, ChatToolResult } from "@marginalia/chat-core";
import type { ApiClient } from "@/api/client.js";

export function useMessages(api: ApiClient, sessionId: string | null) {
  const [data, setData] = useState<ChatEntry[]>([]);
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
        if (!active) return;
        const loaded = Array.isArray(items) ? items : [];
        setData((current) => {
          // Keep optimistic (local-*) messages appended while the history was loading,
          // but show the loaded history beneath them. Server-backed ids replace dupes.
          const optimistic = current.filter((m) => m.id.startsWith("local-"));
          if (optimistic.length === 0) return loaded;
          const loadedIds = new Set(loaded.map((m) => m.id));
          return [...loaded, ...optimistic.filter((m) => !loadedIds.has(m.id))];
        });
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, sessionId]);

  const append = useCallback((m: ChatEntry) => {
    setData((items) => [...items, m]);
  }, []);

  const removeMessage = useCallback((id: string) => {
    setData((items) => items.filter((m) => m.id !== id));
  }, []);

  const appendToLast = useCallback((delta: string) => {
    setData((items) => {
      const last = items[items.length - 1];
      if (!last || last.message.role !== "assistant") return items;
      const next = items.slice(0, -1);
      const content = last.message.content.slice();
      const tail = content[content.length - 1];
      if (tail?.type === "text") {
        content[content.length - 1] = { ...tail, text: tail.text + delta };
      } else {
        content.push({ type: "text", text: delta });
      }
      next.push({ ...last, message: { ...last.message, content } });
      return next;
    });
  }, []);

  const replaceAssistant = useCallback((entry: ChatEntry) => {
    if (entry.message.role !== "assistant") return;
    setData((items) => {
      const index = items.findIndex((item) => item.id === entry.id);
      if (index < 0) return [...items, entry];
      const next = items.slice();
      next[index] = entry;
      return next;
    });
  }, []);

  const upsertToolCall = useCallback((tool: ChatToolCall) => {
    setData((items) => {
      const existingIndex = items.findIndex(
        (entry) =>
          entry.message.role === "assistant" &&
          entry.message.content.some((part) => part.type === "toolCall" && part.id === tool.id)
      );
      const index = existingIndex >= 0 ? existingIndex : lastAssistantIndex(items);
      if (index < 0) return items;

      const message = items[index];
      if (!message || message.message.role !== "assistant") return items;

      const found = message.message.content.some(
        (part) => part.type === "toolCall" && part.id === tool.id
      );
      const content = found
        ? message.message.content.map((part) =>
            part.type === "toolCall" && part.id === tool.id ? { ...part, ...tool } : part
          )
        : [...message.message.content, tool];
      const next = items.slice();
      next[index] = { ...message, message: { ...message.message, content } };
      return next;
    });
  }, []);

  const upsertToolResult = useCallback((entry: ChatEntry & { message: ChatToolResult }) => {
    setData((items) => {
      const index = items.findIndex(
        (item) =>
          item.message.role === "toolResult" && item.message.toolCallId === entry.message.toolCallId
      );
      if (index < 0) return [...items, entry];
      const next = items.slice();
      next[index] = { ...entry, id: items[index]?.id ?? entry.id };
      return next;
    });
  }, []);

  return {
    data,
    loading,
    append,
    removeMessage,
    appendToLast,
    replaceAssistant,
    upsertToolCall,
    upsertToolResult,
    set: setData
  };
}

function lastAssistantIndex(items: readonly ChatEntry[]): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.message.role === "assistant") return index;
  }
  return -1;
}
