import { useState } from "react";
import { cn } from "@/lib/cn.js";
import { useTranslation } from "@/i18n/useTranslation.js";

const FOLD_THRESHOLD = 120;

function lineClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) {
    return "text-text-faint";
  }
  if (line.startsWith("+")) return "bg-brand/10 text-brand";
  if (line.startsWith("-")) return "bg-danger-soft text-danger";
  return "text-text-muted";
}

export function DiffView({ patch }: { patch: string }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const lines = patch.replace(/\n$/, "").split("\n");
  const folded = !expanded && lines.length > FOLD_THRESHOLD;
  const visible = folded ? lines.slice(0, FOLD_THRESHOLD) : lines;
  return (
    <div className="mono max-h-96 overflow-auto rounded-md border border-soft bg-surface text-[12px] leading-relaxed">
      <pre className="min-w-0">
        {visible.map((line, index) => (
          <div key={index} className={cn("whitespace-pre-wrap break-all px-2", lineClass(line))}>
            {line}
          </div>
        ))}
      </pre>
      {folded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="w-full border-t border-soft px-2 py-1 text-left text-[11.5px] text-text-muted hover:bg-surface-3"
        >
          {t("approval.expandDiff")}
        </button>
      )}
    </div>
  );
}
