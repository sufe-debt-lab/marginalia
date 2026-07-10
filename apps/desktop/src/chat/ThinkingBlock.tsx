import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn.js";
import { useTranslation } from "@/i18n/useTranslation.js";

export function ThinkingBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const startedAtRef = useRef<number>(Date.now());
  const [seconds, setSeconds] = useState<number | null>(null);

  useEffect(() => {
    if (!streaming && seconds === null && startedAtRef.current) {
      // Freeze the live duration once thinking finishes. Reopened sessions
      // mount with streaming=false on the first render and show no seconds.
      const elapsed = Math.round((Date.now() - startedAtRef.current) / 1000);
      setSeconds(elapsed > 0 ? elapsed : null);
    }
  }, [streaming, seconds]);

  if (streaming) {
    return (
      <div className="flex flex-col gap-1 border-l border-border pl-3">
        <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-text-faint">
          <span className="dot ok pulse" />
          {t("chat.thinkingLive")}
        </span>
        <div className="max-h-32 overflow-auto whitespace-pre-wrap text-[12.5px] italic text-text-muted">
          {text}
        </div>
      </div>
    );
  }

  return (
    <div className="border-l border-border pl-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 text-[11.5px] text-text-faint hover:text-text-muted"
      >
        <ChevronRight className={cn("h-3 w-3 transition-transform", expanded && "rotate-90")} />
        {seconds ? t("chat.thoughtFor").replace("{s}", String(seconds)) : t("chat.thought")}
      </button>
      {expanded && (
        <div className="mt-1 whitespace-pre-wrap text-[12.5px] italic text-text-muted">{text}</div>
      )}
    </div>
  );
}
