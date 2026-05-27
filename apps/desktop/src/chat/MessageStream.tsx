import { useEffect, useRef } from "react";
import type { Message } from "@/api/client.js";
import { Button } from "@/components/ui/button.js";
import { MessageItem } from "./MessageItem.js";

interface Props {
  messages: readonly Message[];
  error: string | null;
  onRetry: () => void;
}

export function MessageStream({ messages, error, onRetry }: Props) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof bottomRef.current?.scrollIntoView === "function") {
      bottomRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages.length]);

  if (messages.length === 0 && !error) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No messages yet
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
      {messages.map((m) => (
        <MessageItem key={m.id} message={m} />
      ))}
      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <span className="flex-1">{error}</span>
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
