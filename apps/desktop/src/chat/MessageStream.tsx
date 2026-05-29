import { useEffect, useRef } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import type { Message } from "@/api/client.js";
import { Button } from "@/components/ui/button.js";
import type { ToolCall } from "@/hooks/useStreamingChat.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { MessageItem } from "./MessageItem.js";
import { ToolCard } from "./ToolCard.js";

interface Props {
  messages: readonly Message[];
  error: string | null;
  onRetry: () => void;
  model?: string;
  streaming?: boolean;
  toolCalls?: readonly ToolCall[];
}

export function MessageStream({ messages, error, onRetry, model, streaming, toolCalls }: Props) {
  const { t } = useTranslation();
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof bottomRef.current?.scrollIntoView === "function") {
      bottomRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages.length]);

  if (messages.length === 0 && !error) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t("chat.noMessages")}
      </div>
    );
  }

  const lastIndex = messages.length - 1;

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
      {toolCalls && toolCalls.length > 0 && (
        <div className="flex flex-col gap-2">
          {toolCalls.map((tc) => (
            <ToolCard key={tc.id} tool={tc} />
          ))}
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
