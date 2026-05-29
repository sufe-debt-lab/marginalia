import { FileText, Plus, X } from "lucide-react";
import { useTranslation } from "@/i18n/useTranslation.js";
import { cn } from "@/lib/cn.js";

function basename(p: string): string {
  return p.split("/").pop() || p;
}

interface Props {
  tabs: readonly string[];
  activeTab: string | null;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onAdd: () => void;
}

export function DocumentTabs({ tabs, activeTab, onSelect, onClose, onAdd }: Props) {
  const { t } = useTranslation();
  return (
    <div className="flex h-[38px] items-center gap-0.5 overflow-x-auto border-b border-border-soft bg-surface-2 px-2">
      {tabs.map((path) => {
        const active = activeTab === path;
        return (
          <div
            key={path}
            className={cn(
              "group -mb-px flex h-7 items-center gap-1.5 rounded-t-[7px] border px-2.5 text-xs",
              active
                ? "border-border border-b-surface bg-surface text-foreground"
                : "border-transparent text-text-muted hover:bg-surface/60"
            )}
          >
            <FileText className="h-3 w-3 shrink-0 text-text-faint" />
            <button type="button" className="max-w-[140px] truncate" onClick={() => onSelect(path)}>
              {basename(path)}
            </button>
            <button
              type="button"
              aria-label={`${t("docPanel.close")} ${path}`}
              onClick={() => onClose(path)}
              className="text-text-faint hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
      <span className="flex-1" />
      <button
        type="button"
        aria-label={t("docPanel.addTab")}
        onClick={onAdd}
        className="flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-surface/60"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
