import { ChevronRight, FileText } from "lucide-react";
import { resultText, toolSubtitle } from "@marginalia/chat-core";
import type { ChatToolCall, ChatToolResult } from "@marginalia/chat-core";
import { cn } from "@/lib/cn.js";

export function ToolCard({ call, result }: { call: ChatToolCall; result?: ChatToolResult }) {
  const status = !result ? "running" : result.isError ? "failed" : "done";
  const dot = status === "running" ? "ok pulse" : status === "failed" ? "err" : "ok";
  const subtitle = toolSubtitle(call.arguments);
  const text = resultText(result);
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2 text-[12.5px]">
      <span className={cn("dot", dot)} />
      <FileText className="h-3.5 w-3.5 text-text-muted" />
      <span className="font-medium">{call.name}</span>
      {subtitle && <span className="mono text-[11.5px] text-text-muted">{subtitle}</span>}
      {text && <span className="truncate text-[11.5px] text-text-muted">{text}</span>}
      <span className="flex-1" />
      <ChevronRight className="h-3 w-3 text-text-faint" />
    </div>
  );
}
