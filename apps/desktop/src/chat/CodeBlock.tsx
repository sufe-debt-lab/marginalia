import { highlightCode } from "@/lib/highlight.js";
import { useTranslation } from "@/i18n/useTranslation.js";
import { copyText } from "@/lib/clipboard.js";
import { cn } from "@/lib/cn.js";
import { useFlashStatus } from "@/lib/use-flash-status.js";

export function CodeBlock({ code, language }: { code: string; language: string }) {
  const { t } = useTranslation();
  const [status, flash] = useFlashStatus();

  const label =
    status === "ok"
      ? t("common.copied")
      : status === "err"
        ? t("common.copyFailed")
        : t("common.copy");

  return (
    <div className="my-2 overflow-hidden rounded-md border border-border">
      <div className="flex items-center justify-between border-b border-border-soft bg-surface px-3 py-1">
        <span className="mono text-[11px] text-text-faint">{language}</span>
        <button
          type="button"
          onClick={() => void copyText(code).then((ok) => flash(ok ? "ok" : "err"))}
          className={cn(
            "rounded px-1.5 py-0.5 text-[11px] hover:bg-surface-3",
            status === "err" ? "text-danger" : "text-text-muted"
          )}
        >
          {label}
        </button>
      </div>
      <pre className="overflow-x-auto bg-muted/50 p-3">
        <code
          className="hljs mono text-xs"
          dangerouslySetInnerHTML={{ __html: highlightCode(code, language) }}
        />
      </pre>
    </div>
  );
}
