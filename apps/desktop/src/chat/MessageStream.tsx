import { useEffect, useRef } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import type { Message } from "@/api/client.js";
import { Button } from "@/components/ui/button.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { MessageItem } from "./MessageItem.js";

interface Props {
  messages: readonly Message[];
  error: string | null;
  onRetry: () => void;
  model?: string;
  streaming?: boolean;
  /** Transient reasoning text for the in-flight turn; shown while the model thinks. */
  reasoning?: string;
}

export function MessageStream({ messages, error, onRetry, model, streaming, reasoning }: Props) {
  const { t } = useTranslation();
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const lastIndex = messages.length - 1;

  // Follow the conversation as it grows AND as the last message streams in
  // (delta updates don't change messages.length, so depend on the content too).
  const last = messages[lastIndex];
  const tail = `${messages.length}:${last?.content.length ?? 0}:${last?.toolCalls?.length ?? 0}:${reasoning?.length ?? 0}`;
  useEffect(() => {
    if (typeof bottomRef.current?.scrollIntoView === "function") {
      bottomRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [tail]);

  if (messages.length === 0 && !error) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t("chat.noMessages")}
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
      {messages.map((m, i) => (
        <MessageItem
          key={m.id}
          message={m}
          model={m.role === "assistant" ? model : undefined}
          streaming={Boolean(streaming) && i === lastIndex && m.role === "assistant"}
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
