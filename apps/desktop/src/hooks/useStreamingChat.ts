import { useCallback, useRef, useState } from "react";
import {
  emptyUsage,
  formatUserDisplayText,
  fullResultText,
  resultText
} from "@marginalia/chat-core";
import type {
  ChatAssistantMessage,
  ChatEntry,
  ChatToolCall,
  ChatToolExecutionResult,
  ChatToolResult
} from "@marginalia/chat-core";
import type { ApiClient, ApiError, ApprovalPayload } from "@/api/client.js";
import type { TurnDraft } from "@/store/app-store.js";

export type SendCallbacks = {
  onAccepted(turn: TurnDraft, optimisticEntry: ChatEntry): void;
  onError(error: ApiError | Error, accepted: boolean): void;
};

interface Options extends SendCallbacks {
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

function cloneTurnDraft(turn: TurnDraft): TurnDraft {
  return {
    text: turn.text,
    contextFiles: [...turn.contextFiles],
    skills: turn.skills.map((skill) => ({ ...skill }))
  };
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
  const bufferRef = useRef("");
  // Latest cumulative live-output snapshot per running toolCallId. Sharing the
  // rAF flush with text deltas caps tool progress at one state update per
  // frame — high-frequency bash output must not re-render the stream per event.
  const progressRef = useRef(new Map<string, string>());
  const rafRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sendingRef = useRef(false);

  const flush = useCallback(() => {
    if (bufferRef.current.length > 0) {
      const text = bufferRef.current;
      bufferRef.current = "";
      opts.onAssistantDelta(text);
    }
    if (progressRef.current.size > 0) {
      const snapshots = progressRef.current;
      progressRef.current = new Map();
      for (const [toolCallId, output] of snapshots) opts.onToolProgress?.(toolCallId, output);
    }
    rafRef.current = null;
  }, [opts]);

  const schedule = useCallback(() => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(flush);
  }, [flush]);

  const send = useCallback(
    async (input: TurnDraft) => {
      if (!opts.sessionId || sendingRef.current) return;
      const sentTurn = cloneTurnDraft(input);
      if (
        !sentTurn.text.trim() &&
        sentTurn.contextFiles.length === 0 &&
        sentTurn.skills.length === 0
      )
        return;
      const controller = new AbortController();
      abortRef.current = controller;
      sendingRef.current = true;
      setSending(true);
      progressRef.current = new Map();
      const stamp = Date.now();
      let turn = 0;
      let currentAssistantId: string | null = null;
      let needNewAssistant = true;
      let accepted = false;

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
              progressRef.current.delete(pi.message.toolCallId);
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
              bufferRef.current += ev.delta;
              schedule();
            }
            break;
          }
          case "message_end": {
            flush();
            if (isAssistantMessage(pi.message)) ensureAssistant(pi.message);
            if (isToolResultMessage(pi.message)) {
              progressRef.current.delete(pi.message.toolCallId);
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
              if (output !== undefined) {
                progressRef.current.set(pi.toolCallId, output);
                schedule();
              }
            }
            break;
          }
          case "tool_execution_end": {
            const entry = toolResultEntryFromEvent(pi, stamp);
            if (entry) {
              // The final result supersedes any buffered snapshot; dropping it
              // here keeps a late flush from resurrecting a finished call's
              // live-output area.
              progressRef.current.delete(entry.message.toolCallId);
              opts.onToolResultUpsert?.(entry);
            }
            break;
          }
        }
      }

      try {
        const events = await opts.api.runChat(
          opts.sessionId,
          {
            providerId: opts.providerId,
            model: opts.model,
            message: sentTurn.text,
            contextFiles: sentTurn.contextFiles,
            skills: sentTurn.skills,
            permission: opts.permission,
            reasoning: opts.reasoning
          },
          { signal: controller.signal }
        );
        for await (const event of events) {
          if (controller.signal.aborted) break;
          if (event.type === "run_started") {
            if (accepted) continue;
            accepted = true;
            const optimisticEntry: ChatEntry = {
              id: `local-user-${stamp}`,
              message: {
                role: "user",
                content: formatUserDisplayText(
                  sentTurn.text,
                  sentTurn.skills.map((skill) => skill.name)
                ),
                timestamp: stamp
              }
            };
            opts.onUserAppend(optimisticEntry);
            opts.onAccepted(cloneTurnDraft(sentTurn), optimisticEntry);
            continue;
          }
          if (event.type === "run_failed") {
            throw new Error(
              (event.payload as { error?: string } | undefined)?.error ?? "run failed"
            );
          }
          if (!accepted) continue;
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
        if (!controller.signal.aborted) {
          if (!accepted) throw new Error("run ended before starting");
          opts.onComplete();
        }
      } catch (err) {
        flush();
        if (!isAbortError(err))
          opts.onError(err instanceof Error ? err : new Error(String(err)), accepted);
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

  return { send, stop, sending };
}
