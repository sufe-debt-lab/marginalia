import { useCallback, useRef, useState } from "react";
import { resultText, toolSubtitle } from "@marginalia/chat-core";
import type { ApiClient, Message, ToolCall } from "@/api/client.js";

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

/** The subset of a raw pi `AgentSessionEvent` the chat UI derives state from. */
type PiEvent = {
  type?: string;
  assistantMessageEvent?: { type?: string; delta?: string };
  message?: { role?: string; stopReason?: string; errorMessage?: string };
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  partialResult?: unknown;
  result?: unknown;
  isError?: boolean;
};

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException
    ? err.name === "AbortError"
    : err instanceof Error && err.name === "AbortError";
}

export function useStreamingChat(opts: Options) {
  const [sending, setSending] = useState(false);
  // Transient reasoning text for the current turn; shown while the model thinks,
  // cleared once the answer starts. Not persisted (a reopened session has none).
  const [reasoning, setReasoning] = useState("");
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
      if (!opts.sessionId || sendingRef.current) return;
      if (!text.trim() && contextFiles.length === 0) return;
      const controller = new AbortController();
      abortRef.current = controller;
      sendingRef.current = true;
      setSending(true);
      setReasoning("");
      const stamp = Date.now();
      // pi emits one assistant message per turn, bounded by message_start. We open a
      // bubble lazily on the first content of each message (text or tool), so the live
      // view splits bubbles exactly like a reopened session — and a run that fails
      // before any content leaves no empty bubble behind. Tool execution events fire
      // after their message's message_end but before the next message_start, so they
      // still attach to the message that declared them.
      let turn = 0;
      let needNewBubble = true;

      function ensureBubble() {
        if (!needNewBubble) return;
        turn += 1;
        opts.onAssistantStart({
          id: `local-assistant-${stamp}-${turn}`,
          role: "assistant",
          content: ""
        });
        needNewBubble = false;
      }

      function handlePiEvent(pi: PiEvent) {
        switch (pi.type) {
          case "message_start":
            // A new assistant message → the next content opens a fresh bubble.
            if (pi.message?.role === "assistant") needNewBubble = true;
            break;
          case "message_update": {
            const ev = pi.assistantMessageEvent;
            if (ev?.type === "thinking_delta" && ev.delta) {
              setReasoning((r) => r + ev.delta);
            }
            if (ev?.type === "text_delta" && ev.delta) {
              ensureBubble();
              setReasoning((r) => (r ? "" : r));
              bufferRef.current += ev.delta;
              schedule();
            }
            break;
          }
          case "message_end": {
            flush();
            setReasoning("");
            if (pi.message?.stopReason === "error") {
              throw new Error(pi.message.errorMessage ?? "agent failed");
            }
            break;
          }
          case "tool_execution_start":
            if (pi.toolCallId) {
              ensureBubble();
              opts.onToolCallUpdate?.({
                id: pi.toolCallId,
                name: pi.toolName ?? "tool",
                subtitle: toolSubtitle(pi.args),
                status: "running"
              });
            }
            break;
          case "tool_execution_update":
            if (pi.toolCallId) {
              opts.onToolCallUpdate?.({
                id: pi.toolCallId,
                name: pi.toolName ?? "tool",
                subtitle: toolSubtitle(pi.args),
                status: "running",
                result: resultText(pi.partialResult)
              });
            }
            break;
          case "tool_execution_end":
            if (pi.toolCallId) {
              opts.onToolCallUpdate?.({
                id: pi.toolCallId,
                name: pi.toolName ?? "tool",
                status: pi.isError ? "failed" : "done",
                result: resultText(pi.result)
              });
            }
            break;
        }
      }

      try {
        opts.onUserAppend({ id: `local-user-${stamp}`, role: "user", content: text });
        const events = await opts.api.runChat(
          opts.sessionId,
          {
            providerId: opts.providerId,
            model: opts.model,
            message: text,
            contextFiles,
            permission: opts.permission,
            reasoning: opts.reasoning
          },
          { signal: controller.signal }
        );
        for await (const event of events) {
          if (controller.signal.aborted) break;
          if (event.type === "run_failed") {
            throw new Error(
              (event.payload as { error?: string } | undefined)?.error ?? "run failed"
            );
          }
          if (event.type !== "agent_event") continue;
          const pi = (event.payload as { event?: PiEvent } | undefined)?.event;
          if (pi) handlePiEvent(pi);
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

  return { send, stop, sending, reasoning };
}
