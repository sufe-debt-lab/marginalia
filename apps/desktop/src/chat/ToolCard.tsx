import { ChevronRight, FileText } from "lucide-react";
import type { ToolCall } from "@/hooks/useStreamingChat.js";
import { cn } from "@/lib/cn.js";

/**
 * Inline tool-call card in the message stream (design: views.jsx ToolCard).
 * Status dot: running → pulse, done → ok, failed → err.
 */
export function ToolCard({ tool }: { tool: ToolCall }) {
  const dot = tool.status === "running" ? "ok pulse" : tool.status === "failed" ? "err" : "ok";
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2 text-[12.5px]">
      <span className={cn("dot", dot)} />
      <FileText className="h-3.5 w-3.5 text-text-muted" />
      <span className="font-medium">{tool.name}</span>
      {tool.subtitle && <span className="mono text-[11.5px] text-text-muted">{tool.subtitle}</span>}
      <span className="flex-1" />
      <ChevronRight className="h-3 w-3 text-text-faint" />
    </div>
  );
}
