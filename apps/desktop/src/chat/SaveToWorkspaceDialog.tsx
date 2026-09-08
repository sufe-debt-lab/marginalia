import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { useTranslation } from "@/i18n/useTranslation.js";

type Step = "input" | "confirm-overwrite" | "saving";

/**
 * User-initiated "save this answer into the workspace" dialog: pick a file
 * name, then — only if the write comes back as an existing file — confirm an
 * overwrite. This is a direct write the user asked for; it does not go
 * through the agent tool-call approval flow.
 */
export function SaveToWorkspaceDialog({
  open,
  defaultName,
  onCancel,
  onSave
}: {
  open: boolean;
  defaultName: string;
  onCancel: () => void;
  onSave: (fileName: string, overwrite: boolean) => Promise<"saved" | "exists">;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>("input");
  const [name, setName] = useState(defaultName);
  // The exact file name that produced a 409, frozen at that moment. The
  // overwrite confirm step always targets this — never whatever `name` (the
  // input's live value) happens to hold — so it can't drift even if the
  // input were still mounted/editable, or `name` changed for other reasons.
  const [pendingName, setPendingName] = useState("");

  // Reset to a clean "input" step whenever the dialog (re)opens. Deliberately
  // depends on `open` alone: while the dialog stays open, a parent re-render
  // that passes a new `defaultName` must NOT clobber what the user typed (or
  // the name already frozen for an overwrite confirm).
  useEffect(() => {
    if (!open) return;
    setStep("input");
    setName(defaultName);
    setPendingName("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleSave() {
    const fileName = name;
    setStep("saving");
    const result = await onSave(fileName, false);
    if (result === "exists") {
      setPendingName(fileName);
      setStep("confirm-overwrite");
    }
    // "saved": the parent closes the dialog by flipping `open`; nothing left to do here.
  }

  async function handleOverwrite() {
    setStep("saving");
    await onSave(pendingName, true);
  }

  const saving = step === "saving";
  const confirmingOverwrite = step === "confirm-overwrite";

  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("saveDialog.title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {confirmingOverwrite ? t("saveDialog.overwriteHint") : t("saveDialog.description")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {!confirmingOverwrite && (
          <div className="space-y-1.5">
            <label
              htmlFor="save-to-workspace-name"
              className="text-[10.5px] font-semibold uppercase tracking-wider text-text-muted"
            >
              {t("saveDialog.fileNameLabel")}
            </label>
            <Input
              id="save-to-workspace-name"
              value={name}
              disabled={saving}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                // AlertDialog has no form element, so Enter must submit explicitly.
                if (e.key === "Enter" && !saving && name.trim()) {
                  e.preventDefault();
                  void handleSave();
                }
              }}
            />
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel} disabled={saving}>
            {t("common.cancel")}
          </AlertDialogCancel>
          {confirmingOverwrite ? (
            <Button onClick={() => void handleOverwrite()} disabled={saving}>
              {t("saveDialog.overwrite")}
            </Button>
          ) : (
            <Button onClick={() => void handleSave()} disabled={saving || !name.trim()}>
              {t("saveDialog.save")}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
