import { useCallback, useRef, useState } from "react";
import type { ApiClient, Message } from "@/api/client.js";

interface Options {
  api: ApiClient;
  sessionId: string | null;
  providerId: string;
  model: string;
  onUserAppend: (m: Message) => void;
  onAssistantStart: (m: Message) => void;
  onAssistantDelta: (delta: string) => void;
  onComplete: () => void;
  onError?: (msg: string) => void;
}

export function useStreamingChat(opts: Options) {
  const [sending, setSending] = useState(false);
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
          contextFiles
        });
        for await (const event of events) {
          if (event.type === "assistant_delta") {
            const delta = (event.payload as { text?: string } | undefined)?.text ?? "";
            if (delta) {
              bufferRef.current += delta;
              schedule();
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
        opts.onError?.((err as Error).message);
      } finally {
        setSending(false);
      }
    },
    [opts]
  );

  return { send, sending };
}
