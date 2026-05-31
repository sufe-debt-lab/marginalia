import { useCallback, useRef, useState } from "react";
import type { ApiClient, Message, ToolCall } from "@/api/client.js";

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
  onToolCallUpdate?: (tool: ToolCall) => void;
  onComplete: () => void;
  onError?: (msg: string) => void;
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException
    ? err.name === "AbortError"
    : err instanceof Error && err.name === "AbortError";
}

function resultText(result: unknown): string | undefined {
  if (!result) return undefined;
  if (typeof result === "string") return result.slice(0, 400);
  if (typeof result !== "object") return String(result);
  const record = result as Record<string, unknown>;
  const content = record.content;
  if (Array.isArray(content)) {
    const text = content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          const candidate = part as { text?: unknown };
          return typeof candidate.text === "string" ? candidate.text : "";
        }
        return "";
      })
      .join("");
    if (text) return text.slice(0, 400);
  }
  try {
    return JSON.stringify(result).slice(0, 400);
  } catch {
    return undefined;
  }
}

export function useStreamingChat(opts: Options) {
  const [sending, setSending] = useState(false);
  const [toolCalls, setToolCalls] = useState<ToolCall[]>([]);
  const bufferRef = useRef("");
  const rafRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sendingRef = useRef(false);

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
      if (!opts.sessionId || !text.trim() || sendingRef.current) return;
      const controller = new AbortController();
      abortRef.current = controller;
      sendingRef.current = true;
      setSending(true);
      setToolCalls([]);
      try {
        const stamp = Date.now();
        opts.onUserAppend({
          id: `local-user-${stamp}`,
          role: "user",
          content: text
        });
        opts.onAssistantStart({
          id: `local-assistant-${stamp}`,
          role: "assistant",
          content: ""
        });
        const events = await opts.api.runChat(opts.sessionId, {
          providerId: opts.providerId,
          model: opts.model,
          message: text,
          contextFiles,
          permission: opts.permission,
          reasoning: opts.reasoning
        }, {
          signal: controller.signal
        });
        for await (const event of events) {
          if (controller.signal.aborted) break;
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
            const tool = {
              id,
              name: p.toolName ?? "tool",
              subtitle: toolSubtitle(p.args),
              status: "running"
            } satisfies ToolCall;
            setToolCalls((prev) => [...prev, tool]);
            opts.onToolCallUpdate?.(tool);
          }
          if (event.type === "tool_updated") {
            const p = event.payload as {
              toolCallId?: string;
              toolName?: string;
              args?: unknown;
              partialResult?: unknown;
            };
            const tool = {
              id: p.toolCallId ?? `tool-${Date.now()}`,
              name: p.toolName ?? "tool",
              subtitle: toolSubtitle(p.args),
              status: "running",
              result: resultText(p.partialResult)
            } satisfies ToolCall;
            setToolCalls((prev) =>
              prev.map((tc) => (tc.id === tool.id ? { ...tc, ...tool } : tc))
            );
            opts.onToolCallUpdate?.(tool);
          }
          if (event.type === "tool_completed" || event.type === "tool_failed") {
            const p = event.payload as { toolCallId?: string; toolName?: string; result?: unknown };
            const status = event.type === "tool_failed" ? "failed" : "done";
            const result = resultText(p.result);
            let nextTool: ToolCall | null = null;
            setToolCalls((prev) =>
              prev.map((tc) => {
                if (tc.id !== p.toolCallId) return tc;
                nextTool = { ...tc, status, result };
                return nextTool;
              })
            );
            if (p.toolCallId) {
              opts.onToolCallUpdate?.(
                nextTool ?? {
                  id: p.toolCallId,
                  name: p.toolName ?? "tool",
                  status,
                  result
                }
              );
            }
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
        if (!isAbortError(err)) opts.onError?.((err as Error).message);
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        sendingRef.current = false;
        setSending(false);
      }
    },
    [opts]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { send, stop, sending, toolCalls };
}
