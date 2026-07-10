import { useState } from "react";
import { highlightCode } from "@/lib/highlight.js";
import { useTranslation } from "@/i18n/useTranslation.js";

export function CodeBlock({ code, language }: { code: string; language: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="my-2 overflow-hidden rounded-md border border-border">
      <div className="flex items-center justify-between border-b border-soft bg-surface px-3 py-1">
        <span className="mono text-[11px] text-text-faint">{language}</span>
        <button
          type="button"
          onClick={() => void copy()}
          className="rounded px-1.5 py-0.5 text-[11px] text-text-muted hover:bg-surface-3"
        >
          {copied ? t("common.copied") : t("common.copy")}
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
