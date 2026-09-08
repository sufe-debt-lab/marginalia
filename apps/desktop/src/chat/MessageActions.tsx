import { Check, Copy, Download, FolderDown, X } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { copyText } from "@/lib/clipboard.js";
import { cn } from "@/lib/cn.js";
import { saveTextFile } from "@/lib/save-file.js";
import { useFlashStatus, type FlashStatus } from "@/lib/use-flash-status.js";

const DEFAULT_NAME = "marginalia.md";

function statusIcon(status: FlashStatus, Idle: typeof Copy) {
  if (status === "ok") return <Check className="h-3.5 w-3.5 text-brand" />;
  if (status === "err") return <X className="h-3.5 w-3.5 text-danger" />;
  return <Idle className="h-3.5 w-3.5" />;
}

/**
 * Hover action bar shown over an assistant message: copy the full markdown,
 * export it to a .md file via the Electron save dialog, and (optionally, once
 * a handler is wired in) save it into the current workspace. Copy and export
 * flash success/failure on the button itself; a cancelled save dialog stays quiet.
 */
export function MessageActions({
  markdown,
  defaultName = DEFAULT_NAME,
  onSaveToWorkspace
}: {
  markdown: string;
  defaultName?: string;
  onSaveToWorkspace?: () => void;
}) {
  const { t } = useTranslation();
  const [copyStatus, flashCopy] = useFlashStatus();
  const [exportStatus, flashExport] = useFlashStatus();

  const copyLabel =
    copyStatus === "ok"
      ? t("common.copied")
      : copyStatus === "err"
        ? t("common.copyFailed")
        : t("message.copyAll");
  const exportLabel =
    exportStatus === "ok"
      ? t("message.exported")
      : exportStatus === "err"
        ? t("message.exportFailed")
        : t("message.exportMd");

  async function handleExport() {
    const result = await saveTextFile(defaultName, markdown);
    if (result.saved) flashExport("ok");
    else if (result.error) flashExport("err");
    // saved:false without an error is a cancelled dialog — no feedback needed.
  }

  return (
    <div className="flex items-center gap-0.5 rounded-md border border-border-soft bg-surface p-0.5 shadow-sm">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn("h-6 w-6 text-text-muted", copyStatus === "err" && "text-danger")}
        aria-label={copyLabel}
        title={copyLabel}
        onClick={() => void copyText(markdown).then((ok) => flashCopy(ok ? "ok" : "err"))}
      >
        {statusIcon(copyStatus, Copy)}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn("h-6 w-6 text-text-muted", exportStatus === "err" && "text-danger")}
        aria-label={exportLabel}
        title={exportLabel}
        onClick={() => void handleExport()}
      >
        {statusIcon(exportStatus, Download)}
      </Button>
      {onSaveToWorkspace && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-text-muted"
          aria-label={t("message.saveToWorkspace")}
          title={t("message.saveToWorkspace")}
          onClick={onSaveToWorkspace}
        >
          <FolderDown className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
