import { useRef, useState } from "react";
import { ShieldAlert } from "lucide-react";
import type { Approval } from "@/api/client.js";
import { Button } from "@/components/ui/button.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { DiffView } from "./DiffView.js";

type Decision = { approved: boolean; reason?: string; alwaysAllowPrefix?: boolean };

export function ApprovalCard({
  approval,
  onDecide
}: {
  approval: Approval;
  onDecide(decision: Decision): Promise<void> | void;
}) {
  const { t } = useTranslation();
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const payload = approval.payload;

  function resetSubmission() {
    submittingRef.current = false;
    setSubmitting(false);
  }

  function submitDecision(decision: Decision) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      void Promise.resolve(onDecide(decision)).catch(resetSubmission);
    } catch (error) {
      resetSubmission();
      throw error;
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-warn bg-warn-soft px-3 py-2.5 text-sm">
      <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-warn">
        <ShieldAlert className="h-3.5 w-3.5" />
        {t("approval.title")}
      </span>

      {payload.kind === "command" ? (
        <>
          <code className="mono block overflow-x-auto rounded bg-surface px-2 py-1.5 text-[12.5px]">
            {payload.command}
          </code>
          <span className="text-[11.5px] text-text-muted">
            {t("approval.workingDir")}: <span className="mono">{payload.cwd}</span>
          </span>
          <span className="text-[12px] text-text-muted">{t("approval.hostCommand")}</span>
        </>
      ) : (
        <>
          <span className="text-[12px] text-text-muted">
            {payload.mode === "edit" ? t("approval.modeEdit") : t("approval.modeWrite")}
          </span>
          <span className="mono text-[12.5px]">
            {payload.path}
            <span className="ml-2 text-brand">+{payload.additions}</span>
            <span className="ml-1 text-danger">-{payload.deletions}</span>
            {!payload.exact && (
              <span className="ml-2 rounded bg-surface px-1.5 py-0.5 text-[11px] text-text-muted">
                {t("approval.approxPreview")}
              </span>
            )}
          </span>
          {payload.error ? (
            <span className="text-[12px] text-danger">{payload.error}</span>
          ) : (
            <DiffView patch={payload.patch} />
          )}
        </>
      )}

      {denying ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={reason}
            disabled={submitting}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("approval.denyReasonPlaceholder")}
            rows={2}
            className="rounded-md border border-border-soft bg-surface px-2 py-1.5 text-[12.5px]"
          />
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={submitting}
              onClick={() =>
                submitDecision({ approved: false, reason: reason.trim() || undefined })
              }
            >
              {t("approval.confirmDeny")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={submitting}
              onClick={() => setDenying(false)}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={submitting}
            onClick={() =>
              submitDecision({
                approved: true
              })
            }
          >
            {t("approval.allow")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={submitting}
            onClick={() => setDenying(true)}
          >
            {t("approval.deny")}
          </Button>
        </div>
      )}
    </div>
  );
}
