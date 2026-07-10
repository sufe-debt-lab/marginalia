import { ChevronRight, Clock3, FileText, ShieldX } from "lucide-react";
import { resultText, toolSubtitle } from "@marginalia/chat-core";
import type { ChatToolCall, ChatToolResult } from "@marginalia/chat-core";
import type { Approval } from "@/api/client.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { cn } from "@/lib/cn.js";
import { ApprovalCard } from "./ApprovalCard.js";

/** Shape handed back from the inline approval UI to the caller's resolve-approval call. */
export type ApprovalDecision = { approved: boolean; reason?: string; alwaysAllowPrefix?: boolean };

export function ToolCard({
  call,
  result,
  approval,
  onDecideApproval
}: {
  call: ChatToolCall;
  result?: ChatToolResult;
  approval?: Approval;
  onDecideApproval?: (approvalId: string, decision: ApprovalDecision) => void;
}) {
  const { t } = useTranslation();
  const status = !result ? "running" : result.isError ? "failed" : "done";
  const dot =
    approval?.status === "pending"
      ? "warn"
      : approval?.status === "denied" || approval?.status === "expired"
        ? "err"
        : status === "running"
          ? "ok pulse"
          : status === "failed"
            ? "err"
            : "ok";
  const subtitle = toolSubtitle(call.arguments);
  const text = resultText(result);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2 text-[12.5px]">
        <span className={cn("dot", dot)} />
        <FileText className="h-3.5 w-3.5 text-text-muted" />
        <span className="font-medium">{call.name}</span>
        {subtitle && <span className="mono text-[11.5px] text-text-muted">{subtitle}</span>}
        {text && <span className="truncate text-[11.5px] text-text-muted">{text}</span>}
        <span className="flex-1" />
        <ChevronRight className="h-3 w-3 text-text-faint" />
      </div>
      {approval?.status === "pending" && (
        <ApprovalCard
          approval={approval}
          onDecide={(decision) => onDecideApproval?.(approval.id, decision)}
        />
      )}
      {approval?.status === "denied" && (
        <div className="flex items-center gap-2 rounded-lg border border-danger bg-danger-soft px-3 py-1.5 text-[12px] text-danger">
          <ShieldX className="h-3.5 w-3.5 shrink-0" />
          <span className="font-medium">{t("approval.denied")}</span>
          {approval.reason && <span className="text-text-muted">· {approval.reason}</span>}
        </div>
      )}
      {approval?.status === "expired" && (
        <div className="flex items-center gap-2 rounded-lg border border-danger bg-danger-soft px-3 py-1.5 text-[12px] text-danger">
          <Clock3 className="h-3.5 w-3.5 shrink-0" />
          <span className="font-medium">{t("approval.expired")}</span>
        </div>
      )}
    </div>
  );
}
