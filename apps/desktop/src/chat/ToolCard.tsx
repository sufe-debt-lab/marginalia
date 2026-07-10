import { useState } from "react";
import {
  ChevronRight,
  Clock3,
  FilePen,
  FileText,
  Search,
  ShieldX,
  Terminal,
  Wrench
} from "lucide-react";
import { fullResultText, resultText, toolSummary } from "@marginalia/chat-core";
import type { ChatToolCall, ChatToolResult } from "@marginalia/chat-core";
import type { Approval } from "@/api/client.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { cn } from "@/lib/cn.js";
import { ApprovalCard } from "./ApprovalCard.js";
import { DiffView } from "./DiffView.js";

/** Shape handed back from the inline approval UI to the caller's resolve-approval call. */
export type ApprovalDecision = { approved: boolean; reason?: string; alwaysAllowPrefix?: boolean };

const TOOL_ICONS: Record<string, typeof FileText> = {
  read: FileText,
  edit: FilePen,
  write: FilePen,
  bash: Terminal,
  grep: Search,
  find: Search
};

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
  const [expanded, setExpanded] = useState(false);
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
  const summary = toolSummary(call);
  const text = resultText(result);
  const full = fullResultText(result);
  const Icon = TOOL_ICONS[call.name] ?? Wrench;
  const fileEditPatch = approval?.payload.kind === "file_edit" ? approval.payload : null;

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2 text-left text-[12.5px]"
      >
        <span className={cn("dot", dot)} />
        <Icon className="h-3.5 w-3.5 shrink-0 text-text-muted" />
        <span className="font-medium">{summary.title}</span>
        {summary.detail && (
          <span className="mono truncate text-[11.5px] text-text-muted">{summary.detail}</span>
        )}
        {fileEditPatch && (
          <span className="ml-1">
            <span className="text-brand">+{fileEditPatch.additions}</span>{" "}
            <span className="text-danger">-{fileEditPatch.deletions}</span>
          </span>
        )}
        {text && <span className="truncate text-[11.5px] text-text-muted">{text}</span>}
        <span className="flex-1" />
        <ChevronRight
          className={cn(
            "h-3 w-3 shrink-0 text-text-faint transition-transform",
            expanded && "rotate-90"
          )}
        />
      </button>
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
      {expanded && (
        <div className="flex flex-col gap-2 rounded-lg border border-soft bg-surface px-3 py-2">
          {fileEditPatch ? (
            <DiffView patch={fileEditPatch.patch} />
          ) : (
            <pre className="mono max-h-40 overflow-auto whitespace-pre-wrap break-all text-[11.5px] text-text-muted">
              {JSON.stringify(call.arguments, null, 2)}
            </pre>
          )}
          {full && (
            <div className="relative">
              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(full)}
                className="absolute right-1 top-1 rounded border border-soft bg-surface px-1.5 py-0.5 text-[11px] text-text-muted hover:bg-surface-3"
              >
                {t("common.copy")}
              </button>
              <pre className="mono max-h-64 overflow-auto whitespace-pre-wrap break-all text-[12px]">
                {full}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
