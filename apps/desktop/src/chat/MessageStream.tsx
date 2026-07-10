import { useEffect, useMemo, useRef } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { stringifyContent } from "@marginalia/chat-core";
import type { ChatEntry, ChatToolResult } from "@marginalia/chat-core";
import type { Approval } from "@/api/client.js";
import { Button } from "@/components/ui/button.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { MessageItem } from "./MessageItem.js";
import type { ApprovalDecision } from "./ToolCard.js";

interface Props {
  messages: readonly ChatEntry[];
  error: string | null;
  onRetry: () => void;
  model?: string;
  streaming?: boolean;
  /** Transient reasoning text for the in-flight turn; shown while the model thinks. */
  reasoning?: string;
  approvalsByToolCallId?: ReadonlyMap<string, Approval>;
  onDecideApproval?: (approvalId: string, decision: ApprovalDecision) => void;
}

export function MessageStream({
  messages,
  error,
  onRetry,
  model,
  streaming,
  reasoning,
  approvalsByToolCallId,
  onDecideApproval
}: Props) {
  const { t } = useTranslation();
  const bottomRef = useRef<HTMLDivElement | null>(null);
  // One pass splits toolResults out (they attach to their tool call, not their own bubble) and
  // builds the lookup map. Memoizing keeps the map reference stable across streaming deltas so
  // memoized MessageItems only re-render when their own entry changes.
  const { toolResultsByCallId, visibleMessages } = useMemo(() => {
    const results = new Map<string, ChatToolResult>();
    const visible: ChatEntry[] = [];
    for (const entry of messages) {
      if (entry.message.role === "toolResult") results.set(entry.message.toolCallId, entry.message);
      else visible.push(entry);
    }
    return { toolResultsByCallId: results, visibleMessages: visible };
  }, [messages]);

  const lastIndex = visibleMessages.length - 1;

  // Follow the conversation as it grows AND as the last message streams in
  // (delta updates don't change messages.length, so depend on the content too).
  const last = visibleMessages[lastIndex];
  const lastText =
    last?.message.role === "user" || last?.message.role === "assistant"
      ? stringifyContent(last.message.content)
      : "";
  const tail = `${messages.length}:${lastText.length}:${toolResultsByCallId.size}:${reasoning?.length ?? 0}`;
  useEffect(() => {
    if (typeof bottomRef.current?.scrollIntoView === "function") {
      // data-motion="off" covers both screenshot mode and the OS reduced-motion
      // preference (mirrored onto the attribute in main.tsx).
      const reduceMotion = document.documentElement.dataset.motion === "off";
      bottomRef.current.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "end"
      });
    }
  }, [tail]);

  if (visibleMessages.length === 0 && !error) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t("chat.noMessages")}
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
      {visibleMessages.map((entry, i) => (
        <MessageItem
          key={entry.id}
          entry={entry}
          toolResultsByCallId={toolResultsByCallId}
          approvalsByToolCallId={approvalsByToolCallId}
          onDecideApproval={onDecideApproval}
          model={entry.message.role === "assistant" ? model : undefined}
          streaming={Boolean(streaming) && i === lastIndex && entry.message.role === "assistant"}
        />
      ))}
      {streaming && reasoning && (
        <div className="flex flex-col gap-1 rounded-lg border border-soft bg-surface px-3 py-2">
          <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-text-faint">
            <span className="dot ok pulse" />
            {t("chat.thinking")}
          </span>
          <div className="max-h-32 overflow-auto whitespace-pre-wrap text-[12.5px] italic text-text-muted">
            {reasoning}
          </div>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2.5 rounded-lg border border-danger bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="flex-1">
            <strong>run_failed</strong> · {error}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            className="border-danger bg-surface text-danger hover:bg-danger-soft"
          >
            <RotateCw className="mr-1 h-3 w-3" />
            {t("common.retry")}
          </Button>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
