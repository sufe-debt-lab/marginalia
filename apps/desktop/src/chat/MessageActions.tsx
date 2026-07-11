import { Copy, Download, FolderDown } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { saveTextFile } from "@/lib/save-file.js";

const DEFAULT_NAME = "marginalia.md";

/**
 * Hover action bar shown over an assistant message: copy the full markdown,
 * export it to a .md file via the Electron save dialog, and (optionally, once
 * a handler is wired in) save it into the current workspace.
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

  return (
    <div className="flex items-center gap-0.5 rounded-md border border-border-soft bg-surface p-0.5 shadow-sm">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6 text-text-muted"
        aria-label={t("message.copyAll")}
        onClick={() => void navigator.clipboard.writeText(markdown)}
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6 text-text-muted"
        aria-label={t("message.exportMd")}
        onClick={() => void saveTextFile(defaultName, markdown)}
      >
        <Download className="h-3.5 w-3.5" />
      </Button>
      {onSaveToWorkspace && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-text-muted"
          aria-label={t("message.saveToWorkspace")}
          onClick={onSaveToWorkspace}
        >
          <FolderDown className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
