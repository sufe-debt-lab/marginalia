import { useCallback, useRef, useState } from "react";
import type { ApiClient, Message } from "@/api/client.js";

export interface ToolCall {
  id: string;
  name: string;
  subtitle: string;
  status: "running" | "done" | "failed";
}

/** Pull a compact, human-readable argument out of a pi tool call's args. */
function toolSubtitle(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const a = args as Record<string, unknown>;
  const candidate = a.path ?? a.file_path ?? a.filePath ?? a.command ?? a.pattern ?? a.query;
  return typeof candidate === "string" ? candidate : "";
}

interface Options {
  api: ApiClient;
  sessionId: string | null;
  providerId: string;
  model: string;
  permission?: "full" | "ask" | "readonly";
  reasoning?: "low" | "medium" | "high" | "xhigh";
  onUserAppend: (m: Message) => void;
  onAssistantStart: (m: Message) => void;
  onAssistantDelta: (delta: string) => void;
  onComplete: () => void;
  onError?: (msg: string) => void;
}

export function useStreamingChat(opts: Options) {
  const [sending, setSending] = useState(false);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const bufferRef = useRef("");
  const rafRef = useRef<number | null>(null);

  function flush() {
    if (bufferRef.current.length > 0) {
      const text = bufferRef.current;
      bufferRef.current = "";
      opts.onAssistantDelta(text);
    }
    rafRef.current = null;
  }

  function schedule() {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(flush);
  }

  const send = useCallback(
    async (text: string, contextFiles: string[]) => {
      if (!opts.sessionId || !text.trim()) return;
      setSending(true);
      setToolCalls([]);
      const savedUser = await opts.api.createMessage(opts.sessionId, {
        role: "user",
        content: text
      });
      opts.onUserAppend(savedUser);
      opts.onAssistantStart({
        id: `local-assistant-${Date.now()}`,
        role: "assistant",
        content: ""
      });
      try {
        const events = await opts.api.runChat(opts.sessionId, {
          providerId: opts.providerId,
          model: opts.model,
          message: text,
          contextFiles,
          permission: opts.permission,
          reasoning: opts.reasoning
        });
        for await (const event of events) {
          if (event.type === "assistant_delta") {
            const delta = (event.payload as { text?: string } | undefined)?.text ?? "";
            if (delta) {
              bufferRef.current += delta;
              schedule();
            }
          }
          if (event.type === "tool_started") {
            const p = event.payload as { toolCallId?: string; toolName?: string; args?: unknown };
            const id = p.toolCallId ?? `tool-${Date.now()}`;
            setToolCalls((prev) => [
              ...prev,
              { id, name: p.toolName ?? "tool", subtitle: toolSubtitle(p.args), status: "running" }
            ]);
          }
          if (event.type === "tool_completed" || event.type === "tool_failed") {
            const p = event.payload as { toolCallId?: string };
            const status = event.type === "tool_failed" ? "failed" : "done";
            setToolCalls((prev) =>
              prev.map((tc) => (tc.id === p.toolCallId ? { ...tc, status } : tc))
            );
          }
          if (event.type === "run_failed") {
            const errMsg = (event.payload as { error?: string } | undefined)?.error ?? "run failed";
            throw new Error(errMsg);
          }
        }
        flush();
        opts.onComplete();
      } catch (err) {
        flush();
        opts.onError?.((err as Error).message);
      } finally {
        setSending(false);
      }
    },
    [opts]
  );

  return { send, sending, toolCalls };
}
