import { useCallback, useRef, useState } from "react";
import { emptyUsage, fullResultText, resultText } from "@marginalia/chat-core";
import type {
  ChatAssistantMessage,
  ChatEntry,
  ChatToolCall,
  ChatToolExecutionResult,
  ChatToolResult
} from "@marginalia/chat-core";
import type { ApiClient, ApprovalPayload } from "@/api/client.js";

interface Options {
  api: ApiClient;
  sessionId: string | null;
  providerId: string;
  model: string;
  permission?: "full" | "ask" | "readonly";
  reasoning?: "low" | "medium" | "high" | "xhigh";
  onUserAppend: (m: ChatEntry) => void;
  onAssistantStart: (m: ChatEntry) => void;
  onAssistantReplace: (m: ChatEntry) => void;
  onAssistantDelta: (delta: string) => void;
  onToolCallUpsert?: (tool: ChatToolCall) => void;
  onToolProgress?: (toolCallId: string, output: string) => void;
  onToolResultUpsert?: (entry: ChatEntry & { message: ChatToolResult }) => void;
  onApprovalRequested?: (approval: {
    approvalId: string;
    toolCallId: string;
    toolName: string;
    payload: ApprovalPayload;
  }) => void;
  onApprovalResolved?: (update: {
    approvalId: string;
    toolCallId: string;
    approved: boolean;
    reason?: string;
    expired?: boolean;
  }) => void;
  onComplete: () => void;
  onError?: (msg: string) => void;
}

/** The subset of a raw pi `AgentSessionEvent` the chat UI derives state from. */
type PiEvent = {
  type?: string;
  assistantMessageEvent?: { type?: string; delta?: string };
  message?: unknown;
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  partialResult?: unknown;
  result?: ChatToolExecutionResult | string;
  isError?: boolean;
};

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException
    ? err.name === "AbortError"
    : err instanceof Error && err.name === "AbortError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isAssistantMessage(message: unknown): message is ChatAssistantMessage {
  return isRecord(message) && message.role === "assistant" && Array.isArray(message.content);
}

function isToolResultMessage(message: unknown): message is ChatToolResult {
  return (
    isRecord(message) &&
    message.role === "toolResult" &&
    typeof message.toolCallId === "string" &&
    typeof message.toolName === "string" &&
    Array.isArray(message.content) &&
    typeof message.isError === "boolean"
  );
}

function fallbackAssistant(
  providerId: string,
  model: string,
  timestamp: number
): ChatAssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: "marginalia-stream",
    provider: providerId,
    model,
    usage: emptyUsage(),
    stopReason: "stop",
    timestamp
  };
}

function toolCallFromEvent(pi: PiEvent): ChatToolCall | null {
  if (!pi.toolCallId) return null;
  return {
    type: "toolCall",
    id: pi.toolCallId,
    name: pi.toolName ?? "tool",
    arguments: isRecord(pi.args) ? pi.args : {}
  };
}

function toolResultEntryFromEvent(
  pi: PiEvent,
  timestamp: number
): (ChatEntry & { message: ChatToolResult }) | null {
  if (!pi.toolCallId) return null;
  const text = resultText(pi.result);
  const content: ChatToolResult["content"] = text ? [{ type: "text", text }] : [];
  return {
    id: `local-tool-result-${timestamp}-${pi.toolCallId}`,
    message: {
      role: "toolResult",
      toolCallId: pi.toolCallId,
      toolName: pi.toolName ?? "tool",
      content,
      isError: Boolean(pi.isError),
      timestamp: Date.now()
    }
  };
}

function toolResultEntryFromMessage(
  message: ChatToolResult,
  timestamp: number
): ChatEntry & { message: ChatToolResult } {
  return {
    id: `local-tool-result-${timestamp}-${message.toolCallId}`,
    message
  };
}

export function useStreamingChat(opts: Options) {
  const [sending, setSending] = useState(false);
  const [reasoning, setReasoning] = useState("");
  const bufferRef = useRef("");
  const rafRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sendingRef = useRef(false);

  const flush = useCallback(() => {
    if (bufferRef.current.length > 0) {
      const text = bufferRef.current;
      bufferRef.current = "";
      opts.onAssistantDelta(text);
    }
    rafRef.current = null;
  }, [opts]);

  const schedule = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(flush);
  }, [flush]);

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
      let turn = 0;
      let currentAssistantId: string | null = null;
      let needNewAssistant = true;

      function startAssistant(message?: ChatAssistantMessage): string {
        turn += 1;
        currentAssistantId = `local-assistant-${stamp}-${turn}`;
        opts.onAssistantStart({
          id: currentAssistantId,
          message: message ?? fallbackAssistant(opts.providerId, opts.model, stamp)
        });
        needNewAssistant = false;
        return currentAssistantId;
      }

      function ensureAssistant(message?: ChatAssistantMessage): string {
        if (needNewAssistant || !currentAssistantId) return startAssistant(message);
        if (message) opts.onAssistantReplace({ id: currentAssistantId, message });
        return currentAssistantId;
      }

      function handlePiEvent(pi: PiEvent) {
        switch (pi.type) {
          case "message_start": {
            if (isRecord(pi.message) && pi.message.role === "assistant") {
              needNewAssistant = true;
              startAssistant(isAssistantMessage(pi.message) ? pi.message : undefined);
            } else if (isToolResultMessage(pi.message)) {
              opts.onToolResultUpsert?.(toolResultEntryFromMessage(pi.message, stamp));
            }
            break;
          }
          case "message_update": {
            const ev = pi.assistantMessageEvent;
            if (isAssistantMessage(pi.message)) {
              ensureAssistant(pi.message);
            } else if (ev?.type === "text_delta" && ev.delta) {
              ensureAssistant();
              setReasoning("");
              bufferRef.current += ev.delta;
              schedule();
            }
            if (ev?.type === "thinking_delta" && ev.delta) {
              setReasoning((r) => r + ev.delta);
            }
            break;
          }
          case "message_end": {
            flush();
            setReasoning("");
            if (isAssistantMessage(pi.message)) ensureAssistant(pi.message);
            if (isToolResultMessage(pi.message)) {
              opts.onToolResultUpsert?.(toolResultEntryFromMessage(pi.message, stamp));
            }
            if (isRecord(pi.message) && pi.message.stopReason === "error") {
              const detail = pi.message.errorMessage;
              throw new Error(typeof detail === "string" ? detail : "agent failed");
            }
            break;
          }
          case "tool_execution_start": {
            const tool = toolCallFromEvent(pi);
            if (tool) {
              ensureAssistant();
              opts.onToolCallUpsert?.(tool);
            }
            break;
          }
          case "tool_execution_update": {
            const tool = toolCallFromEvent(pi);
            if (tool) {
              ensureAssistant();
              opts.onToolCallUpsert?.(tool);
            }
            if (pi.toolCallId) {
              const output = fullResultText(pi.partialResult as never);
              if (output !== undefined) opts.onToolProgress?.(pi.toolCallId, output);
            }
            break;
          }
          case "tool_execution_end": {
            const entry = toolResultEntryFromEvent(pi, stamp);
            if (entry) opts.onToolResultUpsert?.(entry);
            break;
          }
        }
      }

      try {
        opts.onUserAppend({
          id: `local-user-${stamp}`,
          message: { role: "user", content: text, timestamp: stamp }
        });
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
          if (event.type === "approval_requested") {
            const approval = (
              event.payload as
                | {
                    approval?: {
                      approvalId: string;
                      toolCallId: string;
                      toolName: string;
                      payload: ApprovalPayload;
                    };
                  }
                | undefined
            )?.approval;
            if (approval) opts.onApprovalRequested?.(approval);
            continue;
          }
          if (event.type === "approval_resolved") {
            const approval = (
              event.payload as
                | {
                    approval?: {
                      approvalId: string;
                      toolCallId: string;
                      approved: boolean;
                      reason?: string;
                      expired?: boolean;
                    };
                  }
                | undefined
            )?.approval;
            if (approval) opts.onApprovalResolved?.(approval);
            continue;
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
    [flush, opts, schedule]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { send, stop, sending, reasoning };
}
